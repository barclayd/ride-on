import { z } from 'zod';
import { haversineKm } from '../geo.ts';
import type { ForecastCache } from './cache.ts';
import type {
  ForecastDescriptor,
  ForecastProvider,
  ForecastRequest,
  ForecastSample,
  LocationForecastResult,
  ProviderIssue,
  RequestedLocation,
} from './contracts.ts';
import {
  descriptorKey,
  ensembleDescriptors as weather,
} from './descriptors.ts';
import { readBoundedJson } from './http.ts';
import { metOfficeSkyCondition } from './met-office-symbols.ts';
import {
  coordinateSchema,
  forecastRequestSchema,
  utcInstant,
} from './validation.ts';

const HOUR = 3_600_000;
export const BPF_ENDPOINT =
  'https://data.hub.api.metoffice.gov.uk/mo-blended-prob-forecast-feature-svc/2.0.0';
const source = {
  providerId: 'met-office-bpf',
  productId: 'uk-blended-probabilistic-v2',
  adapterVersion: '1',
} as const;
const probabilityField =
  'probabilityOfLweThicknessOfPrecipitationAmountAboveThresholdSumPt01h';
type Mapping = {
  field: string;
  descriptor: ForecastDescriptor;
  unit: string;
  observed: string;
  convert: (value: number) => number | null;
  period?: 'maximum' | 'event' | 'categorical-summary';
};
const unchanged = (value: number) => value;
const mappings: readonly Mapping[] = [
  {
    field: 'weatherCodePt01h',
    descriptor: weather.skyCondition,
    unit: '1',
    observed: 'weather_code',
    convert: metOfficeSkyCondition,
    period: 'categorical-summary',
  },
  {
    field: 'airTemperature1p5m',
    descriptor: weather.airTemperature,
    unit: 'K',
    observed: 'air_temperature',
    convert: (v) => v - 273.15,
  },
  {
    field: 'cloudAreaFraction',
    descriptor: weather.totalCloudCover,
    unit: '1',
    observed: 'cloud_area_fraction',
    convert: unchanged,
  },
  {
    field: 'windSpeed10m',
    descriptor: weather.windSpeed,
    unit: 'm s-1',
    observed: 'wind_speed',
    convert: unchanged,
  },
  {
    field: 'windFromDirection10mMean',
    descriptor: weather.windDirection,
    unit: 'degrees',
    observed: 'wind_from_direction',
    convert: (v) => v % 360,
  },
  {
    field: 'windSpeedOfGust10mMaximumPt01h',
    descriptor: weather.windGust,
    unit: 'm s-1',
    observed: 'wind_speed_of_gust',
    convert: unchanged,
    period: 'maximum',
  },
  {
    field: 'lwePrecipitationRate',
    descriptor: weather.precipitationRate,
    unit: 'm s-1',
    observed: 'lwe_precipitation_rate',
    convert: (v) => v * 3_600_000,
  },
  {
    field: probabilityField,
    descriptor: weather.precipitationProbability,
    unit: '1',
    observed:
      'probability_of_lwe_thickness_of_precipitation_amount_above_threshold',
    convert: unchanged,
    period: 'event',
  },
];
const label = z.object({ label: z.object({ en: z.string() }) });
const envelope = z.object({
  type: z.literal('CoverageCollection'),
  domainType: z.literal('PointSeries'),
  referencing: z.array(
    z.object({
      coordinates: z.array(z.string()),
      system: z.object({
        id: z.string().optional(),
        label: z.object({ en: z.string() }).optional(),
      }),
    }),
  ),
  coverages: z.array(z.object({ id: z.string() }).passthrough()).max(32),
});
const coverageSchema = z.object({
  type: z.literal('Coverage'),
  id: z.string(),
  parameters: z.record(
    z.string(),
    z.object({
      observedProperty: label,
      unit: z.object({ symbol: z.string() }),
      custom: z
        .object({ cellMethods: label.optional(), timePeriod: label.optional() })
        .optional(),
    }),
  ),
  domain: z.object({
    axes: z.record(
      z.string(),
      z.object({
        values: z
          .array(z.union([z.number(), z.string()]))
          .min(1)
          .max(1000),
        bounds: z.array(utcInstant).optional(),
      }),
    ),
  }),
  ranges: z.record(
    z.string(),
    z.object({
      type: z.literal('NdArray'),
      dataType: z.literal('float'),
      axisNames: z.array(z.string()).min(1).max(8),
      shape: z.array(z.number().int().positive()).min(1).max(8),
      values: z.array(z.number().nullable()).max(200_000),
    }),
  ),
});
const sitesSchema = z.object({
  type: z.literal('FeatureCollection'),
  features: z
    .array(
      z.object({
        type: z.literal('Feature'),
        id: z.string().regex(/^[a-zA-Z0-9:_.-]{1,100}$/),
        geometry: z.object({
          type: z.literal('Point'),
          coordinates: z
            .tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)])
            .rest(z.number()),
        }),
      }),
    )
    .min(1)
    .max(20_000),
});
const sitesCacheSchema = z.object({
  retrievedAt: utcInstant,
  data: sitesSchema,
});
const sitesCacheKey = 'weather:bpf-v2:uk-sites:v1';
const problem = (
  code: ProviderIssue['code'],
  message: string,
): ProviderIssue => ({ code, message });
const unavailable = (
  requested: RequestedLocation,
  issue: ProviderIssue,
): LocationForecastResult => ({
  status: 'unavailable',
  requested,
  source,
  issues: [issue],
});
const unknownRun = problem(
  'unknown-model-run',
  'This product does not expose a model-run timestamp; retrieval freshness cannot verify model age.',
);

