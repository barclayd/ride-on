import { haversineKm } from '../geo.ts';
import type { Route } from '../routes/model.ts';
import { skyConditions } from '../weather/conditions.ts';
import type {
  ForecastDescriptor,
  ForecastSample,
  LocationForecastResult,
} from '../weather/contracts.ts';
import {
  descriptorKey,
  weatherDescriptors as descriptors,
  ensembleDescriptors,
} from '../weather/descriptors.ts';
import { assessClimbing, CLIMBING_SHARE } from './climbing.ts';
import { planDepartures } from './daylight.ts';
import {
  type RecommendationInput,
  resolveMinimumTemperature,
} from './input.ts';

export const ALGORITHM_VERSION = 'comfort-v0.5';
export const requiredWeather = [
  descriptors.airTemperature,
  descriptors.windSpeed,
  descriptors.windDirection,
  descriptors.windGust,
  descriptors.precipitationRate,
  descriptors.precipitationProbability,
];
/** Selection policy is independent of provider identity. No statistic is relabelled. */
export const requiredWeatherFor = (
  input: RecommendationInput,
): readonly ForecastDescriptor[] => {
  const d =
    input.forecast.representation === 'ensemble-summary'
      ? ensembleDescriptors
      : descriptors;
  return [
    d.airTemperature,
    d.windSpeed,
    d.windDirection,
    d.windGust,
    d.precipitationRate,
    d.precipitationProbability,
    ...(input.preferences.weights.clearSkies > 0 ? [d.totalCloudCover] : []),
    ...(input.preferences.weights.sunshine > 0 ? [d.skyCondition] : []),
  ];
};
const HOUR = 3_600_000;
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const round = (value: number) => Math.round(value * 100) / 100;
const iso = (value: number) => new Date(value).toISOString();

/** Compile timestamps once; all departure comparisons reuse these lookups. */
const compileSeries = (samples: readonly ForecastSample[]) => {
  const indexed = samples.map((sample) => ({
    validAt: Date.parse(sample.validAt),
    value: sample.value,
    period:
      sample.time.kind === 'period' && sample.time.aggregation !== 'mean'
        ? {
            start: Date.parse(sample.time.range.start),
            end: Date.parse(sample.time.range.end),
          }
        : null,
  }));
  return (at: number): number | null => {
    let low = 0;
    let high = indexed.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if ((indexed[mid]?.validAt ?? Infinity) < at) low = mid + 1;
      else high = mid;
    }
    let nearest: (typeof indexed)[number] | undefined;
    for (
      let index = Math.max(0, low - 1);
      index < Math.min(indexed.length, low + 2);
      index++
    ) {
      const sample = indexed[index];
      if (!sample) continue;
      if (sample.period) {
        if (sample.period.start <= at && at < sample.period.end)
          return sample.value;
      } else if (
        !nearest ||
        Math.abs(sample.validAt - at) < Math.abs(nearest.validAt - at)
      )
        nearest = sample;
    }
    return nearest && Math.abs(nearest.validAt - at) <= HOUR / 2
      ? nearest.value
      : null;
  };
};
/** Native period bounds for events / maxima; nearest hourly validity for instants / short wind means. */
export const sampleAt = (
  samples: readonly ForecastSample[],
  at: number,
): number | null => compileSeries(samples)(at);
type PreparedWeather = ReadonlyMap<
  string,
  readonly ReturnType<typeof compileSeries>[]
>;

