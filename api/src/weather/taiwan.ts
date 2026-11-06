import type {
  ForecastDescriptor,
  ForecastProvider,
  ForecastRequest,
  ForecastSample,
  ForecastSeries,
  LocationForecastResult,
  ProviderIssue,
  RequestedLocation,
} from './contracts.ts';
import { cwaPrecipitationProbability } from './cwa.ts';
import {
  descriptorKey,
  optionalDisplayDescriptors,
  weatherDescriptors as weather,
} from './descriptors.ts';
import { isTaiwanCoordinate } from './taiwan-region.ts';
import { forecastRequestSchema } from './validation.ts';

const HOUR = 3_600_000;
export const taiwanSource = {
  providerId: 'taiwan-weather',
  productId: 'cwa-township-apple-hourly',
  adapterVersion: '1',
} as const;
/** This is explicitly a composite occurrence event, not an hourly CWA PoP.
 * Each sample keeps its native event bounds and its original descriptor in evidence. */
export const taiwanPrecipitationProbability = {
  kind: 'probability',
  unit: 'fraction',
  event: {
    kind: 'occurrence',
    phenomenon: 'precipitation',
    definition:
      'CWA: at least 0.1 mm during the native three-hour period; where unavailable, Apple Weather: provider-defined occurrence during the native hour. See field evidence for each event and period.',
  },
} as const satisfies ForecastDescriptor;
const supported = [
  ...Object.values(weather).filter(
    (d) => d !== weather.precipitationProbability,
  ),
  taiwanPrecipitationProbability,
  ...optionalDisplayDescriptors,
];
const cwaFields = [
  weather.airTemperature,
  weather.feelsLikeTemperature,
  weather.windSpeed,
  weather.windDirection,
  cwaPrecipitationProbability,
];
type Forecast = Exclude<LocationForecastResult, { status: 'unavailable' }>;
type Evidence = NonNullable<ForecastSeries['evidence']>[number];
type Selection = {
  sample: ForecastSample;
  origin: Forecast;
  descriptor: ForecastDescriptor;
  method: Evidence['method'];
  nativeTimeStepSeconds: number;
};
const same = (a: ForecastDescriptor, b: ForecastDescriptor) =>
  descriptorKey(a) === descriptorKey(b);
const usable = (result: LocationForecastResult | undefined): Forecast | null =>
  result &&
  result.status !== 'unavailable' &&
  !result.issues.some((i) =>
    [
      'invalid-response',
      'stale-data',
      'insufficient-resolution',
      'outside-coverage',
    ].includes(i.code),
  )
    ? result
    : null;
const seriesFor = (result: Forecast | null, descriptor: ForecastDescriptor) =>
  result?.series.find((s) => same(s.descriptor, descriptor));
const nativeAt = (
  result: Forecast | null,
  descriptor: ForecastDescriptor,
  at: number,
): Selection | null => {
  if (!result) return null;
  const sample = seriesFor(result, descriptor)?.samples.find((s) =>
    s.time.kind === 'period'
      ? Date.parse(s.time.range.start) <= at &&
        Date.parse(s.time.range.end) >= at + HOUR
      : Date.parse(s.validAt) === at,
  );
  return sample?.value == null
    ? null
    : {
        sample,
        origin: result,
        descriptor,
        method: 'native',
        nativeTimeStepSeconds:
          sample.time.kind === 'period'
            ? (Date.parse(sample.time.range.end) -
                Date.parse(sample.time.range.start)) /
              1000
            : 3600,
      };
};
/** Bounded interpolation of CWA instants. Missing readings, >3h gaps and
 * extrapolation never become usable values. Direction follows the shortest arc. */
const cwaInstant = (
  result: Forecast | null,
  descriptor: ForecastDescriptor,
  at: number,
): Selection | null => {
  if (!result) return null;
  const points = seriesFor(result, descriptor)?.samples ?? [];
  const index = points.findIndex((s) => Date.parse(s.validAt) >= at);
  const right = points[index],
    left = points[index - 1];
  if (right?.time.kind !== 'instant' || right.value === null) return null;
  const step = Math.min(
    ...[left, points[index + 1]].flatMap((p) =>
      p
        ? [Math.abs(Date.parse(p.validAt) - Date.parse(right.validAt)) / 1000]
        : [],
    ),
  );
  if (Date.parse(right.validAt) === at)
    return {
      sample: right,
      origin: result,
      descriptor,
      method: 'native',
      nativeTimeStepSeconds: Number.isFinite(step) && step > 0 ? step : 10800,
    };
  if (left?.time.kind !== 'instant' || left.value === null) return null;
  const span = Date.parse(right.validAt) - Date.parse(left.validAt);
  if (span <= 0 || span > 3 * HOUR) return null;
  const fraction = (at - Date.parse(left.validAt)) / span;
  const circular = same(descriptor, weather.windDirection);
  const delta = circular
    ? ((right.value - left.value + 540) % 360) - 180
    : right.value - left.value;
  // Exactly opposite directions do not identify a unique turn through north/south.
  if (circular && Math.abs(delta) === 180) return null;
  const value = left.value + fraction * delta;
  const iso = new Date(at).toISOString();
  return {
    sample: {
      validAt: iso,
      time: { kind: 'instant', at: iso },
      value: circular ? (value + 360) % 360 : value,
    },
    origin: result,
    descriptor,
    method: circular ? 'circular-interpolation' : 'linear-interpolation',
    nativeTimeStepSeconds: span / 1000,
  };
};
const failure = (
  requested: RequestedLocation,
  problem: ProviderIssue,
): LocationForecastResult => ({
  status: 'unavailable',
  requested,
  source: taiwanSource,
  issues: [problem],
});
const problem = (
  code: ProviderIssue['code'],
  message: string,
): ProviderIssue => ({ code, message });

