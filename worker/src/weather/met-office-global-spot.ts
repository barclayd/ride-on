import { z } from 'zod';
import { haversineKm } from '../geo.ts';
import type {
  ForecastDescriptor,
  ForecastProvider,
  ForecastRequest,
  ForecastSample,
  LocationForecastResult,
  ProviderIssue,
  RequestedLocation,
  SampleTime,
} from './contracts.ts';
import { descriptorKey, weatherDescriptors as weather } from './descriptors.ts';
import { readBoundedJson } from './http.ts';
import { metOfficeSkyCondition } from './met-office-symbols.ts';
import { forecastRequestSchema, utcInstant } from './validation.ts';

const HOUR = 3_600_000;
const ENDPOINT =
  'https://data.hub.api.metoffice.gov.uk/sitespecific/v0/point/hourly';
const source = {
  providerId: 'met-office',
  productId: 'global-spot-hourly',
  adapterVersion: '1',
} as const;
type Transport = (url: string, init: RequestInit) => Promise<Response>;
type Mapping = Readonly<{
  field: string;
  descriptor: ForecastDescriptor;
  unit: string;
  period?: {
    beforeMs: number;
    afterMs: number;
    aggregation: Extract<SampleTime, { kind: 'period' }>['aggregation'];
  };
}>;

// Timing verified against the DataHub glossary and parameter metadata, 2026-10-09.
const mappings: readonly Mapping[] = [
  {
    field: 'significantWeatherCode',
    descriptor: weather.skyCondition,
    unit: '1',
  },
  {
    field: 'screenTemperature',
    descriptor: weather.airTemperature,
    unit: 'Cel',
  },
  {
    field: 'feelsLikeTemperature',
    descriptor: weather.feelsLikeTemperature,
    unit: 'Cel',
  },
  {
    field: 'windSpeed10m',
    descriptor: weather.windSpeed,
    unit: 'm/s',
    period: { beforeMs: 600_000, afterMs: 0, aggregation: 'mean' },
  },
  {
    field: 'windDirectionFrom10m',
    descriptor: weather.windDirection,
    unit: 'deg',
    period: { beforeMs: 600_000, afterMs: 0, aggregation: 'mean' },
  },
  {
    field: 'max10mWindGust',
    descriptor: weather.windGust,
    unit: 'm/s',
    period: { beforeMs: HOUR, afterMs: 0, aggregation: 'maximum' },
  },
  {
    field: 'totalPrecipAmount',
    descriptor: weather.precipitationAmount,
    unit: 'mm',
    period: { beforeMs: HOUR, afterMs: 0, aggregation: 'accumulation' },
  },
  {
    field: 'precipitationRate',
    descriptor: weather.precipitationRate,
    unit: 'mm/h',
  },
  {
    field: 'probOfPrecipitation',
    descriptor: weather.precipitationProbability,
    unit: '%',
    period: { beforeMs: HOUR / 2, afterMs: HOUR / 2, aggregation: 'event' },
  },
];

const envelopeSchema = z.object({
  type: z.literal('FeatureCollection'),
  parameters: z.array(z.record(z.string(), z.unknown())).max(32),
  features: z
    .array(
      z.object({
        type: z.literal('Feature'),
        geometry: z.object({
          type: z.literal('Point'),
          coordinates: z
            .tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)])
            .rest(z.number()),
        }),
        properties: z.object({
          modelRunDate: utcInstant,
          timeSeries: z
            .array(z.object({ time: utcInstant }).catchall(z.unknown()))
            .min(1)
            .max(200),
        }),
      }),
    )
    .length(1),
});
const unitSchema = z.object({
  unit: z.object({ symbol: z.object({ type: z.string() }) }),
});
const issue = (
  code: ProviderIssue['code'],
  message: string,
): ProviderIssue => ({ code, message });
const unavailable = (
  requested: RequestedLocation,
  problem: ProviderIssue,
): LocationForecastResult => ({
  status: 'unavailable',
  requested,
  source,
  issues: [problem],
});