/** Decode the advertised dimensions rather than assuming percentile/time array order. */
const decode = (raw: z.infer<typeof envelope>, mapping: Mapping) => {
  const matches = raw.coverages.filter((c) => c.id === mapping.field);
  if (!matches.length) return null;
  if (matches.length !== 1) throw new Error('Duplicate coverage');
  const coverage = coverageSchema.parse(matches[0]);
  const axes = coverage.domain.axes;
  const metadata = coverage.parameters[mapping.field];
  const range = coverage.ranges[mapping.field];
  if (
    !metadata ||
    metadata.unit.symbol !== mapping.unit ||
    metadata.observedProperty.label.en !== mapping.observed ||
    !range
  )
    throw new Error('Unexpected parameter');
  if (
    !raw.referencing.some(
      (r) =>
        r.coordinates.join(',') === 'x,y,z' &&
        r.system.id === 'https://www.opengis.net/def/crs/EPSG/0/4979',
    )
  )
    throw new Error('Unknown coordinate system');
  const coordinate = coordinateSchema.parse({
    longitude: axes.x?.values[0],
    latitude: axes.y?.values[0],
  });
  const site = axes.locationId?.values[0];
  if (
    typeof site !== 'string' ||
    !site ||
    ['x', 'y', 'locationId'].some((key) => axes[key]?.values.length !== 1)
  )
    throw new Error('Not a point');
  const times = z.array(utcInstant).min(1).parse(axes.t?.values);
  if (
    times.some(
      (t, i) =>
        Date.parse(t) % HOUR !== 0 ||
        (i > 0 && Date.parse(t) <= Date.parse(times[i - 1] ?? '')),
    )
  )
    throw new Error('Invalid time axis');
  const probability = mapping.descriptor.kind === 'probability';
  const selectionAxis = probability ? `${mapping.field}Values` : 'percentiles';
  const selection = axes[selectionAxis]?.values;
  if (selection && new Set(selection.map(String)).size !== selection.length)
    throw new Error('Duplicate statistic labels');
  const selected =
    selection?.findIndex((v) =>
      probability ? v === '>0.0' : Number(v) === 50,
    ) ?? -1;
  if (selected < 0) return null;
  if (
    probability &&
    !raw.referencing.some(
      (r) =>
        r.coordinates.includes(selectionAxis) &&
        r.system.label?.en.endsWith('values (m)'),
    )
  )
    throw new Error('Unverified threshold units');
  if (
    mapping.descriptor.kind === 'scalar' &&
    mapping.descriptor.statistic.kind === 'ensemble-mean' &&
    metadata.custom?.cellMethods?.label.en !== 'realization: mean'
  )
    throw new Error('Unverified ensemble mean');
  if (
    mapping.period &&
    (metadata.custom?.timePeriod?.label.en !== 'PT01H' ||
      (mapping.period !== 'categorical-summary' &&
        !metadata.custom.cellMethods?.label.en.startsWith(
          mapping.period === 'event' ? 'time: sum' : 'time: maximum',
        )))
  )
    throw new Error('Unverified period');
  if (
    range.axisNames.length !== range.shape.length ||
    new Set(range.axisNames).size !== range.axisNames.length ||
    !range.axisNames.includes('t') ||
    !range.axisNames.includes(selectionAxis) ||
    range.shape.reduce((a, b) => a * b, 1) !== range.values.length
  )
    throw new Error('Invalid dimensions');
  for (const [i, name] of range.axisNames.entries()) {
    if (
      range.shape[i] !== axes[name]?.values.length ||
      (!['t', selectionAxis].includes(name) && range.shape[i] !== 1)
    )
      throw new Error('Unexpected dimension');
  }
  const bounds = axes.t?.bounds;
  if (!mapping.period && bounds) throw new Error('Unexpected instant bounds');
  if (mapping.period && bounds?.length !== times.length * 2)
    throw new Error('Missing interval bounds');
  const samples: ForecastSample[] = times.map((at, timeIndex) => {
    let offset = 0;
    for (const [i, name] of range.axisNames.entries())
      offset =
        offset * (range.shape[i] ?? 1) +
        (name === 't' ? timeIndex : name === selectionAxis ? selected : 0);
    const rawValue = range.values[offset];
    const fraction = probability || mapping.field === 'cloudAreaFraction';
    const direction = mapping.field === 'windFromDirection10mMean';
    const value =
      rawValue != null &&
      (rawValue >= 0 ||
        (mapping.descriptor.kind === 'category' && rawValue === -1)) &&
      (!fraction || rawValue <= 1) &&
      (!direction || rawValue <= 360)
        ? mapping.convert(rawValue)
        : null;
    if (!mapping.period)
      return { validAt: at, time: { kind: 'instant', at }, value };
    const start = bounds?.[timeIndex * 2];
    const end = bounds?.[timeIndex * 2 + 1];
    if (
      !start ||
      !end ||
      Date.parse(end) !== Date.parse(at) ||
      Date.parse(end) - Date.parse(start) !== HOUR
    )
      throw new Error('Invalid hourly interval');
    return {
      validAt: at,
      value,
      time: {
        kind: 'period',
        aggregation: mapping.period,
        range: { start, end },
      },
    };
  });
  return {
    coordinate,
    site,
    series: { descriptor: mapping.descriptor, samples },
  };
};