type Observation = {
  at: number;
  distanceM: number;
  fromM: number;
  toM: number;
  temperatureC: number;
  windSpeedKph: number;
  cloudCoverFraction: number | null;
  skyCondition: number | null;
  sunshine: number | null;
  clearSkies: number | null;
  headwindKph: number;
  crosswindKph: number;
  gustKph: number;
  precipitationProbability: number;
  precipitationRateMmH: number;
  temperature: number;
  wind: number;
  dryness: number;
  comfort: number;
};
type Failure = {
  standard: string;
  limit: number;
  actual: number;
  affectedDistanceKm: number;
  sections: { fromKm: number; toKm: number; observedAt: string }[];
};
const summarize = (rows: readonly Observation[]) => {
  const distance = rows.reduce((sum, row) => sum + row.distanceM, 0);
  const mean = (value: (row: Observation) => number) =>
    rows.reduce((sum, row) => sum + value(row) * row.distanceM, 0) / distance;
  return {
    skyConditionDistanceFractions: rows.every((r) => r.skyCondition !== null)
      ? Object.fromEntries(
          Object.entries(skyConditions).map(([name, code]) => [
            name,
            round(mean((r) => (r.skyCondition === code ? 1 : 0))),
          ]),
        )
      : null,
    averageWindSpeedKph: round(mean((r) => r.windSpeedKph)),
    averageHeadwindKph: round(mean((r) => Math.max(0, r.headwindKph))),
    averageTailwindKph: round(mean((r) => Math.max(0, -r.headwindKph))),
    averageCrosswindKph: round(mean((r) => r.crosswindKph)),
    cloudCoverFraction: rows.every((r) => r.cloudCoverFraction !== null)
      ? {
          mean: round(mean((r) => r.cloudCoverFraction ?? 0)),
          maximum: round(
            Math.max(...rows.map((r) => r.cloudCoverFraction ?? 0)),
          ),
        }
      : null,
    distanceKm: round(distance / 1000),
    temperatureC: {
      minimum: round(Math.min(...rows.map((row) => row.temperatureC))),
      maximum: round(Math.max(...rows.map((row) => row.temperatureC))),
    },
    maximumHeadwindKph: round(
      Math.max(0, ...rows.map((row) => row.headwindKph)),
    ),
    maximumCrosswindKph: round(
      Math.max(...rows.map((row) => row.crosswindKph)),
    ),
    maximumGustKph: round(Math.max(...rows.map((row) => row.gustKph))),
    maximumPrecipitationProbability: Math.max(
      ...rows.map((row) => row.precipitationProbability),
    ),
    maximumPrecipitationRateMmH: round(
      Math.max(...rows.map((row) => row.precipitationRateMmH)),
    ),
    assistedDistanceFraction: round(
      rows.reduce(
        (sum, row) =>
          sum +
          (-row.headwindKph >= 3 && -row.headwindKph > row.crosswindKph
            ? row.distanceM
            : 0),
        0,
      ) / distance,
    ),
  };
};