const convert = (raw: unknown, mapping: Mapping): number | null => {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  if (mapping.descriptor.kind === 'category') return metOfficeSkyCondition(raw);
  if (mapping.descriptor.kind === 'probability')
    return raw >= 0 && raw <= 100 ? raw / 100 : null;
  const quantity = mapping.descriptor.measure.quantity;
  if (quantity === 'wind-from-direction')
    return raw >= 0 && raw <= 360 ? raw % 360 : null;
  if (quantity === 'air-temperature' || quantity === 'feels-like-temperature')
    return raw >= -273.15 ? raw : null;
  return raw >= 0 ? raw : null;
};

/** No raw upstream bodies, error messages, credentials or arbitrary field names escape. */
export const normaliseGlobalSpot = (
  raw: unknown,
  requested: RequestedLocation,
  request: ForecastRequest,
  retrievedAt: string,
): LocationForecastResult => {
  const parsed = envelopeSchema.safeParse(raw);
  if (!parsed.success)
    return unavailable(
      requested,
      issue(
        'invalid-response',
        'Met Office returned an invalid forecast structure.',
      ),
    );
  const feature = parsed.data.features[0];
  if (!feature)
    return unavailable(
      requested,
      issue('invalid-response', 'Met Office returned no forecast location.'),
    );
  const [longitude, latitude] = feature.geometry.coordinates;
  const distanceFromRequestedM =
    haversineKm(
      [requested.coordinate.latitude, requested.coordinate.longitude],
      [latitude, longitude],
    ) * 1000;
  if (!Number.isFinite(distanceFromRequestedM)) {
    return unavailable(
      requested,
      issue(
        'invalid-response',
        'The forecast location distance could not be resolved.',
      ),
    );
  }
  if (distanceFromRequestedM > request.maxLocationDistanceM) {
    return unavailable(
      requested,
      issue(
        'outside-coverage',
        'The forecast location exceeds the permitted distance from the route sample.',
      ),
    );
  }
  const rows = [...feature.properties.timeSeries].sort(
    (a, b) => Date.parse(a.time) - Date.parse(b.time),
  );
  if (
    new Set(rows.map((row) => Date.parse(row.time))).size !== rows.length ||
    rows.some((row) => Date.parse(row.time) % HOUR !== 0)
  ) {
    return unavailable(
      requested,
      issue(
        'invalid-response',
        'Met Office returned duplicate or non-hourly validity times.',
      ),
    );
  }
  const issues: ProviderIssue[] = [];
  const ageMs =
    Date.parse(retrievedAt) - Date.parse(feature.properties.modelRunDate);
  if (
    request.freshnessBasis !== 'retrieval-time' &&
    ageMs > request.maxAgeSeconds * 1000
  )
    issues.push(
      issue('stale-data', 'The forecast model run exceeds the allowed age.'),
    );
  if (ageMs < -5 * 60_000)
    return unavailable(
      requested,
      issue(
        'invalid-response',
        'The forecast model run is unexpectedly in the future.',
      ),
    );
  if (request.maxTimeStepSeconds < HOUR / 1000)
    issues.push(
      issue('insufficient-resolution', 'This product supplies hourly samples.'),
    );
  const metadata = Object.assign({}, ...parsed.data.parameters) as Record<
    string,
    unknown
  >;
  const start = Date.parse(request.range.start);
  const end = Date.parse(request.range.end);
  const series = request.required.flatMap((descriptor) => {
    const mapping = mappings.find(
      (candidate) =>
        descriptorKey(candidate.descriptor) === descriptorKey(descriptor),
    );
    if (!mapping) {
      issues.push(
        issue(
          'unsupported-statistic',
          'The requested quantity or statistic is not supported by this adapter.',
        ),
      );
      return [];
    }
    const unit = unitSchema.safeParse(metadata[mapping.field]);
    const validUnit =
      unit.success && unit.data.unit.symbol.type === mapping.unit;
    if (!validUnit)
      issues.push(
        issue(
          'invalid-response',
          'A required forecast parameter has missing or unexpected units.',
        ),
      );
    // Include an endpoint sample when its period overlaps the requested half-open range.
    const relevant = rows.filter((row) => {
      const at = Date.parse(row.time);
      return mapping.period
        ? at + mapping.period.afterMs > start &&
            at - mapping.period.beforeMs < end
        : at >= start && at < end;
    });
    const samples: ForecastSample[] = relevant.map((row) => {
      const at = Date.parse(row.time);
      return {
        validAt: new Date(at).toISOString(),
        time: mapping.period
          ? {
              kind: 'period',
              aggregation: mapping.period.aggregation,
              range: {
                start: new Date(at - mapping.period.beforeMs).toISOString(),
                end: new Date(at + mapping.period.afterMs).toISOString(),
              },
            }
          : { kind: 'instant', at: new Date(at).toISOString() },
        value: validUnit ? convert(row[mapping.field], mapping) : null,
      };
    });
    // Coverage checks use the expected validity grid; ten-minute wind means do not
    // falsely promise continuously measured wind throughout each hour.
    const expected: number[] = [];
    const low = Math.floor(start / HOUR) * HOUR;
    const high = Math.ceil(end / HOUR) * HOUR;
    for (let at = low; at <= high; at += HOUR) {
      const applies = mapping.period
        ? at + mapping.period.afterMs > start &&
          at - mapping.period.beforeMs < end
        : at >= start && at < end;
      if (applies) expected.push(at);
    }
    const present = new Set(
      samples.map((sample) => Date.parse(sample.validAt)),
    );
    if (expected.length === 0 || expected.some((at) => !present.has(at))) {
      const firstTime = Date.parse(rows[0]?.time ?? '');
      const lastTime = Date.parse(rows.at(-1)?.time ?? '');
      const outsideHorizon = expected.some(
        (at) => at < firstTime || at > lastTime,
      );
      issues.push(
        issue(
          outsideHorizon ? 'outside-forecast-horizon' : 'missing-data',
          'Required hourly evidence is missing inside the requested range.',
        ),
      );
    }
    if (samples.some((sample) => sample.value === null))
      issues.push(
        issue(
          'missing-data',
          'A required forecast value is missing or invalid.',
        ),
      );
    return [{ descriptor, samples }];
  });
  const uniqueIssues = [
    ...new Map(issues.map((problem) => [problem.code, problem])).values(),
  ];
  if (
    !series.some((item) => item.samples.some((sample) => sample.value !== null))
  ) {
    return unavailable(
      requested,
      uniqueIssues[0] ??
        issue('missing-data', 'No usable forecast evidence was returned.'),
    );
  }
  return {
    status: uniqueIssues.length ? 'partial' : 'complete',
    location: {
      requested,
      coordinate: { latitude, longitude },
      sourceLocationId: null,
      distanceFromRequestedM,
      method: 'nearest-site',
    },
    provenance: {
      source,
      dataVersion: feature.properties.modelRunDate,
      forecastRunAt: feature.properties.modelRunDate,
      retrievedAt,
      attribution: [
        {
          text: 'Powered by Met Office data',
          url: 'https://www.metoffice.gov.uk/',
        },
      ],
    },
    // A model run time is not a verified publication/issue time.
    issuedAt: null,
    series,
    issues: uniqueIssues,
  };
};