export const normaliseBpf = (
  payloads: readonly unknown[],
  requested: RequestedLocation,
  request: ForecastRequest,
  retrievedAt: string,
): LocationForecastResult => {
  if (request.freshnessBasis !== 'retrieval-time')
    return unavailable(requested, unknownRun);
  try {
    const envelopes = payloads.map((raw) => envelope.parse(raw));
    const issues: ProviderIssue[] = [unknownRun];
    const decoded = request.required.flatMap((descriptor) => {
      const mapping = mappings.find(
        (m) => descriptorKey(m.descriptor) === descriptorKey(descriptor),
      );
      if (!mapping) {
        issues.push(
          problem(
            'unsupported-statistic',
            'The requested quantity or statistic is unsupported.',
          ),
        );
        return [];
      }
      const containing = envelopes.filter((e) =>
        e.coverages.some((c) => c.id === mapping.field),
      );
      if (containing.length > 1) throw new Error('Duplicate variable');
      const result = containing[0] ? decode(containing[0], mapping) : null;
      if (!result) {
        issues.push(
          problem(
            'missing-data',
            'A required variable or selected statistic is missing.',
          ),
        );
        return [];
      }
      const times = result.series.samples.map((s) => Date.parse(s.validAt));
      const start = Date.parse(request.range.start),
        end = Date.parse(request.range.end);
      for (
        let at = mapping.period
          ? (Math.floor(start / HOUR) + 1) * HOUR
          : Math.ceil(start / HOUR) * HOUR;
        at < end + (mapping.period ? HOUR : 0);
        at += HOUR
      ) {
        if (!times.includes(at)) {
          issues.push(
            problem(
              at < (times[0] ?? Infinity) || at > (times.at(-1) ?? -Infinity)
                ? 'outside-forecast-horizon'
                : 'missing-data',
              'Required hourly forecast evidence is missing.',
            ),
          );
          break;
        }
      }
      if (
        request.maxTimeStepSeconds < 3600 ||
        times.some(
          (at, i) =>
            i > 0 &&
            at > start &&
            (times[i - 1] ?? Infinity) < end &&
            at - (times[i - 1] ?? at) > request.maxTimeStepSeconds * 1000,
        )
      )
        issues.push(
          problem(
            'insufficient-resolution',
            'This adapter requires hourly forecasts.',
          ),
        );
      if (result.series.samples.some((s) => s.value === null))
        issues.push(
          problem(
            'missing-data',
            'A required forecast value is missing or invalid.',
          ),
        );
      return [result];
    });
    const first = decoded[0];
    if (!first)
      return unavailable(
        requested,
        issues[1] ??
          problem('missing-data', 'No forecast evidence was returned.'),
      );
    if (
      decoded.some(
        (d) =>
          d.site !== first.site ||
          d.coordinate.latitude !== first.coordinate.latitude ||
          d.coordinate.longitude !== first.coordinate.longitude,
      )
    )
      throw new Error('Inconsistent sites');
    const distance =
      haversineKm(
        [requested.coordinate.latitude, requested.coordinate.longitude],
        [first.coordinate.latitude, first.coordinate.longitude],
      ) * 1000;
    if (distance > request.maxLocationDistanceM)
      return unavailable(
        requested,
        problem(
          'outside-coverage',
          'The forecast site is too far from the requested location.',
        ),
      );
    const unique = [...new Map(issues.map((i) => [i.code, i])).values()];
    return {
      status: unique.some((i) => i.code !== 'unknown-model-run')
        ? 'partial'
        : 'complete',
      location: {
        requested,
        coordinate: first.coordinate,
        sourceLocationId: first.site,
        distanceFromRequestedM: distance,
        method: 'nearest-site',
      },
      provenance: {
        source,
        dataVersion: null,
        retrievedAt,
        attribution: [
          {
            text: 'Powered by Met Office data',
            url: 'https://www.metoffice.gov.uk/',
          },
        ],
      },
      issuedAt: null,
      series: decoded.map((d) => d.series),
      issues: unique,
    };
  } catch {
    return unavailable(
      requested,
      problem(
        'invalid-response',
        'Met Office returned invalid forecast dimensions, metadata, units or intervals.',
      ),
    );
  }
};