export const createTaiwanWeather = (options: {
  cwa: ForecastProvider;
  apple: ForecastProvider;
  now?: () => Date;
}): ForecastProvider => ({
  source: taiwanSource,
  getCapabilities: async () => ({
    available: [
      ...new Map(supported.map((d) => [descriptorKey(d), d])).values(),
    ].map((descriptor) => ({
      descriptor,
      timeStepSeconds: same(descriptor, taiwanPrecipitationProbability)
        ? 10800
        : 3600,
      forecastHorizonSeconds: 240 * 3600,
    })),
    maxLocationsPerUpstreamRequest: 1,
  }),
  getForecast: async (request, signal) => {
    const invalid = !forecastRequestSchema.safeParse(request).success
      ? problem('invalid-request', 'Invalid Taiwan forecast request.')
      : request.required.some((d) => !supported.some((s) => same(d, s)))
        ? problem(
            'unsupported-variable',
            'The Taiwan composite does not supply the requested statistic.',
          )
        : request.maxTimeStepSeconds <
            (request.required.some((d) =>
              same(d, taiwanPrecipitationProbability),
            )
              ? 10800
              : 3600)
          ? problem(
              'insufficient-resolution',
              'CWA rain probability applies to a native three-hour event.',
            )
          : request.freshnessBasis !== 'retrieval-time'
            ? problem(
                'unknown-model-run',
                'The Taiwan sources require explicit retrieval-time freshness.',
              )
            : null;
    if (invalid) return request.locations.map((l) => failure(l, invalid));
    const locations = request.locations.filter((l) =>
      isTaiwanCoordinate(l.coordinate),
    );
    if (!locations.length)
      return request.locations.map((l) =>
        failure(
          l,
          problem(
            'outside-coverage',
            'The Taiwan weather product covers Taiwan land routes.',
          ),
        ),
      );
    const now = (options.now ?? (() => new Date()))();
    const start = Math.floor(Date.parse(request.range.start) / HOUR) * HOUR;
    const end = Math.ceil(Date.parse(request.range.end) / HOUR) * HOUR;
    const cwaStart = Math.max(start - 3 * HOUR, now.getTime() - 3 * HOUR);
    const cwaEnd = Math.max(
      cwaStart + HOUR,
      Math.min(end + 3 * HOUR, now.getTime() + 84 * HOUR),
    );
    const appleRequired = request.required.map((d) =>
      same(d, taiwanPrecipitationProbability)
        ? weather.precipitationProbability
        : d,
    );
    const call = async (provider: ForecastProvider, input: ForecastRequest) => {
      try {
        return await provider.getForecast(input, signal);
      } catch {
        return [] as readonly LocationForecastResult[];
      }
    };
    const [cwaResults, appleResults] = await Promise.all([
      call(options.cwa, {
        ...request,
        locations,
        required: cwaFields,
        maxTimeStepSeconds: 10800,
        range: {
          start: new Date(cwaStart).toISOString(),
          end: new Date(cwaEnd).toISOString(),
        },
      }),
      call(options.apple, {
        ...request,
        locations,
        required: appleRequired,
        maxTimeStepSeconds: 3600,
      }),
    ]);
    const byId = (results: readonly LocationForecastResult[]) =>
      new Map(
        results.map((r) => [
          r.status === 'unavailable' ? r.requested.id : r.location.requested.id,
          r,
        ]),
      );
    const cw = byId(cwaResults),
      ap = byId(appleResults);
    return request.locations.map((requested): LocationForecastResult => {
      if (signal.aborted)
        return failure(
          requested,
          problem('cancelled', 'Forecast request was cancelled.'),
        );
      if (!isTaiwanCoordinate(requested.coordinate))
        return failure(
          requested,
          problem(
            'outside-coverage',
            'The Taiwan weather product covers Taiwan land routes.',
          ),
        );
      const cwa = usable(cw.get(requested.id)),
        apple = usable(ap.get(requested.id));
      if (!apple) {
        const issues = ap.get(requested.id)?.issues;
        return failure(
          requested,
          issues?.find((i) => i.code !== 'unknown-model-run') ??
            problem(
              'upstream-unavailable',
              'Apple Weather could not supply the required Taiwan forecast supplements.',
            ),
        );
      }
      const descriptors = [
        ...new Map(
          [...request.required, ...optionalDisplayDescriptors].map((d) => [
            descriptorKey(d),
            d,
          ]),
        ).values(),
      ];
      let missing = false,
        outside = false;
      const series: ForecastSeries[] = descriptors.map((descriptor) => {
        const samples: ForecastSample[] = [];
        const evidence = new Map<
          string,
          { selection: Selection; periods: { start: string; end: string }[] }
        >();
        let lastSample = '';
        for (let at = start; at < end; at += HOUR) {
          let chosen: Selection | null = null;
          if (same(descriptor, taiwanPrecipitationProbability))
            chosen =
              nativeAt(cwa, cwaPrecipitationProbability, at) ??
              nativeAt(apple, weather.precipitationProbability, at);
          else {
            if (
              same(descriptor, weather.windSpeed) ||
              same(descriptor, weather.windDirection)
            ) {
              const speed = cwaInstant(cwa, weather.windSpeed, at),
                direction = cwaInstant(cwa, weather.windDirection, at);
              chosen =
                speed && direction
                  ? same(descriptor, weather.windSpeed)
                    ? speed
                    : direction
                  : null;
            } else if (
              same(descriptor, weather.airTemperature) ||
              same(descriptor, weather.feelsLikeTemperature)
            )
              chosen = cwaInstant(cwa, descriptor, at);
            chosen ??= nativeAt(apple, descriptor, at);
          }
          const iso = new Date(at).toISOString();
          if (!chosen) {
            samples.push({
              validAt: iso,
              time: { kind: 'instant', at: iso },
              value: null,
            });
            continue;
          }
          const sampleKey = JSON.stringify(chosen.sample);
          if (sampleKey !== lastSample) samples.push(chosen.sample);
          lastSample = sampleKey;
          const key = JSON.stringify([
            chosen.origin.provenance.source,
            chosen.descriptor,
            chosen.method,
            chosen.nativeTimeStepSeconds,
          ]);
          const entry = evidence.get(key) ?? { selection: chosen, periods: [] };
          const until = new Date(at + HOUR).toISOString();
          const previous = entry.periods.at(-1);
          if (previous?.end === iso) previous.end = until;
          else entry.periods.push({ start: iso, end: until });
          evidence.set(key, entry);
        }
        const first = samples.findIndex((s) => s.value !== null);
        const last = samples.findLastIndex((s) => s.value !== null);
        const available = first < 0 ? [] : samples.slice(first, last + 1);
        if (request.required.some((d) => same(d, descriptor))) {
          if (available.some((s) => s.value === null) || !available.length)
            missing = true;
          if (first !== 0 || last !== samples.length - 1) outside = true;
        }
        return {
          descriptor,
          samples: available,
          evidence: [...evidence.values()].map(({ selection, periods }) => ({
            provenance: selection.origin.provenance,
            location: selection.origin.location,
            descriptor: selection.descriptor,
            method: selection.method,
            nativeTimeStepSeconds: selection.nativeTimeStepSeconds,
            periods,
          })),
        };
      });
      const origins = series.flatMap((s) => s.evidence ?? []);
      const retrievedAt =
        origins.map((o) => o.provenance.retrievedAt).sort()[0] ??
        apple.provenance.retrievedAt;
      const expiresAt = origins
        .flatMap((o) =>
          o.provenance.expiresAt ? [o.provenance.expiresAt] : [],
        )
        .sort()[0];
      const attribution = [
        ...new Map(
          origins
            .flatMap((o) => o.provenance.attribution)
            .map((a) => [JSON.stringify(a), a]),
        ).values(),
      ];
      return {
        status: missing || outside ? 'partial' : 'complete',
        // Each field's actual representative point is retained in evidence.
        location: {
          requested,
          coordinate: requested.coordinate,
          sourceLocationId: null,
          distanceFromRequestedM: 0,
          method: 'interpolated',
        },
        provenance: {
          source: taiwanSource,
          dataVersion: null,
          retrievedAt,
          ...(expiresAt ? { expiresAt } : {}),
          attribution,
        },
        issuedAt: null,
        series,
        issues: [
          problem(
            'unknown-model-run',
            'CWA and Apple do not expose a verified forecast model-run time; field evidence retains each retrieval time.',
          ),
          ...(outside
            ? [
                problem(
                  'outside-forecast-horizon',
                  'The sources do not cover the entire requested forecast range.',
                ),
              ]
            : []),
          ...(missing
            ? [
                problem(
                  'missing-data',
                  'Some requested Taiwan forecast hours are unavailable; missing evidence is never dry or calm weather.',
                ),
              ]
            : []),
        ],
      };
    });
  },
});
