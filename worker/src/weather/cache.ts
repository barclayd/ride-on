import { z } from 'zod';
import type {
  ForecastProvider,
  ForecastRequest,
  LocationForecastResult,
} from './contracts.ts';
import { descriptorKey } from './descriptors.ts';
import {
  coordinateSchema,
  forecastDescriptorSchema,
  utcInstant,
} from './validation.ts';

export type ForecastCache = Readonly<{
  get: (key: string) => Promise<string | null>;
  put: (key: string, value: string, ttlSeconds: number) => Promise<void>;
}>;
const range = z.object({ start: utcInstant, end: utcInstant });
export const FORECAST_RETENTION_SECONDS = 12 * 3600;

type Fresh = [
  result: Exclude<LocationForecastResult, { status: 'unavailable' }>,
  request: Pick<ForecastRequest, 'maxAgeSeconds' | 'freshnessBasis'>,
];
const freshnessAt = (...[result, request]: Fresh) =>
  Date.parse(
    (request.freshnessBasis === 'retrieval-time'
      ? result.provenance.retrievedAt
      : result.provenance.forecastRunAt) ?? '',
  );

/** When evidence stops being fresh: retrieval TTL, provider expiry or model age, whichever comes first (NaN without a run time). */
export const forecastStaleAt = (
  ...[result, request, ttlSeconds]: [...Fresh, number]
) =>
  Math.min(
    Date.parse(result.provenance.retrievedAt) + ttlSeconds * 1000,
    result.provenance.expiresAt === undefined
      ? Infinity
      : Date.parse(result.provenance.expiresAt),
    freshnessAt(result, request) + request.maxAgeSeconds * 1000,
  );

/** Retaining evidence does not make it fresh for every requested ride date. */
export const isFreshForecast = (
  result: Fresh[0],
  request: Fresh[1],
  now: number,
  ttlSeconds: number,
) =>
  now >= Date.parse(result.provenance.retrievedAt) &&
  now < forecastStaleAt(result, request, ttlSeconds) &&
  now - freshnessAt(result, request) >= -300_000;
/** Validated cacheable evidence; offline calibration uses the same snapshot shape. */
const forecastSnapshotSchema = z.object({
  status: z.enum(['complete', 'partial']),
  location: z.object({
    requested: z.object({ id: z.string(), coordinate: coordinateSchema }),
    coordinate: coordinateSchema,
    sourceLocationId: z.string().nullable(),
    distanceFromRequestedM: z.number().nonnegative(),
    method: z.enum([
      'nearest-site',
      'grid-cell',
      'interpolated',
      'exact',
      'provider-location',
    ]),
  }),
  provenance: z.object({
    source: z.object({
      providerId: z.string(),
      productId: z.string(),
      adapterVersion: z.string(),
    }),
    dataVersion: z.string().nullable(),
    forecastRunAt: utcInstant.optional(),
    retrievedAt: utcInstant,
    expiresAt: utcInstant.optional(),
    attribution: z.array(
      z.object({
        text: z.string(),
        url: z.string(),
        logo: z
          .object({ lightUrl: z.string(), darkUrl: z.string() })
          .optional(),
        notice: z.string().optional(),
      }),
    ),
  }),
  issuedAt: utcInstant.nullable(),
  series: z.array(
    z.object({
      descriptor: forecastDescriptorSchema,
      samples: z.array(
        z.object({
          validAt: utcInstant,
          value: z.number().nullable(),
          time: z.union([
            z.object({ kind: z.literal('instant'), at: utcInstant }),
            z.object({
              kind: z.literal('period'),
              range,
              aggregation: z.enum([
                'mean',
                'minimum',
                'maximum',
                'accumulation',
                'event',
                'categorical-summary',
              ]),
            }),
          ]),
        }),
      ),
    }),
  ),
  // Unknown sky symbols are durable missing evidence, not a transport failure.
  // The refinement below still rejects gaps in the other hourly measurements.
  issues: z.array(
    z.object({
      code: z.enum([
        'outside-forecast-horizon',
        'unknown-model-run',
        'missing-data',
      ]),
      message: z.string(),
    }),
  ),
});
export const cachedForecastSchema = forecastSnapshotSchema.refine(
  (result) =>
    !result.issues.some((i) => i.code === 'missing-data') ||
    (result.series.some(
      (s) =>
        s.descriptor.kind === 'category' &&
        s.descriptor.quantity === 'sky-condition',
    ) &&
      result.series.every(
        ({ descriptor, samples }) =>
          descriptor.kind === 'category' ||
          (samples.length > 0 &&
            samples.every(
              (sample, index) =>
                sample.value !== null &&
                (index === 0 ||
                  Date.parse(sample.validAt) -
                    Date.parse(samples[index - 1]?.validAt ?? '') ===
                    3_600_000),
            )),
      )),
  'Only missing sunshine may be retained in an otherwise complete hourly snapshot.',
);

