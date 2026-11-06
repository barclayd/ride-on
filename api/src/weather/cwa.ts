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
} from './contracts.ts';
import catalogue from './cwa-locations.json' with { type: 'json' };
import { descriptorKey, weatherDescriptors as weather } from './descriptors.ts';
import { readBoundedJson } from './http.ts';
import { forecastRequestSchema } from './validation.ts';

const HOUR = 3_600_000;
export const cwaSource = {
  providerId: 'cwa',
  productId: 'township-three-day',
  adapterVersion: '1',
} as const;
export const cwaAttribution = {
  text: 'Central Weather Administration, Taiwan — township forecasts',
  url: 'https://opendata.cwa.gov.tw/dataset/forecast/F-D0047-093',
  notice:
    'Source: 交通部中央氣象署, 鄉鎮天氣預報. Open Government Data License: https://data.gov.tw/license. Ride On normalises this data for route assessments.',
} as const;
/** CWA defines PoP as at least 0.1 mm during the native forecast period. */
export const cwaPrecipitationProbability = {
  kind: 'probability',
  unit: 'fraction',
  event: {
    kind: 'threshold',
    measure: { quantity: 'precipitation-amount', unit: 'mm' },
    comparison: 'at-or-above',
    threshold: 0.1,
  },
} as const satisfies ForecastDescriptor;
const mappings = [
  { element: '溫度', field: 'Temperature', descriptor: weather.airTemperature },
  {
    element: '體感溫度',
    field: 'ApparentTemperature',
    descriptor: weather.feelsLikeTemperature,
  },
  { element: '風速', field: 'WindSpeed', descriptor: weather.windSpeed },
  {
    element: '風向',
    field: 'WindDirection',
    descriptor: weather.windDirection,
  },
  {
    element: '3小時降雨機率',
    field: 'ProbabilityOfPrecipitation',
    descriptor: cwaPrecipitationProbability,
  },
] as const;
type Mapping = (typeof mappings)[number];
type Site = (typeof catalogue)[number];
const mappingFor = (descriptor: ForecastDescriptor) =>
  mappings.find(
    (m) => descriptorKey(m.descriptor) === descriptorKey(descriptor),
  );
// CWA's current datastore schema uses title-case keys. Do not silently accept
// the retired lowercase schema or coerce empty strings / inequality bounds to zero.
const numericString = z
  .string()
  .regex(/^-?\d+(?:\.\d+)?$/)
  .transform(Number);
const locationSchema = z.object({
  LocationName: z.string().min(1),
  Geocode: z.string().regex(/^\d{8}$/),
  Latitude: numericString.pipe(z.number().min(-90).max(90)),
  Longitude: numericString.pipe(z.number().min(-180).max(180)),
  WeatherElement: z
    .array(
      z.object({
        ElementName: z.string(),
        Time: z
          .array(
            z.object({
              DataTime: z.string().optional(),
              StartTime: z.string().optional(),
              EndTime: z.string().optional(),
              ElementValue: z.array(z.record(z.string(), z.unknown())).max(8),
            }),
          )
          .max(150),
      }),
    )
    .max(32),
});
const envelope = z.object({
  success: z.literal('true'),
  result: z.object({ resource_id: z.string() }),
  records: z.object({
    Locations: z
      .array(
        z.object({
          Dataid: z.string(),
          Location: z.array(locationSchema).min(1).max(40),
        }),
      )
      .length(1),
  }),
});
type Township = z.infer<typeof locationSchema>;
const timestamp = z.iso.datetime({ offset: true });
const instant = (raw: unknown): number | null =>
  timestamp.safeParse(raw).success ? Date.parse(String(raw)) : null;
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
  source: cwaSource,
  issues: [problem],
});
const directions: Readonly<Record<string, number>> = {
  北風: 0,
  偏北風: 0,
  東北風: 45,
  東風: 90,
  偏東風: 90,
  東南風: 135,
  南風: 180,
  偏南風: 180,
  西南風: 225,
  西風: 270,
  偏西風: 270,
  西北風: 315,
};
const valueFor = (raw: unknown, mapping: Mapping): number | null => {
  if (mapping.field === 'WindDirection')
    return typeof raw === 'string' && Object.hasOwn(directions, raw)
      ? (directions[raw] ?? null)
      : null;
  const parsed = numericString.safeParse(raw);
  if (!parsed.success || !Number.isFinite(parsed.data)) return null;
  const value = parsed.data;
  if (mapping.field === 'ProbabilityOfPrecipitation')
    return value >= 0 && value <= 100 ? value / 100 : null;
  if (mapping.field === 'WindSpeed') return value >= 0 ? value : null;
  // CWA uses negative sentinels for unavailable data; reject them explicitly.
  return value >= -90 && value <= 70 ? value : null;
};