const assessCandidate = (
  route: Route,
  departure: number,
  durationMs: number,
  input: RecommendationInput,
  forecasts: ReadonlyMap<string, LocationForecastResult>,
  prepared: PreparedWeather,
  maxLocationDistanceM: number,
  climbing: ReturnType<typeof assessClimbing>,
) => {
  if (climbing.status === 'unknown')
    return { status: 'unknown' as const, reasons: ['missing-elevation'] };
  const rows: Observation[] = [];
  const missing = new Set<string>();
  const preferences = input.preferences;
  const weights = preferences.weights;
  const weightTotal =
    weights.temperature +
    weights.wind +
    weights.dryness +
    weights.clearSkies +
    weights.sunshine;
  for (const leg of route.legs) {
    const at =
      departure + (durationMs * (leg.fromM + leg.toM)) / (2 * route.distanceM);
    const result = forecasts.get(leg.weatherLocationId);
    if (!result || result.status === 'unavailable') {
      missing.add(
        result?.issues.map((issue) => issue.code).join(', ') ?? 'missing-data',
      );
      continue;
    }
    if (
      result.issues.some((issue) =>
        [
          'stale-data',
          'insufficient-resolution',
          'outside-coverage',
          'invalid-response',
        ].includes(issue.code),
      )
    ) {
      missing.add('unusable-forecast');
      continue;
    }
    const resolved = result.location.coordinate;
    if (
      haversineKm(
        [leg.coordinate.latitude, leg.coordinate.longitude],
        [resolved.latitude, resolved.longitude],
      ) *
        1000 >
      maxLocationDistanceM
    ) {
      missing.add('forecast-too-far-from-route');
      continue;
    }
    const values =
      prepared.get(leg.weatherLocationId)?.map((lookup) => lookup(at)) ?? [];
    const [
      temperatureC,
      speedMs,
      direction,
      gustMs,
      precipitationRateMmH,
      precipitationProbability,
    ] = values;
    const cloudCoverFraction =
      weights.clearSkies > 0 ? (values[6] ?? null) : null;
    const skyCondition =
      weights.sunshine > 0
        ? (values[weights.clearSkies > 0 ? 7 : 6] ?? null)
        : null;
    if (
      temperatureC == null ||
      speedMs == null ||
      direction == null ||
      gustMs == null ||
      precipitationRateMmH == null ||
      precipitationProbability == null ||
      (weights.clearSkies > 0 && cloudCoverFraction === null) ||
      (weights.sunshine > 0 &&
        (skyCondition === null ||
          !Object.values(skyConditions).some((code) => code === skyCondition)))
    ) {
      missing.add('missing-weather-at-arrival');
      continue;
    }
    const angle = ((direction - leg.bearingDegrees) * Math.PI) / 180;
    const headwindKph = speedMs * 3.6 * Math.cos(angle);
    const crosswindKph = Math.abs(speedMs * 3.6 * Math.sin(angle));
    const gustKph = gustMs * 3.6;
    const temperature =
      1 -
      clamp(
        Math.max(
          preferences.temperature.comfortMinC - temperatureC,
          temperatureC - preferences.temperature.comfortMaxC,
          0,
        ) / 10,
      );
    const wind =
      1 -
      clamp(
        0.45 *
          clamp((headwindKph - preferences.wind.comfortableHeadwindKph) / 20) +
          0.35 *
            preferences.wind.crosswindSensitivity *
            clamp(
              (crosswindKph - preferences.wind.comfortableCrosswindKph) / 20,
            ) +
          0.2 * clamp((gustKph - preferences.wind.comfortableGustKph) / 30),
      );
    const dryness =
      1 -
      clamp(
        0.8 * precipitationProbability + 0.2 * clamp(precipitationRateMmH / 2),
      );
    const clearSkies =
      cloudCoverFraction === null ? null : 1 - cloudCoverFraction;
    const sunshine =
      skyCondition === null
        ? null
        : skyCondition === skyConditions.sunny
          ? 1
          : skyCondition === skyConditions.sunnyIntervals
            ? preferences.sunshine.sunnyIntervalsComfort
            : 0;
    rows.push({
      at,
      distanceM: leg.toM - leg.fromM,
      fromM: leg.fromM,
      toM: leg.toM,
      temperatureC,
      windSpeedKph: speedMs * 3.6,
      cloudCoverFraction,
      skyCondition,
      sunshine,
      clearSkies,
      headwindKph,
      crosswindKph,
      gustKph,
      precipitationProbability,
      precipitationRateMmH,
      temperature,
      wind,
      dryness,
      comfort:
        (weights.temperature * temperature +
          weights.wind * wind +
          weights.dryness * dryness +
          weights.clearSkies * (clearSkies ?? 0) +
          weights.sunshine * (sunshine ?? 0)) /
        weightTotal,
    });
  }
  if (missing.size || !rows.length)
    return { status: 'unknown' as const, reasons: [...missing] };
  const conditions = summarize(rows);
  const failures: Failure[] = [];
  const standards = preferences.minimumStandards;
  const floor = resolveMinimumTemperature(input);
  // Compare raw observations, not rounded presentation values.
  const minimum = Math.min(...rows.map((row) => row.temperatureC));
  const recordFailure = (
    standard: string,
    limit: number,
    actual: number,
    affected: readonly Observation[],
  ) => {
    if (!affected.length) return;
    failures.push({
      standard,
      limit,
      actual,
      affectedDistanceKm: round(
        affected.reduce((sum, row) => sum + row.distanceM, 0) / 1000,
      ),
      sections: affected.map((row) => ({
        fromKm: round(row.fromM / 1000),
        toKm: round(row.toM / 1000),
        observedAt: iso(row.at),
      })),
    });
  };
  if (floor.valueC !== null) {
    const limit = floor.valueC;
    recordFailure(
      'minimumTemperatureC',
      limit,
      minimum,
      rows.filter((row) => row.temperatureC < limit),
    );
  }
  for (const [standard, field] of [
    ['maximumGustKph', 'gustKph'],
    ['maximumPrecipitationProbability', 'precipitationProbability'],
    ['maximumPrecipitationRateMmH', 'precipitationRateMmH'],
  ] as const) {
    const limit = standards[standard];
    if (limit !== undefined)
      recordFailure(
        standard,
        limit,
        Math.max(...rows.map((row) => row[field])),
        rows.filter((row) => row[field] > limit),
      );
  }
  const standardsStatus = failures.length
    ? 'below'
    : !floor.resolved
      ? 'unknown'
      : Object.keys(standards).length
        ? 'meets'
        : 'not_configured';
  const mean = (
    key:
      | 'comfort'
      | 'temperature'
      | 'wind'
      | 'dryness'
      | 'clearSkies'
      | 'sunshine',
  ) =>
    rows.reduce((sum, row) => sum + (row[key] ?? 0) * row.distanceM, 0) /
    route.distanceM;
  const weatherScore =
    100 *
    (0.75 * mean('comfort') +
      0.25 * Math.min(...rows.map((row) => row.comfort)));
  const score =
    climbing.status === 'assessed'
      ? (1 - CLIMBING_SHARE) * weatherScore +
        CLIMBING_SHARE * 100 * climbing.comfort
      : weatherScore;
  const rideHours = Array.from(
    { length: Math.ceil(durationMs / HOUR) },
    (_, index) => {
      const start = departure + index * HOUR;
      const end = Math.min(start + HOUR, departure + durationMs);
      const section = rows.filter((row) => row.at >= start && row.at < end);
      return {
        start: iso(start),
        end: iso(end),
        conditions: section.length ? summarize(section) : null,
      };
    },
  );
  const drawbacks: string[] = [];
  if (conditions.cloudCoverFraction && conditions.cloudCoverFraction.mean > 0.5)
    drawbacks.push(
      'Cloud covers more than half the sky on average during this ride.',
    );
  if (minimum < preferences.temperature.comfortMinC)
    drawbacks.push('Some sections are cooler than your comfort range.');
  if (conditions.temperatureC.maximum > preferences.temperature.comfortMaxC)
    drawbacks.push('Some sections are warmer than your comfort range.');
  if (conditions.maximumHeadwindKph > preferences.wind.comfortableHeadwindKph)
    drawbacks.push('Some sections have headwinds above your comfort setting.');
  if (conditions.maximumCrosswindKph > preferences.wind.comfortableCrosswindKph)
    drawbacks.push('Some sections have crosswinds above your comfort setting.');
  if (conditions.maximumGustKph > preferences.wind.comfortableGustKph)
    drawbacks.push('Gusts exceed your comfort setting.');
  if (
    conditions.maximumPrecipitationProbability > 0 ||
    conditions.maximumPrecipitationRateMmH > 0
  )
    drawbacks.push(
      'Precipitation is possible during this ride; the probability shown is the highest local hourly risk, not a whole-ride probability.',
    );
  return {
    status: 'assessed' as const,
    departureAt: iso(departure),
    finishAt: iso(departure + durationMs),
    score: round(score),
    weatherScore: round(weatherScore),
    factors: {
      climbing:
        climbing.comfort === null ? null : round(100 * climbing.comfort),
      sunshine:
        conditions.skyConditionDistanceFractions === null
          ? null
          : round(100 * mean('sunshine')),
      temperature: round(100 * mean('temperature')),
      wind: round(100 * mean('wind')),
      dryness: round(100 * mean('dryness')),
      clearSkies:
        conditions.cloudCoverFraction === null
          ? null
          : round(100 * mean('clearSkies')),
    },
    standards: { status: standardsStatus, failures },
    conditions,
    rideHours,
    drawbacks,
  };
};
type Assessed = Extract<
  ReturnType<typeof assessCandidate>,
  { status: 'assessed' }