/** Source fallback must assess the requested comparison, not unused prefetched hours. */
const forRequestedRange = (
  result: LocationForecastResult,
  request: ForecastRequest,
): LocationForecastResult => {
  if (result.status === 'unavailable') return result;
  const first =
    Math.floor(Date.parse(request.range.start) / 3_600_000) * 3_600_000;
  const last =
    Math.ceil(Date.parse(request.range.end) / 3_600_000) * 3_600_000 -
    3_600_000;
  const covers = request.required.every((descriptor) => {
    const samples =
      result.series.find(
        (s) => descriptorKey(s.descriptor) === descriptorKey(descriptor),
      )?.samples ?? [];
    const times = samples.map((s) => Date.parse(s.validAt));
    return (
      Math.min(Infinity, ...times) <= first &&
      Math.max(-Infinity, ...times) >= last
    );
  });
  const issues = result.issues.filter(
    (i) => i.code !== 'outside-forecast-horizon',
  );
  if (!covers)
    issues.push({
      code: 'outside-forecast-horizon',
      message:
        'The available snapshot does not cover the full requested range.',
    });
  return { ...result, status: issues.length ? 'partial' : 'complete', issues };
};

export const withForecastCache = (
  provider: ForecastProvider,
  cache: ForecastCache,
  options: {
    now?: () => Date;
    ttlSeconds?: number;
    retentionSeconds?: number;
    /** Site adapters use provider site IDs; route-point IDs are otherwise ignored. */
    keyByLocationId?: boolean;
    forecastHorizonHours?: number;
    onRead?: (hit: boolean) => void;
  } = {},
): ForecastProvider => ({
  ...provider,
  getForecast: async (request, signal) => {
    const originalRequest = request;
    const now = (options.now ?? (() => new Date()))().getTime();
    const ttl = options.ttlSeconds ?? 1200;
    // Fetch a moving horizon on misses, but never put the current clock in its key.
    // Keep a preceding hour for nearest-instant arrival sampling.
    if (options.forecastHorizonHours !== undefined) {
      const start = Math.floor(now / 3_600_000) * 3_600_000 - 3_600_000;
      request = {
        ...request,
        range: {
          start: new Date(start).toISOString(),
          end: new Date(
            start + options.forecastHorizonHours * 3_600_000,
          ).toISOString(),
        },
      };
    }
    const keys = await Promise.all(
      request.locations.map(async (location) => {
        const encoded = new TextEncoder().encode(
          JSON.stringify({
            source: provider.source,
            coordinate: location.coordinate,
            locationId: options.keyByLocationId ? location.id : undefined,
            coverage:
              options.forecastHorizonHours === undefined
                ? request.range
                : { forecastHorizonHours: options.forecastHorizonHours },
            required: request.required.map(descriptorKey).sort(),
            freshnessBasis: request.freshnessBasis ?? 'model-run',
            maxLocationDistanceM: request.maxLocationDistanceM,
            maxTimeStepSeconds: request.maxTimeStepSeconds,
          }),
        );
        const hash = new Uint8Array(
          await crypto.subtle.digest('SHA-256', encoded),
        );
        return `weather:v2:${Array.from(hash, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
      }),
    );
    const found = await Promise.all(
      request.locations.map(
        async (location, index): Promise<LocationForecastResult | null> => {
          const key = keys[index];
          if (!key || signal.aborted) return null;
          try {
            const text = await cache.get(key);
            if (!text) return null;
            const parsed = cachedForecastSchema.safeParse(JSON.parse(text));
            if (!parsed.success) return null;
            const result = parsed.data;
            if (
              !isFreshForecast(result, request, now, ttl) ||
              JSON.stringify(result.provenance.source) !==
                JSON.stringify(provider.source) ||
              result.location.requested.coordinate.latitude !==
                location.coordinate.latitude ||
              result.location.requested.coordinate.longitude !==
                location.coordinate.longitude
            )
              return null;
            return {
              ...result,
              location: { ...result.location, requested: location },
            };
          } catch {
            return null;
          }
        },
      ),
    );
    found.forEach((result) => {
      options.onRead?.(result !== null);
    });
    const missing = request.locations.filter((_, index) => !found[index]);
    const fetched = missing.length
      ? await provider.getForecast({ ...request, locations: missing }, signal)
      : [];
    const byId = new Map(
      fetched.map((result) => [
        result.status === 'unavailable'
          ? result.requested.id
          : result.location.requested.id,
        result,
      ]),
    );
    const results = request.locations.map(
      (location, index) => found[index] ?? byId.get(location.id),
    );
    await Promise.all(
      results.map(async (result, index) => {
        const key = keys[index];
        if (
          !result ||
          found[index] ||
          !key ||
          !cachedForecastSchema.safeParse(result).success
        )
          return;
        try {
          await cache.put(
            key,
            JSON.stringify(result),
            Math.max(ttl, options.retentionSeconds ?? ttl),
          );
        } catch {
          /* Forecasts remain usable if the cache is unavailable. */
        }
      }),
    );
    // The provider contract guarantees one result per location; preserve a failure if broken.
    return results.map((result, index) =>
      result
        ? options.forecastHorizonHours === undefined
          ? result
          : forRequestedRange(result, originalRequest)
        : {
            status: 'unavailable',
            requested: request.locations[index] as NonNullable<
              (typeof request.locations)[number]
            >,
            source: provider.source,
            issues: [
              {
                code: 'missing-data',
                message: 'No forecast result was returned.',
              },
            ],
          },
    );
  },
});