/** Nearest forecast representative point, never a claim of township membership. */
export const nearestCwaLocation = (requested: RequestedLocation) => {
  let nearest: { site: Site; distanceM: number } | undefined;
  for (const site of catalogue) {
    const distanceM =
      haversineKm(
        [requested.coordinate.latitude, requested.coordinate.longitude],
        [site.latitude, site.longitude],
      ) * 1000;
    if (!nearest || distanceM < nearest.distanceM)
      nearest = { site, distanceM };
  }
  return nearest;
};

const normaliseTownship = (
  township: Township,
  requested: RequestedLocation,
  request: ForecastRequest,
  retrievedAt: string,
): LocationForecastResult => {
  const distanceFromRequestedM =
    haversineKm(
      [requested.coordinate.latitude, requested.coordinate.longitude],
      [township.Latitude, township.Longitude],
    ) * 1000;
  if (distanceFromRequestedM > request.maxLocationDistanceM)
    return unavailable(
      requested,
      issue(
        'outside-coverage',
        'The CWA representative point exceeds the permitted distance from the route sample.',
      ),
    );
  const issues: ProviderIssue[] = [
    issue(
      'unknown-model-run',
      'CWA datastore forecasts do not expose a model-run timestamp.',
    ),
  ];
  const start = Date.parse(request.range.start),
    end = Date.parse(request.range.end);
  const series = request.required.flatMap((descriptor) => {
    const mapping = mappingFor(descriptor);
    if (!mapping) {
      issues.push(
        issue(
          'unsupported-variable',
          'CWA township forecasts do not supply the requested quantity or statistic.',
        ),
      );
      return [];
    }
    const elements = township.WeatherElement.filter(
      (e) => e.ElementName === mapping.element,
    );
    if (elements.length !== 1) {
      issues.push(
        issue(
          elements.length ? 'invalid-response' : 'missing-data',
          'A required CWA forecast element is missing or duplicated.',
        ),
      );
      return [];
    }
    const all: ForecastSample[] = [];
    for (const row of elements[0]?.Time ?? []) {
      const probability = mapping.descriptor.kind === 'probability';
      const at = instant(probability ? row.StartTime : row.DataTime);
      const until = probability ? instant(row.EndTime) : null;
      if (
        at === null ||
        at % HOUR !== 0 ||
        (probability && (until === null || until - at !== 3 * HOUR))
      ) {
        issues.push(
          issue(
            'invalid-response',
            'CWA returned invalid native forecast times.',
          ),
        );
        continue;
      }
      const iso = new Date(at).toISOString();
      all.push({
        validAt: iso,
        time:
          probability && until !== null
            ? {
                kind: 'period',
                aggregation: 'event',
                range: { start: iso, end: new Date(until).toISOString() },
              }
            : { kind: 'instant', at: iso },
        value:
          row.ElementValue.length === 1
            ? valueFor(row.ElementValue[0]?.[mapping.field], mapping)
            : null,
      });
    }
    all.sort((a, b) => Date.parse(a.validAt) - Date.parse(b.validAt));
    if (new Set(all.map((s) => s.validAt)).size !== all.length)
      issues.push(
        issue('invalid-response', 'CWA returned duplicate forecast times.'),
      );
    const samples = all.filter((sample) =>
      sample.time.kind === 'period'
        ? Date.parse(sample.time.range.end) > start &&
          Date.parse(sample.time.range.start) < end
        : Date.parse(sample.validAt) >= start &&
          Date.parse(sample.validAt) < end,
    );
    const nativeStep =
      mapping.field === 'WindSpeed' ||
      mapping.field === 'WindDirection' ||
      mapping.descriptor.kind === 'probability'
        ? 3 * HOUR
        : HOUR;
    if (
      nativeStep > request.maxTimeStepSeconds * 1000 ||
      all.some((sample, i) => {
        const previous = all[i - 1];
        return (
          previous &&
          Date.parse(sample.validAt) > start &&
          Date.parse(previous.validAt) < end &&
          Date.parse(sample.validAt) - Date.parse(previous.validAt) >
            request.maxTimeStepSeconds * 1000
        );
      })
    )
      issues.push(
        issue(
          'insufficient-resolution',
          'CWA native forecast spacing exceeds the requested temporal resolution.',
        ),
      );
    const first = all[0],
      last = all.at(-1);
    const lastEnd =
      last?.time.kind === 'period'
        ? Date.parse(last.time.range.end)
        : Date.parse(last?.validAt ?? '') + nativeStep;
    if (!first || Date.parse(first.validAt) > start || lastEnd < end)
      issues.push(
        issue(
          'outside-forecast-horizon',
          'CWA does not cover the complete requested time range.',
        ),
      );
    if (!samples.length || samples.some((s) => s.value === null))
      issues.push(
        issue(
          'missing-data',
          'A required CWA forecast value is missing or invalid.',
        ),
      );
    return [{ descriptor, samples }];
  });
  if (!series.some((s) => s.samples.some((v) => v.value !== null)))
    return unavailable(
      requested,
      issues.find((i) => i.code !== 'unknown-model-run') ??
        issue('missing-data', 'CWA returned no usable forecast evidence.'),
    );
  const unique = [...new Map(issues.map((i) => [i.code, i])).values()];
  return {
    status: unique.some((i) => i.code !== 'unknown-model-run')
      ? 'partial'
      : 'complete',
    location: {
      requested,
      coordinate: {
        latitude: township.Latitude,
        longitude: township.Longitude,
      },
      sourceLocationId: township.Geocode,
      distanceFromRequestedM,
      method: 'nearest-site',
    },
    provenance: {
      source: cwaSource,
      dataVersion: null,
      retrievedAt,
      attribution: [cwaAttribution],
    },
    issuedAt: null,
    series,
    issues: unique,
  };
};

