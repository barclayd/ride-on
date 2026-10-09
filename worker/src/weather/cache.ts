import { z } from 'zod';
import type { ForecastProvider, LocationForecastResult } from './contracts.ts';
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
const cachedSchema = z.object({
  status: z.enum(['complete', 'partial']),
  location: z.object({
    requested: z.object({ id: z.string(), coordinate: coordinateSchema }),
    coordinate: coordinateSchema,
    sourceLocationId: z.string().nullable(),
    distanceFromRequestedM: z.number().nonnegative(),
    method: z.enum(['nearest-site', 'grid-cell', 'interpolated', 'exact']),
  }),
  provenance: z.object({
    source: z.object({
      providerId: z.string(),
      productId: z.string(),
      adapterVersion: z.string(),
    }),
    dataVersion: z.string().nullable(),
    forecastRunAt: utcInstant,
    retrievedAt: utcInstant,
    attribution: z.array(z.object({ text: z.string(), url: z.string() })),
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
              ]),
            }),
          ]),
        }),
      ),
    }),
  ),
  // Only complete or horizon-limited snapshots are stored, never transient failures.
  issues: z.array(
    z.object({
      code: z.literal('outside-forecast-horizon'),
      message: z.string(),
    }),
  ),
});

export const withForecastCache = (
  provider: ForecastProvider,
  cache: ForecastCache,
  options: {
    now?: () => Date;
    ttlSeconds?: number;
    onRead?: (hit: boolean) => void;
  } = {},
): ForecastProvider => ({
  ...provider,
  getForecast: async (request, signal) => {
    const now = (options.now ?? (() => new Date()))().getTime();
    const ttl = options.ttlSeconds ?? 1200;
    const keys = await Promise.all(
      request.locations.map(async (location) => {
        const encoded = new TextEncoder().encode(
          JSON.stringify({
            source: provider.source,
            coordinate: location.coordinate,
            range: request.range,
            required: request.required.map(descriptorKey).sort(),
            maxAgeSeconds: request.maxAgeSeconds,
            maxLocationDistanceM: request.maxLocationDistanceM,
            maxTimeStepSeconds: request.maxTimeStepSeconds,
          }),
        );
        const hash = new Uint8Array(
          await crypto.subtle.digest('SHA-256', encoded),
        );
        return `weather:v1:${Array.from(hash, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
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
            const parsed = cachedSchema.safeParse(JSON.parse(text));
            if (!parsed.success) return null;
            const result = parsed.data;
            const age = now - Date.parse(result.provenance.retrievedAt);
            const runAge = now - Date.parse(result.provenance.forecastRunAt);
            if (
              age < 0 ||
              age > ttl * 1000 ||
              runAge > request.maxAgeSeconds * 1000 ||
              runAge < -300_000 ||
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
          !cachedSchema.safeParse(result).success
        )
          return;
        try {
          await cache.put(key, JSON.stringify(result), ttl);
        } catch {
          /* Forecasts remain usable if the cache is unavailable. */
        }
      }),
    );
    // The provider contract guarantees one result per location; preserve a failure if broken.
    return results.map(
      (result, index) =>
        result ?? {
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
