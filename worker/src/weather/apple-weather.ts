import { importPKCS8, SignJWT } from 'jose';
import { z } from 'zod';
import { haversineKm } from '../geo.ts';
import { skyConditions } from './conditions.ts';
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
import { forecastRequestSchema, utcInstant } from './validation.ts';

const HOUR = 3_600_000;
const ORIGIN = 'https://weatherkit.apple.com';
export const appleWeatherSource = {
  providerId: 'apple-weather',
  productId: 'weatherkit-hourly',
  adapterVersion: '1',
} as const;
// URLs returned by Apple's /attribution/en endpoint, verified 2026-10-10.
export const appleWeatherAttribution = {
  text: 'Apple Weather',
  url: 'https://developer.apple.com/weatherkit/data-source-attribution/',
  logo: {
    lightUrl: `${ORIGIN}/assets/branding/en/Apple_Weather_blk_en_2X_090122.png`,
    darkUrl: `${ORIGIN}/assets/branding/en/Apple_Weather_wht_en_2X_090122.png`,
  },
  notice:
    'Ride On route assessments are derived from and modify Apple Weather data.',
} as const;
const configSchema = z.strictObject({
  teamId: z.string().regex(/^[A-Z0-9]{10}$/),
  keyId: z.string().regex(/^[A-Z0-9]{10}$/),
  serviceId: z.string().min(1).max(200),
  privateKey: z.string().startsWith('-----BEGIN PRIVATE KEY-----').max(10_000),
});
export const parseAppleWeatherConfig = (raw: string | undefined) => {
  try {
    const parsed = configSchema.safeParse(JSON.parse(raw ?? ''));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};
type Mapping = {
  field: string;
  descriptor: ForecastDescriptor;
  aggregation?: Extract<SampleTime, { kind: 'period' }>['aggregation'];
};
// Apple's HourWeatherConditions starts each period at forecastStart.
const mappings: readonly Mapping[] = [
  { field: 'temperature', descriptor: weather.airTemperature },
  { field: 'temperatureApparent', descriptor: weather.feelsLikeTemperature },
  { field: 'windSpeed', descriptor: weather.windSpeed },
  { field: 'windDirection', descriptor: weather.windDirection },
  { field: 'windGust', descriptor: weather.windGust, aggregation: 'maximum' },
  {
    field: 'cloudCover',
    descriptor: weather.totalCloudCover,
    aggregation: 'mean',
  },
  { field: 'conditionCode', descriptor: weather.skyCondition },
  {
    field: 'precipitationAmount',
    descriptor: weather.precipitationAmount,
    aggregation: 'accumulation',
  },
  // One-hour liquid-equivalent accumulation / one hour, not an instantaneous intensity.
  {
    field: 'precipitationAmount',
    descriptor: weather.precipitationRate,
    aggregation: 'mean',
  },
  {
    field: 'precipitationChance',
    descriptor: weather.precipitationProbability,
    aggregation: 'event',
  },
];
const mappingFor = (d: ForecastDescriptor) =>
  mappings.find((m) => descriptorKey(m.descriptor) === descriptorKey(d));
const envelope = z.object({
  forecastHourly: z.object({
    metadata: z.object({
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
      units: z.literal('m'),
      version: z.literal(1),
      readTime: utcInstant,
      reportedTime: utcInstant.optional(),
      expireTime: utcInstant,
      temporarilyUnavailable: z.boolean().optional(),
    }),
    hours: z
      .array(z.object({ forecastStart: utcInstant }).catchall(z.unknown()))
      .min(1)
      .max(250),
  }),
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
  source: appleWeatherSource,
  issues: [problem],
});

/** Map only symbols that actually describe sky/precipitation; wind/heat codes cannot imply sunshine. */
export const appleSkyCondition = (
  code: unknown,
  daylight: unknown,
): number | null => {
  if (code === 'Clear')
    return daylight === true
      ? skyConditions.sunny
      : daylight === false
        ? skyConditions.clearNight
        : null;
  if (code === 'MostlyClear' || code === 'PartlyCloudy')
    return daylight === true
      ? skyConditions.sunnyIntervals
      : daylight === false
        ? skyConditions.partlyCloudyNight
        : null;
  if (code === 'MostlyCloudy') return skyConditions.cloudy;
  if (code === 'Cloudy') return skyConditions.overcast;
  if (
    ['BlowingDust', 'Foggy', 'Haze', 'Smoky', 'BlowingSnow'].includes(
      String(code),
    )
  )
    return skyConditions.obscured;
  if (
    [
      'Drizzle',
      'HeavyRain',
      'IsolatedThunderstorms',
      'Rain',
      'ScatteredThunderstorms',
      'StrongStorms',
      'Thunderstorms',
      'Hail',
      'Flurries',
      'Sleet',
      'Snow',
      'WintryMix',
      'Blizzard',
      'FreezingDrizzle',
      'FreezingRain',
      'HeavySnow',
      'Hurricane',
      'TropicalStorm',
    ].includes(String(code))
  )
    return skyConditions.precipitation;
  // These explicitly describe visible sun as well as precipitation; dryness is assessed separately.
  if (code === 'SunShowers' || code === 'SunFlurries')
    return daylight === true ? skyConditions.sunnyIntervals : null;
  return null;
};
const convert = (
  row: Record<string, unknown>,
  mapping: Mapping,
): number | null => {
  if (mapping.descriptor.kind === 'category')
    return appleSkyCondition(row[mapping.field], row.daylight);
  const raw = row[mapping.field];
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  if (
    mapping.descriptor.kind === 'probability' ||
    mapping.field === 'cloudCover'
  )
    return raw >= 0 && raw <= 1 ? raw : null;
  if (mapping.field === 'windDirection')
    return raw >= 0 && raw <= 360 ? raw % 360 : null;
  if (
    mapping.field === 'temperature' ||
    mapping.field === 'temperatureApparent'
  )
    return raw >= -273.15 ? raw : null;
  if (raw < 0) return null;
  return mapping.field === 'windSpeed' || mapping.field === 'windGust'
    ? raw / 3.6
    : raw;
};

export const normaliseAppleWeather = (
  raw: unknown,
  requested: RequestedLocation,
  request: ForecastRequest,
  retrievedAt: string,
): LocationForecastResult => {
  const parsed = envelope.safeParse(raw);
  if (!parsed.success)
    return unavailable(
      requested,
      issue(
        'invalid-response',
        'Apple Weather returned invalid forecast metadata, units or hours.',
      ),
    );
  const { metadata, hours } = parsed.data.forecastHourly;
  if (metadata.temporarilyUnavailable)
    return unavailable(
      requested,
      issue(
        'upstream-unavailable',
        'Apple Weather data is temporarily unavailable.',
      ),
    );
  const retrieved = Date.parse(retrievedAt);
  if (
    Date.parse(metadata.readTime) > retrieved + 300_000 ||
    (metadata.reportedTime &&
      Date.parse(metadata.reportedTime) > retrieved + 300_000) ||
    Date.parse(metadata.expireTime) <= Date.parse(metadata.readTime)
  )
    return unavailable(
      requested,
      issue(
        'invalid-response',
        'Apple Weather returned inconsistent data timestamps.',
      ),
    );
  if (Date.parse(metadata.expireTime) <= retrieved)
    return unavailable(
      requested,
      issue('stale-data', 'Apple Weather data has expired.'),
    );
  if (request.freshnessBasis !== 'retrieval-time')
    return unavailable(
      requested,
      issue(
        'unknown-model-run',
        'Apple Weather does not expose a forecast model-run time. Select retrieval-time freshness explicitly.',
      ),
    );
  const coordinate = {
    latitude: metadata.latitude,
    longitude: metadata.longitude,
  };
  const distanceFromRequestedM =
    1000 *
    haversineKm(
      [requested.coordinate.latitude, requested.coordinate.longitude],
      [coordinate.latitude, coordinate.longitude],
    );
  if (distanceFromRequestedM > request.maxLocationDistanceM)
    return unavailable(
      requested,
      issue(
        'outside-coverage',
        'The forecast location exceeds the permitted distance from the route sample.',
      ),
    );
  const rows = [...hours].sort(
    (a, b) => Date.parse(a.forecastStart) - Date.parse(b.forecastStart),
  );
  if (
    new Set(rows.map((r) => Date.parse(r.forecastStart))).size !==
      rows.length ||
    rows.some((r) => Date.parse(r.forecastStart) % HOUR !== 0)
  )
    return unavailable(
      requested,
      issue(
        'invalid-response',
        'Apple Weather returned duplicate or non-hourly forecast times.',
      ),
    );
  const issues: ProviderIssue[] = [
    issue(
      'unknown-model-run',
      'Apple Weather exposes retrieval and reported times, not a verified forecast model-run time.',
    ),
  ];
  if (request.maxTimeStepSeconds < 3600)
    issues.push(
      issue('insufficient-resolution', 'This product supplies hourly samples.'),
    );
  const start = Date.parse(request.range.start);
  const end = Date.parse(request.range.end);
  const series = request.required.flatMap((descriptor) => {
    const mapping = mappingFor(descriptor);
    if (!mapping) {
      issues.push(
        issue(
          'unsupported-statistic',
          'The requested quantity or statistic is not supported by Apple Weather.',
        ),
      );
      return [];
    }
    const applies = (at: number) =>
      mapping.aggregation
        ? at < end && at + HOUR > start
        : at >= start && at < end;
    const samples: ForecastSample[] = rows
      .filter((row) => applies(Date.parse(row.forecastStart)))
      .map((row) => {
        const at = Date.parse(row.forecastStart);
        const validAt = new Date(at).toISOString();
        return {
          validAt,
          value: convert(row, mapping),
          time: mapping.aggregation
            ? {
                kind: 'period',
                aggregation: mapping.aggregation,
                range: {
                  start: validAt,
                  end: new Date(at + HOUR).toISOString(),
                },
              }
            : { kind: 'instant', at: validAt },
        };
      });
    const present = new Set(samples.map((s) => Date.parse(s.validAt)));
    const missing: number[] = [];
    for (let at = Math.floor(start / HOUR) * HOUR; at < end; at += HOUR)
      if (applies(at) && !present.has(at)) missing.push(at);
    if (missing.length)
      issues.push(
        issue(
          missing.some(
            (at) =>
              at < Date.parse(rows[0]?.forecastStart ?? '') ||
              at > Date.parse(rows.at(-1)?.forecastStart ?? ''),
          )
            ? 'outside-forecast-horizon'
            : 'missing-data',
          'Required hourly evidence is missing inside the requested range.',
        ),
      );
    if (!samples.length || samples.some((s) => s.value === null))
      issues.push(
        issue(
          'missing-data',
          'A required Apple Weather value is missing or invalid.',
        ),
      );
    return [{ descriptor, samples }];
  });
  const uniqueIssues = [...new Map(issues.map((i) => [i.code, i])).values()];
  if (!series.some((s) => s.samples.some((sample) => sample.value !== null)))
    return unavailable(
      requested,
      uniqueIssues.find((i) => i.code !== 'unknown-model-run') ??
        issue('missing-data', 'No usable forecast evidence was returned.'),
    );
  return {
    status: 'partial', // Explicit unknown model age is retained even with full hourly coverage.
    location: {
      requested,
      coordinate,
      distanceFromRequestedM,
      sourceLocationId: null,
      method: distanceFromRequestedM === 0 ? 'exact' : 'provider-location',
    },
    provenance: {
      source: appleWeatherSource,
      dataVersion: null,
      retrievedAt,
      expiresAt: metadata.expireTime,
      attribution: [appleWeatherAttribution],
    },
    issuedAt: metadata.reportedTime ?? null,
    series,
    issues: uniqueIssues,
  };
};

export const createAppleWeather = (
  options: Readonly<{
    config: string | undefined;
    fetch?: (url: string, init: RequestInit) => Promise<Response>;
    now?: () => Date;
    timeoutMs?: number;
    concurrency?: number;
  }>,
): ForecastProvider => {
  const credentials = parseAppleWeatherConfig(options.config);
  const transport = options.fetch ?? ((url, init) => fetch(url, init));
  const now = options.now ?? (() => new Date());
  const concurrency = options.concurrency ?? 4;
  const timeoutMs = options.timeoutMs ?? 10_000;
  if (
    !Number.isInteger(concurrency) ||
    concurrency < 1 ||
    concurrency > 8 ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0
  )
    throw new Error('Invalid weather transport configuration.');
  return {
    source: appleWeatherSource,
    getCapabilities: async () => ({
      available: mappings.map(({ descriptor }) => ({
        descriptor,
        timeStepSeconds: 3600,
        forecastHorizonSeconds: 10 * 24 * 3600,
      })),
      maxLocationsPerUpstreamRequest: 1,
    }),
    getForecast: async (request, signal) => {
      const fail = (problem: ProviderIssue) =>
        request.locations.map((l) => unavailable(l, problem));
      if (!forecastRequestSchema.safeParse(request).success)
        return fail(issue('invalid-request', 'Invalid forecast request.'));
      if (signal.aborted)
        return fail(issue('cancelled', 'Forecast request was cancelled.'));
      if (!credentials)
        return fail(
          issue(
            'not-configured',
            'Apple Weather credentials are not configured.',
          ),
        );
      if (request.freshnessBasis !== 'retrieval-time')
        return fail(
          issue(
            'unknown-model-run',
            'Apple Weather requires explicit retrieval-time freshness.',
          ),
        );
      if (request.required.some((d) => !mappingFor(d)))
        return fail(
          issue(
            'unsupported-statistic',
            'Apple Weather cannot supply the requested quantity or statistic.',
          ),
        );
      if (request.maxTimeStepSeconds < 3600)
        return fail(
          issue(
            'insufficient-resolution',
            'This product supplies hourly samples.',
          ),
        );
      let token: string;
      try {
        const key = await importPKCS8(credentials.privateKey, 'ES256');
        const issued = Math.floor(now().getTime() / 1000);
        token = await new SignJWT({})
          .setProtectedHeader({
            alg: 'ES256',
            kid: credentials.keyId,
            id: `${credentials.teamId}.${credentials.serviceId}`,
          })
          .setIssuer(credentials.teamId)
          .setSubject(credentials.serviceId)
          .setIssuedAt(issued)
          .setExpirationTime(issued + 900)
          .sign(key);
      } catch {
        return fail(
          issue(
            'not-configured',
            'Apple Weather signing credentials are invalid.',
          ),
        );
      }
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
          const first = group?.[0];
          if (!group || !first) continue;
          let problem = signal.aborted
            ? issue('cancelled', 'Forecast request was cancelled.')
            : terminalIssue;
          let raw: unknown;
          const timeout = AbortSignal.timeout(timeoutMs);
          const combined = AbortSignal.any([signal, timeout]);
          try {
            if (!problem) {
              const url = new URL(
                `${ORIGIN}/api/v1/weather/en/${first.coordinate.latitude}/${first.coordinate.longitude}`,
              );
              url.searchParams.set('dataSets', 'forecastHourly');
              url.searchParams.set('timezone', 'UTC');
              url.searchParams.set(
                'hourlyStart',
                new Date(
                  Math.floor(Date.parse(request.range.start) / HOUR) * HOUR,
                ).toISOString(),
              );
              url.searchParams.set(
                'hourlyEnd',
                new Date(
                  Math.ceil(Date.parse(request.range.end) / HOUR) * HOUR,
                ).toISOString(),
              );
              const response = await transport(url.href, {
                headers: {
                  Authorization: `Bearer ${token}`,
                  Accept: 'application/json',
                },
                signal: combined,
                redirect: 'manual',
              });
              if (!response.ok) {
                if (response.status === 401 || response.status === 403)
                  problem = issue(
                    'unauthorized',
                    'Apple Weather rejected the configured credentials.',
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
                      'Apple Weather request allowance was exceeded.',
                    ),
                    ...(Number.isFinite(seconds) && seconds >= 0
                      ? { retryAfterSeconds: seconds }
                      : {}),
                  };
                } else
                  problem = issue(
                    'upstream-unavailable',
                    'Apple Weather could not supply a forecast.',
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
                    'Apple Weather returned unreadable or oversized forecast data.',
                  );
                }
              }
            }
          } catch {
            problem = issue(
              'upstream-unavailable',
              'Apple Weather could not be reached.',
            );
          }
          if (signal.aborted)
            problem = issue('cancelled', 'Forecast request was cancelled.');
          else if (timeout.aborted)
            problem = issue(
              'timeout',
              'Apple Weather did not respond before the deadline.',
            );
          const retrievedAt = now().toISOString();
          for (const location of group)
            results.set(
              location.id,
              problem
                ? unavailable(location, problem)
                : normaliseAppleWeather(raw, location, request, retrievedAt),
            );
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(concurrency, queue.length) }, run),
      );
      return request.locations.map(
        (l) =>
          results.get(l.id) ??
          unavailable(
            l,
            issue('missing-data', 'No forecast result was returned.'),
          ),
      );
    },
  };
};