export const createMetOfficeGlobalSpot = (
  options: Readonly<{
    apiKey: string;
    fetch?: Transport;
    now?: () => Date;
    timeoutMs?: number;
    concurrency?: number;
  }>,
): ForecastProvider => {
  const transport = options.fetch ?? ((url, init) => fetch(url, init));
  const now = options.now ?? (() => new Date());
  const timeoutMs = options.timeoutMs ?? 10_000;
  const concurrency = options.concurrency ?? 4;
  if (
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0 ||
    !Number.isInteger(concurrency) ||
    concurrency < 1 ||
    concurrency > 8
  ) {
    throw new Error('Invalid weather transport configuration.');
  }
  return {
    source,
    getCapabilities: async () => ({
      available: mappings.map(({ descriptor }) => ({
        descriptor,
        timeStepSeconds: 3600,
        forecastHorizonSeconds: 48 * 3600,
      })),
      maxLocationsPerUpstreamRequest: 1,
    }),
    getForecast: async (request, signal) => {
      if (!forecastRequestSchema.safeParse(request).success)
        return request.locations.map((location) =>
          unavailable(
            location,
            issue('invalid-request', 'Invalid forecast request.'),
          ),
        );
      if (!options.apiKey.trim())
        return request.locations.map((location) =>
          unavailable(
            location,
            issue(
              'not-configured',
              'Met Office credentials are not configured.',
            ),
          ),
        );
      // Coalesce duplicate coordinates within this call, retaining every original ID.
      const groups = new Map<string, RequestedLocation[]>();
      for (const location of request.locations) {
        const key = `${location.coordinate.latitude},${location.coordinate.longitude}`;
        const group = groups.get(key) ?? [];
        group.push(location);
        groups.set(key, group);
      }
      const queue = [...groups.values()];
      const results = new Map<string, LocationForecastResult>();
      let cursor = 0;
      let terminalIssue: ProviderIssue | undefined;
      const run = async () => {
        while (cursor < queue.length) {
          const group = queue[cursor++];
          if (!group?.[0]) continue;
          const first = group[0];
          let raw: unknown;
          let problem = signal.aborted
            ? issue('cancelled', 'Forecast request was cancelled.')
            : terminalIssue;
          if (!problem && Math.abs(first.coordinate.latitude) > 85) {
            problem = issue(
              'outside-coverage',
              'This product accepts latitudes between -85 and 85 degrees.',
            );
          }
          const controller = new AbortController();
          const abort = () => controller.abort();
          signal.addEventListener('abort', abort, { once: true });
          let timedOut = false;
          const timeout = setTimeout(() => {
            timedOut = true;
            controller.abort();
          }, timeoutMs);
          try {
            if (!problem) {
              const url = new URL(ENDPOINT);
              url.searchParams.set(
                'latitude',
                String(first.coordinate.latitude),
              );
              url.searchParams.set(
                'longitude',
                String(first.coordinate.longitude),
              );
              url.searchParams.set('excludeParameterMetadata', 'false');
              const response = await transport(url.href, {
                headers: { apikey: options.apiKey, Accept: 'application/json' },
                signal: controller.signal,
                redirect: 'manual',
              });
              if (!response.ok) {
                if (response.status === 401 || response.status === 403)
                  problem = issue(
                    'unauthorized',
                    'Met Office rejected the configured credentials or subscription.',
                  );
                else if (response.status === 429) {
                  const retry = response.headers.get('Retry-After');
                  const seconds =
                    retry && /^\d+$/.test(retry)
                      ? Number(retry)
                      : retry
                        ? Math.ceil(
                            (Date.parse(retry) - now().getTime()) / 1000,
                          )
                        : NaN;
                  problem = {
                    ...issue(
                      'rate-limited',
                      'Met Office request allowance was exceeded.',
                    ),
                    ...(Number.isFinite(seconds) && seconds >= 0
                      ? { retryAfterSeconds: seconds }
                      : {}),
                  };
                } else
                  problem = issue(
                    'upstream-unavailable',
                    'Met Office could not supply a forecast.',
                  );
                if (
                  problem.code === 'unauthorized' ||
                  problem.code === 'rate-limited'
                )
                  terminalIssue = problem;
                await response.body?.cancel();
              } else {
                try {
                  raw = await readBoundedJson(response);
                } catch {
                  problem = issue(
                    'invalid-response',
                    'Met Office returned unreadable or oversized forecast data.',
                  );
                }
              }
            }
          } catch {
            problem = issue(
              'upstream-unavailable',
              'Met Office could not be reached.',
            );
          } finally {
            clearTimeout(timeout);
            signal.removeEventListener('abort', abort);
          }
          if (signal.aborted)
            problem = issue('cancelled', 'Forecast request was cancelled.');
          else if (timedOut)
            problem = issue(
              'timeout',
              'Met Office did not respond before the deadline.',
            );
          const retrievedAt = now().toISOString();
          for (const location of group)
            results.set(
              location.id,
              problem
                ? unavailable(location, problem)
                : normaliseGlobalSpot(raw, location, request, retrievedAt),
            );
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(concurrency, queue.length) }, run),
      );
      return request.locations.map(
        (location) =>
          results.get(location.id) ??
          unavailable(
            location,
            issue('missing-data', 'No result was returned.'),
          ),
      );
    },
  };
};