>;
const order = (a: Assessed, b: Assessed) =>
  Number(b.standards.status === 'meets') -
    Number(a.standards.status === 'meets') ||
  b.score - a.score ||
  a.departureAt.localeCompare(b.departureAt);

export const recommendRides = (
  routes: readonly Route[],
  input: RecommendationInput,
  results: readonly LocationForecastResult[],
  nowMs: number,
  maxLocationDistanceM = 10_000,
  // Offline calibration can retain more candidates; the HTTP API keeps three.
  alternativeLimit = 3,
) => {
  const forecasts = new Map(
    results.map((result) => [
      result.status === 'unavailable'
        ? result.requested.id
        : result.location.requested.id,
      result,
    ]),
  );
  const prepared: PreparedWeather = new Map(
    [...forecasts].map(([id, result]) => {
      const byDescriptor = new Map(
        result.status === 'unavailable'
          ? []
          : result.series.map((series) => [
              descriptorKey(series.descriptor),
              series.samples,
            ]),
      );
      return [
        id,
        requiredWeatherFor(input).map((descriptor) =>
          compileSeries(byDescriptor.get(descriptorKey(descriptor)) ?? []),
        ),
      ];
    }),
  );
  const evaluated = routes.map((route) => {
    const plan = planDepartures(route, input, nowMs);
    const climbing = assessClimbing(
      route,
      input.preferences.climbing.preference,
    );
    const candidates = plan.departures.map((departure) =>
      assessCandidate(
        route,
        departure,
        plan.durationMs,
        input,
        forecasts,
        prepared,
        maxLocationDistanceM,
        climbing,
      ),
    );
    const assessed = candidates
      .filter(
        (candidate): candidate is Assessed => candidate.status === 'assessed',
      )
      .sort(order);
    const unknown = candidates.filter(
      (candidate) => candidate.status === 'unknown',
    );
    return {
      routeId: route.id,
      routeName: route.name,
      sourceHash: route.sourceHash,
      distanceM: route.distanceM,
      distanceKm: round(route.distanceM / 1000),
      ascentM: route.ascentM,
      ascentMPerKm:
        climbing.ascentMPerKm === null ? null : round(climbing.ascentMPerKm),
      estimatedDurationMinutes: round(plan.durationMs / 60_000),
      daylight: plan.daylight
        ? { start: iso(plan.daylight.start), end: iso(plan.daylight.end) }
        : null,
      effectiveWindow: plan.effectiveWindow
        ? {
            start: iso(plan.effectiveWindow.start),
            end: iso(plan.effectiveWindow.end),
          }
        : null,
      status: assessed.length
        ? 'assessed'
        : candidates.length
          ? 'unassessable'
          : 'no_feasible_departure',
      departuresTested: candidates.length,
      departuresAssessed: assessed.length,
      departuresUnknown: unknown.length,
      departuresStandardsUnknown: assessed.filter(
        (candidate) => candidate.standards.status === 'unknown',
      ).length,
      best: assessed[0] ?? null,
      alternatives: assessed.slice(1, 1 + alternativeLimit),
      issues: candidates.length
        ? [...new Set(unknown.flatMap((candidate) => candidate.reasons))]
        : [
            'No future departure on the configured grid fits the full estimated ride inside daylight and the requested window.',
          ],
      warnings: [
        ...route.warnings,
        ...(climbing.status === 'unknown'
          ? [
              'Your climbing preference cannot be assessed without complete elevation data.',
            ]
          : []),
        ...(unknown.length
          ? [
              'Some departures could not be assessed; the best available result may change when the missing data is available.',
            ]
          : []),
      ],
    };
  });
  const ranked = evaluated
    .filter((route) => route.best !== null)
    .sort((a, b) =>
      a.best && b.best
        ? order(a.best, b.best) || a.routeId.localeCompare(b.routeId)
        : 0,
    );
  const unknown = evaluated.some(
    (route) =>
      route.departuresUnknown > 0 || route.departuresStandardsUnknown > 0,
  );
  const configured = Object.keys(input.preferences.minimumStandards).length > 0;
  const meets = ranked.some(
    (route) => route.best?.standards.status === 'meets',
  );
  const minimumStandardsStatus = !configured
    ? 'not_configured'
    : meets
      ? 'match_found'
      : unknown
        ? 'unknown'
        : ranked.length
          ? 'none_meet'
          : 'no_feasible_departure';
  return {
    algorithmVersion: ALGORITHM_VERSION,
    recommendedRouteId: ranked[0]?.routeId ?? null,
    minimumStandardsStatus,
    message:
      minimumStandardsStatus === 'none_meet'
        ? 'No evaluated route and departure meets your minimum standards. The recommendation is the best available, with its drawbacks.'
        : minimumStandardsStatus === 'unknown'
          ? 'No confirmed match for your minimum standards. Some departures or standards could not be assessed.'
          : ranked.length
            ? input.preferences.climbing.preference === 'neutral'
              ? 'Routes ranked by comfort throughout the ride.'
              : 'Routes ranked by weather comfort and your climbing preference.'
            : 'No ride could be recommended for this day.',
    rankings: ranked.map((route, index) => ({ rank: index + 1, ...route })),
    unranked: evaluated.filter((route) => route.best === null),
  };
};