export const normaliseCwa = (
  raw: unknown,
  site: Site,
  requested: RequestedLocation,
  request: ForecastRequest,
  retrievedAt: string,
): LocationForecastResult => {
  const parsed = envelope.safeParse(raw);
  const region = parsed.success ? parsed.data.records.Locations[0] : undefined;
  if (
    !parsed.success ||
    !region ||
    parsed.data.result.resource_id !== site.datasetId ||
    region.Dataid !== site.datasetId.slice(2)
  )
    return unavailable(
      requested,
      issue(
        'invalid-response',
        'CWA returned an invalid forecast structure or dataset identity.',
      ),
    );
  const matches = region.Location.filter(
    (l) => l.Geocode === site.geocode && l.LocationName === site.name,
  );
  if (matches.length !== 1 || !matches[0])
    return unavailable(
      requested,
      issue(
        'invalid-response',
        'CWA did not return the requested township exactly once.',
      ),
    );
  return normaliseTownship(matches[0], requested, request, retrievedAt);
};

export const createCwa = (
  options: Readonly<{
    apiKey: string;
    fetch?: (url: string, init: RequestInit) => Promise<Response>;
    now?: () => Date;
    timeoutMs?: number;
  }>,
): ForecastProvider => {
  const transport = options.fetch ?? ((url, init) => fetch(url, init));
  const now = options.now ?? (() => new Date());
  const timeoutMs = options.timeoutMs ?? 15_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new Error('Invalid CWA timeout.');
  return {
    source: cwaSource,
    getCapabilities: async () => ({
      available: mappings.map(({ descriptor }) => ({
        descriptor,
        timeStepSeconds: 10_800,
        forecastHorizonSeconds: 72 * 3600,
      })),
      maxLocationsPerUpstreamRequest: 40,
    }),
    getForecast: async (request, signal) => {
      const fail = (problem: ProviderIssue) =>
        request.locations.map((l) => unavailable(l, problem));
      if (!forecastRequestSchema.safeParse(request).success)
        return fail(issue('invalid-request', 'Invalid forecast request.'));
      if (signal.aborted)
        return fail(issue('cancelled', 'Forecast request was cancelled.'));
      if (!options.apiKey.trim())
        return fail(
          issue('not-configured', 'CWA credentials are not configured.'),
        );
      if (request.freshnessBasis !== 'retrieval-time')
        return fail(
          issue(
            'unknown-model-run',
            'CWA datastore forecasts cannot establish model-run freshness.',
          ),
        );
      if (request.required.some((d) => !mappingFor(d)))
        return fail(
          issue(
            'unsupported-variable',
            'CWA township forecasts cannot supply all requested quantities or statistics.',
          ),
        );
      const groups = new Map<
        string,
        { requested: RequestedLocation; site: Site }[]
      >();
      const results = new Map<string, LocationForecastResult>();
      for (const requested of request.locations) {
        const nearest = nearestCwaLocation(requested);
        if (!nearest || nearest.distanceM > request.maxLocationDistanceM) {
          results.set(
            requested.id,
            unavailable(
              requested,
              issue(
                'outside-coverage',
                'No CWA township representative point is within the permitted distance.',
              ),
            ),
          );
          continue;
        }
        const group = groups.get(nearest.site.datasetId) ?? [];
        group.push({ requested, site: nearest.site });
        groups.set(nearest.site.datasetId, group);
      }
      let terminal: ProviderIssue | undefined;
      // Serial county batches avoid burst traffic and stop after credential/quota failure.
      for (const [datasetId, group] of groups) {
        let problem = signal.aborted
          ? issue('cancelled', 'Forecast request was cancelled.')
          : terminal;
        let raw: unknown;
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
            const url = new URL(
              `https://opendata.cwa.gov.tw/api/v1/rest/datastore/${datasetId}`,
            );
            url.searchParams.set('format', 'JSON');
            url.searchParams.set(
              'LocationName',
              [...new Set(group.map((g) => g.site.name))].join(','),
            );
            url.searchParams.set(
              'ElementName',
              [
                ...new Set(request.required.map((d) => mappingFor(d)?.element)),
              ].join(','),
            );
            url.searchParams.set('sort', 'time');
            // Retrieve native bounds, including periods overlapping the request start.
            const response = await transport(url.href, {
              headers: {
                Authorization: options.apiKey.trim(),
                Accept: 'application/json',
              },
              signal: controller.signal,
              redirect: 'manual',
            });
            if (response.ok) {
              try {
                raw = await readBoundedJson(response, 2_000_000);
              } catch {
                problem = issue(
                  'invalid-response',
                  'CWA returned unreadable or oversized forecast data.',
                );
              }
            } else {
              problem = issue(
                response.status === 401 || response.status === 403
                  ? 'unauthorized'
                  : response.status === 429
                    ? 'rate-limited'
                    : 'upstream-unavailable',
                'CWA could not supply a forecast.',
              );
              if (response.status === 429) {
                const retry = response.headers.get('Retry-After');
                const seconds =
                  retry && /^\d+$/.test(retry)
                    ? Number(retry)
                    : retry
                      ? Math.ceil((Date.parse(retry) - now().getTime()) / 1000)
                      : NaN;
                if (Number.isFinite(seconds) && seconds >= 0)
                  problem = { ...problem, retryAfterSeconds: seconds };
              }
              if (
                problem.code === 'unauthorized' ||
                problem.code === 'rate-limited'
              )
                terminal = problem;
              await response.body?.cancel();
            }
          }
        } catch {
          problem = issue('upstream-unavailable', 'CWA could not be reached.');
        } finally {
          clearTimeout(timeout);
          signal.removeEventListener('abort', abort);
        }
        if (signal.aborted)
          problem = issue('cancelled', 'Forecast request was cancelled.');
        else if (timedOut)
          problem = issue(
            'timeout',
            'CWA did not respond before the deadline.',
          );
        const retrievedAt = now().toISOString();
        for (const { requested, site } of group)
          results.set(
            requested.id,
            problem
              ? unavailable(requested, problem)
              : normaliseCwa(raw, site, requested, request, retrievedAt),
          );
      }
      return request.locations.map(
        (l) =>
          results.get(l.id) ??
          unavailable(l, issue('missing-data', 'No CWA result was returned.')),
      );
    },
  };
};