export const createMetOfficeBpf = (options: {
  apiKey: string;
  cache?: ForecastCache;
  now?: () => Date;
  timeoutMs?: number;
  concurrency?: number;
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
}): ForecastProvider => {
  const transport = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date());
  const timeoutMs = options.timeoutMs ?? 10_000;
  const concurrency = options.concurrency ?? 4;
  if (
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0 ||
    !Number.isInteger(concurrency) ||
    concurrency < 1 ||
    concurrency > 8
  )
    throw new Error('Invalid weather transport configuration.');
  return {
    source,
    getCapabilities: async () => ({
      available: mappings.map(({ descriptor }) => ({
        descriptor,
        timeStepSeconds: 3600,
        forecastHorizonSeconds: 5 * 24 * 3600,
      })),
      maxLocationsPerUpstreamRequest: 1,
    }),
    getForecast: async (request, signal) => {
      const unsupported = request.required.some(
        (d) =>
          !mappings.some(
            (m) => descriptorKey(m.descriptor) === descriptorKey(d),
          ),
      );
      const initial = !forecastRequestSchema.safeParse(request).success
        ? problem('invalid-request', 'Invalid forecast request.')
        : !options.apiKey.trim()
          ? problem(
              'not-configured',
              'Met Office BPF credentials are not configured.',
            )
          : request.freshnessBasis !== 'retrieval-time'
            ? unknownRun
            : unsupported
              ? problem(
                  'unsupported-statistic',
                  'BPF requires supported ensemble summaries and threshold probabilities.',
                )
              : null;
      if (initial) return request.locations.map((l) => unavailable(l, initial));
      if (signal.aborted)
        return request.locations.map((l) =>
          unavailable(
            l,
            problem('cancelled', 'Forecast request was cancelled.'),
          ),
        );
      let catalog: z.infer<typeof sitesSchema> | undefined;
      if (options.cache) {
        try {
          const saved = await options.cache.get(sitesCacheKey);
          const parsed = saved
            ? sitesCacheSchema.safeParse(JSON.parse(saved))
            : null;
          if (parsed?.success) {
            const age = now().getTime() - Date.parse(parsed.data.retrievedAt);
            if (age >= 0 && age < 86_400_000) catalog = parsed.data.data;
          }
        } catch {
          /* A cache failure should not hide usable forecasts. */
        }
      }
      if (!catalog) {
        const timeout = AbortSignal.timeout(timeoutMs);
        try {
          const response = await transport(
            `${BPF_ENDPOINT}/collections/uk-spot-percentiles/instances/blended/locations`,
            {
              headers: {
                apikey: options.apiKey,
                Accept: 'application/geo+json',
              },
              signal: AbortSignal.any([signal, timeout]),
              redirect: 'manual',
            },
          );
          if (!response.ok || response.status === 204) {
            await response.body?.cancel();
            const issue = problem(
              response.status === 401 || response.status === 403
                ? 'unauthorized'
                : response.status === 429
                  ? 'rate-limited'
                  : 'upstream-unavailable',
              'Met Office BPF could not supply the site catalogue.',
            );
            const retry = response.headers.get('Retry-After');
            const seconds =
              retry && /^\d+$/.test(retry)
                ? Number(retry)
                : retry
                  ? Math.ceil((Date.parse(retry) - now().getTime()) / 1000)
                  : NaN;
            return request.locations.map((l) =>
              unavailable(
                l,
                issue.code === 'rate-limited' &&
                  Number.isFinite(seconds) &&
                  seconds >= 0
                  ? { ...issue, retryAfterSeconds: seconds }
                  : issue,
              ),
            );
          }
          catalog = sitesSchema.parse(
            await readBoundedJson(response, 3_000_000),
          );
          try {
            await options.cache?.put(
              sitesCacheKey,
              JSON.stringify({
                retrievedAt: now().toISOString(),
                data: catalog,
              }),
              86_400,
            );
          } catch {
            /* Optional cache. */
          }
        } catch {
          return request.locations.map((l) =>
            unavailable(
              l,
              problem(
                signal.aborted
                  ? 'cancelled'
                  : timeout.aborted
                    ? 'timeout'
                    : 'invalid-response',
                'Met Office BPF site catalogue could not be read.',
              ),
            ),
          );
        }
      }
      const groups = new Map<string, RequestedLocation[]>();
      const results = new Map<string, LocationForecastResult>();
      for (const location of request.locations) {
        let nearest: string | undefined;
        let closest = request.maxLocationDistanceM;
        for (const site of catalog.features) {
          const [longitude, latitude] = site.geometry.coordinates;
          // Latitude bounds prune nearly all sites before the spherical distance calculation.
          if (
            Math.abs(latitude - location.coordinate.latitude) * 111_000 >
            request.maxLocationDistanceM
          )
            continue;
          const distance =
            haversineKm(
              [latitude, longitude],
              [location.coordinate.latitude, location.coordinate.longitude],
            ) * 1000;
          if (distance <= closest) {
            closest = distance;
            nearest = site.id;
          }
        }
        if (!nearest)
          results.set(
            location.id,
            unavailable(
              location,
              problem(
                'outside-coverage',
                'No UK forecast site lies within the permitted distance.',
              ),
            ),
          );
        else groups.set(nearest, [...(groups.get(nearest) ?? []), location]);
      }
      const queue = [...groups.entries()];
      let cursor = 0;
      let terminal: ProviderIssue | undefined;
      const run = async () => {
        while (cursor < queue.length) {
          const entry = queue[cursor++];
          const siteId = entry?.[0];
          const group = entry?.[1];
          const first = group?.[0];
          if (!first) continue;
          let issue = signal.aborted
            ? problem('cancelled', 'Forecast request was cancelled.')
            : terminal;
          const raw: unknown[] = [];
          const timeout = AbortSignal.timeout(timeoutMs);
          const abort = AbortSignal.any([signal, timeout]);
          for (const collection of ['percentiles', 'probabilities']) {
            if (issue) break;
            const selected = mappings.filter(
              (m) =>
                (m.descriptor.kind === 'probability') ===
                  (collection === 'probabilities') &&
                request.required.some(
                  (d) => descriptorKey(d) === descriptorKey(m.descriptor),
                ),
            );
            if (!selected.length) continue;
            try {
              if (terminal) {
                issue = terminal;
                break;
              }
              const url = new URL(
                `${BPF_ENDPOINT}/collections/uk-spot-${collection}/instances/blended/locations/${encodeURIComponent(siteId ?? '')}`,
              );
              url.searchParams.set(
                'datetime',
                `${request.range.start}/${request.range.end}`,
              );
              url.searchParams.set(
                'parameter-name',
                selected.map((m) => m.field).join(','),
              );
              const response = await transport(url.href, {
                headers: {
                  apikey: options.apiKey,
                  Accept: 'application/prs.coverage+json',
                },
                signal: abort,
                redirect: 'manual',
              });
              if (!response.ok || response.status === 204) {
                issue = problem(
                  response.status === 401 || response.status === 403
                    ? 'unauthorized'
                    : response.status === 429
                      ? 'rate-limited'
                      : response.status === 204
                        ? 'missing-data'
                        : 'upstream-unavailable',
                  'Met Office BPF could not supply the requested forecast.',
                );
                const retry = response.headers.get('Retry-After');
                const seconds =
                  retry && /^\d+$/.test(retry)
                    ? Number(retry)
                    : retry
                      ? Math.ceil((Date.parse(retry) - now().getTime()) / 1000)
                      : NaN;
                if (
                  issue.code === 'rate-limited' &&
                  Number.isFinite(seconds) &&
                  seconds >= 0
                )
                  issue = { ...issue, retryAfterSeconds: seconds };
                if (
                  issue.code === 'unauthorized' ||
                  issue.code === 'rate-limited'
                )
                  terminal = issue;
                await response.body?.cancel();
              } else {
                try {
                  raw.push(await readBoundedJson(response, 1_000_000));
                } catch {
                  issue = problem(
                    'invalid-response',
                    'Met Office returned an invalid or oversized forecast.',
                  );
                }
              }
            } catch {
              issue = problem(
                signal.aborted
                  ? 'cancelled'
                  : timeout.aborted
                    ? 'timeout'
                    : 'upstream-unavailable',
                'Met Office BPF request did not complete.',
              );
            }
            if (abort.aborted)
              issue = problem(
                signal.aborted ? 'cancelled' : 'timeout',
                'Met Office BPF request did not complete.',
              );
          }
          const retrievedAt = now().toISOString();
          for (const location of group ?? []) {
            const result = issue
              ? unavailable(location, issue)
              : normaliseBpf(raw, location, request, retrievedAt);
            results.set(
              location.id,
              result.status !== 'unavailable' &&
                result.location.sourceLocationId !== siteId
                ? unavailable(
                    location,
                    problem(
                      'invalid-response',
                      'The returned forecast site does not match the requested site.',
                    ),
                  )
                : result,
            );
          }
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(concurrency, queue.length) }, run),
      );
      return request.locations.map(
        (l) =>
          results.get(l.id) ??
          unavailable(l, problem('missing-data', 'No result was returned.')),
      );
    },
  };
};
