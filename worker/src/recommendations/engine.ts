import { haversineKm } from '../geo.ts';
import { type HistoryAssessment, prepareHistory } from '../rides/overlap.ts';
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
  precipitationTypeDescriptor,
} from '../weather/descriptors.ts';
import { summarizePrecipitation } from '../weather/precipitation.ts';
import { assessClimbing, CLIMBING_SHARE } from './climbing.ts';
import { conditionsSchema } from './conditions.ts';
import { planDepartures } from './daylight.ts';
import { assessDistance, DISTANCE_SHARE } from './distance.ts';
import { forecastDetailsFor } from './forecast-details.ts';
import {
  type RecommendationInput,
  resolveMinimumTemperature,
} from './input.ts';
import type { PreviousScore } from './score-baselines.ts';
import { compileTemperature } from './temperature.ts';
import { windAssistanceBenefit, windExposure } from './wind-comfort.ts';
import { meanWindFrom } from './wind-direction.ts';

export const ALGORITHM_VERSION = 'comfort-v0.15';
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
      sample.time.kind === 'period' &&
      (sample.time.aggregation !== 'mean' ||
        Date.parse(sample.time.range.end) -
          Date.parse(sample.time.range.start) >=
          HOUR)
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
/** Native period bounds for events, maxima and full-hour means; nearest validity for instants / short wind means. */
export const sampleAt = (
  samples: readonly ForecastSample[],
  at: number,
): number | null => compileSeries(samples)(at);
type PreparedWeather = ReadonlyMap<
  string,
  {
    values: readonly ReturnType<typeof compileSeries>[];
    temperature: ReturnType<typeof compileTemperature>;
  }
>;

type Observation = {
  at: number;
  distanceM: number;
  fromM: number;
  toM: number;
  temperatureC: number;
  temperatureRange: NonNullable<
    ReturnType<ReturnType<typeof compileTemperature>['range']>
  >;
  windSpeedKph: number;
  windFromDegrees: number;
  cloudCoverFraction: number | null;
  skyCondition: number | null;
  precipitationType: number | null;
  sunshine: number | null;
  clearSkies: number | null;
  headwindKph: number;
  crosswindKph: number;
  gustKph: number;
  adverseGustKph: number;
  assistance: number;
  precipitationProbability: number;
  precipitationRateMmH: number;
  temperature: number;
  wind: number;
  dryness: number;
  nonWindComfort: number;
};
type Failure = {
  standard: string;
  limit: number;
  actual: number;
  at: string;
  date: string;
  timeZone: string;
  positionKm: number;
  affectedDistanceKm: number;
  sections: { fromKm: number; toKm: number; observedAt: string }[];
};
const summarize = (rows: readonly Observation[]) => {
  const distance = rows.reduce((sum, row) => sum + row.distanceM, 0);
  const mean = (value: (row: Observation) => number) =>
    rows.reduce((sum, row) => sum + value(row) * row.distanceM, 0) / distance;
  return conditionsSchema.parse({
    windDistanceFractions: {
      headwind: round(
        mean((r) =>
          r.headwindKph > 0 && Math.abs(r.headwindKph) >= r.crosswindKph
            ? 1
            : 0,
        ),
      ),
      tailwind: round(
        mean((r) =>
          r.headwindKph <= 0 && Math.abs(r.headwindKph) >= r.crosswindKph
            ? 1
            : 0,
        ),
      ),
      crosswind: round(
        mean((r) => (r.crosswindKph > Math.abs(r.headwindKph) ? 1 : 0)),
      ),
    },
    precipitationSummary: summarizePrecipitation(rows),
    skyConditionDistanceFractions: rows.every((r) => r.skyCondition !== null)
      ? Object.fromEntries(
          Object.entries(skyConditions).map(([name, code]) => [
            name,
            round(mean((r) => (r.skyCondition === code ? 1 : 0))),
          ]),
        )
      : null,
    windFromDegrees: meanWindFrom(rows),
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
      minimum: round(
        Math.min(...rows.map((row) => row.temperatureRange.minimum.value)),
      ),
      maximum: round(
        Math.max(...rows.map((row) => row.temperatureRange.maximum.value)),
      ),
    },
    maximumHeadwindKph: round(
      Math.max(0, ...rows.map((row) => row.headwindKph)),
    ),
    maximumCrosswindKph: round(
      Math.max(...rows.map((row) => row.crosswindKph)),
    ),
    maximumGustKph: round(Math.max(...rows.map((row) => row.gustKph))),
    gustExposure: {
      directionBasis: 'prevailing-wind-estimate',
      maximumAdverseKph: round(
        Math.max(...rows.map((row) => row.adverseGustKph)),
      ),
    },
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
  });
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
  distance: ReturnType<typeof assessDistance>,
  history: HistoryAssessment,
) => {
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
    const weather = prepared.get(leg.weatherLocationId);
    const values = weather?.values.map((lookup) => lookup(at)) ?? [];
    const temperatureC = weather?.temperature.at(at);
    const temperatureRange = weather?.temperature.range(
      departure + (durationMs * leg.fromM) / route.distanceM,
      departure + (durationMs * leg.toM) / route.distanceM,
    );
    const [
      ,
      speedMs,
      direction,
      gustMs,
      precipitationRateMmH,
      precipitationProbability,
    ] = values;
    const cloudCoverFraction =
      weights.clearSkies > 0 ? (values[6] ?? null) : null;
    const skyCondition =
      weights.sunshine > 0 &&
      Object.values(skyConditions).some(
        (code) => code === values[weights.clearSkies > 0 ? 7 : 6],
      )
        ? (values[weights.clearSkies > 0 ? 7 : 6] ?? null)
        : null;
    if (
      temperatureC == null ||
      !temperatureRange ||
      speedMs == null ||
      direction == null ||
      gustMs == null ||
      precipitationRateMmH == null ||
      precipitationProbability == null ||
      (weights.clearSkies > 0 && cloudCoverFraction === null)
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
    const exposure = windExposure(
      headwindKph,
      crosswindKph,
      gustKph,
      preferences.wind,
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
      temperatureRange,
      windSpeedKph: speedMs * 3.6,
      windFromDegrees: direction,
      cloudCoverFraction,
      skyCondition,
      precipitationType: values.at(-1) ?? null,
      sunshine,
      clearSkies,
      headwindKph,
      crosswindKph,
      gustKph,
      adverseGustKph: exposure.adverseGustKph,
      assistance: exposure.assistance,
      precipitationProbability,
      precipitationRateMmH,
      temperature,
      wind: exposure.comfort,
      dryness,
      nonWindComfort:
        (weights.temperature * temperature +
          weights.dryness * dryness +
          weights.clearSkies * (clearSkies ?? 0) +
          // Unknown sunshine affects preference scoring neutrally; it is not
          // an observation of clear sky, cloud, sunshine duration or probability.
          weights.sunshine * (sunshine ?? 0.5)) /
        weightTotal,
    });
  }
  if (missing.size || !rows.length)
    return { status: 'unknown' as const, reasons: [...missing] };
  const conditions = summarize(rows);
  const unknownSunshine = rows.filter((row) => row.sunshine === null);
  const sunshineAssessment =
    weights.sunshine > 0
      ? {
          status: !unknownSunshine.length
            ? ('complete' as const)
            : unknownSunshine.length === rows.length
              ? ('unavailable' as const)
              : ('partial' as const),
          unknownDistanceFraction: clamp(
            unknownSunshine.reduce((sum, row) => sum + row.distanceM, 0) /
              route.distanceM,
          ),
        }
      : null;
  const failures: Failure[] = [];
  const standards = preferences.minimumStandards;
  const floor = resolveMinimumTemperature(input);
  // Compare raw observations, not rounded presentation values.
  const temperatureRows = (kind: 'minimum' | 'maximum') =>
    rows.map((row) => ({
      ...row,
      at: row.temperatureRange[kind].at,
      temperatureC: row.temperatureRange[kind].value,
    }));
  const minimumRows = temperatureRows('minimum');
  const minimum = Math.min(...minimumRows.map((row) => row.temperatureC));
  const recordFailure = (
    standard: string,
    limit: number,
    actual: number,
    affected: readonly Observation[],
    worst: Observation | undefined,
  ) => {
    if (!affected.length || !worst) return;
    failures.push({
      standard,
      limit,
      actual,
      at: iso(worst.at),
      date: input.date,
      timeZone: input.timeZone,
      positionKm: round(
        (route.distanceM * (worst.at - departure)) / durationMs / 1000,
      ),
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
      minimumRows.filter((row) => row.temperatureC < limit),
      minimumRows.find((row) => row.temperatureC === minimum),
    );
  }
  for (const [standard, field] of [
    ['maximumTemperatureC', 'temperatureC'],
    ['maximumGustKph', 'gustKph'],
    ['maximumPrecipitationProbability', 'precipitationProbability'],
    ['maximumPrecipitationRateMmH', 'precipitationRateMmH'],
  ] as const) {
    const limit = standards[standard];
    const observations =
      field === 'temperatureC' ? temperatureRows('maximum') : rows;
    if (limit !== undefined)
      recordFailure(
        standard,
        limit,
        Math.max(...observations.map((row) => row[field])),
        observations.filter((row) => row[field] > limit),
        observations.reduce((worst, row) =>
          row[field] > worst[field] ? row : worst,
        ),
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
      | 'nonWindComfort'
      | 'assistance'
      | 'temperature'
      | 'wind'
      | 'dryness'
      | 'clearSkies'
      | 'sunshine',
  ) =>
    rows.reduce((sum, row) => sum + (row[key] ?? 0) * row.distanceM, 0) /
    route.distanceM;
  const windShare = weights.wind / weightTotal;
  // Wind exposure is proportional to distance (and time at the model's fixed
  // speed). Preserve the existing worst-section treatment of other factors.
  type WeatherFactor = keyof typeof weights;
  const unassistedScore = (ideal?: WeatherFactor) => {
    const nonWind = rows.map((row) =>
      ideal === undefined || ideal === 'wind'
        ? row.nonWindComfort
        : row.nonWindComfort +
          (weights[ideal] / weightTotal) *
            (1 - (row[ideal] ?? (ideal === 'sunshine' ? 0.5 : 0))),
    );
    const average =
      nonWind.reduce(
        (sum, value, i) => sum + value * (rows[i]?.distanceM ?? 0),
        0,
      ) / route.distanceM;
    return (
      100 *
      (0.75 * average +
        0.25 * Math.min(...nonWind) +
        windShare * (ideal === 'wind' ? 1 : mean('wind')))
    );
  };
  const unassistedWeatherScore = unassistedScore();
  // Use raw distance shares for scoring, never rounded display fractions.
  const usefulAssistedShare =
    rows.reduce(
      (sum, row) => sum + (row.assistance > 0 ? row.distanceM : 0),
      0,
    ) / route.distanceM;
  // A wind comfort weight is not consent to prefer assistance over calm. Gate
  // both the score benefit and its potential-points tie-break on an explicit opt-in.
  const assistancePoints = preferences.wind.preferTailwind
    ? 100 * windShare * windAssistanceBenefit(mean('assistance'))
    : 0;
  const weatherScore = Math.min(100, unassistedWeatherScore + assistancePoints);
  const climbingShare = climbing.status === 'assessed' ? CLIMBING_SHARE : 0;
  const distanceShare = distance.comfort === null ? 0 : DISTANCE_SHARE;
  const weatherShare = 1 - climbingShare - distanceShare;
  const combinedScore = (
    weather: number,
    climbingComfort = climbing.comfort ?? 0,
    distanceComfort = distance.comfort ?? 0,
  ) =>
    weatherShare * weather +
    climbingShare * 100 * climbingComfort +
    distanceShare * 100 * distanceComfort;
  const score = combinedScore(weatherScore);
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
  const recentRides = history.assess(route.id, iso(departure));
  const afterHistory = (base: number) =>
    Math.max(0, base - recentRides.penaltyPoints);
  const finalScore = afterHistory(score);
  // Counterfactual gains are not additive allocations. Re-evaluate the same
  // departure with one factor ideal, retaining the ceiling, shares and history.
  const gain = (base: number) =>
    round(Math.max(0, afterHistory(base) - finalScore));
  const weatherGain = (factor: WeatherFactor) =>
    weights[factor] === 0
      ? null
      : factor === 'sunshine' && unknownSunshine.length
        ? null
        : gain(
            combinedScore(
              Math.min(100, unassistedScore(factor) + assistancePoints),
            ),
          );
  const pointsLost = {
    temperature: weatherGain('temperature'),
    wind: weatherGain('wind'),
    dryness: weatherGain('dryness'),
    clearSkies: weatherGain('clearSkies'),
    sunshine: weatherGain('sunshine'),
    climbing: climbingShare ? gain(combinedScore(weatherScore, 1)) : null,
    distance: distanceShare
      ? gain(combinedScore(weatherScore, undefined, 1))
      : null,
  };
  const scoreWithoutAssistance =
    score - weatherShare * Math.max(0, weatherScore - unassistedWeatherScore);
  const drawbacks: string[] = [];
  if (sunshineAssessment && sunshineAssessment.status !== 'complete')
    drawbacks.push(
      'Sunshine details are incomplete; unknown sections have a neutral effect on the score.',
    );
  if (recentRides.penaltyPoints > 0)
    drawbacks.push(
      `Recently ridden roads reduce this score by ${round(recentRides.penaltyPoints)} points.`,
    );
  if (recentRides.status === 'unavailable')
    drawbacks.push(
      'Recent ride overlap could not be assessed; no repetition adjustment was applied to this comparison.',
    );
  if (distance.fit?.status === 'below_range')
    drawbacks.push('This ride is shorter than your preferred distance range.');
  if (distance.fit?.status === 'above_range')
    drawbacks.push('This ride is longer than your preferred distance range.');
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
  if (
    rows.some((row) => row.adverseGustKph > preferences.wind.comfortableGustKph)
  )
    drawbacks.push(
      'Estimated opposing or sideways gusts exceed your comfort setting, using the prevailing wind direction.',
    );
  if (
    conditions.maximumPrecipitationProbability > 0 ||
    conditions.maximumPrecipitationRateMmH > 0
  )
    drawbacks.push(
      'Precipitation is possible during this ride; the probability shown is the highest local hourly risk, not a whole-ride probability.',
    );
  return {
    status: 'assessed' as const,
    previous: null as PreviousScore | null,
    date: input.date,
    departureAt: iso(departure),
    finishAt: iso(departure + durationMs),
    baseScore: round(score),
    score: round(finalScore),
    recentRides,
    pointsLost,
    weatherScore: round(weatherScore),
    windAssistance: {
      usefulDistanceFraction: round(usefulAssistedShare),
      potentialPoints: round(weatherShare * assistancePoints),
      appliedPoints: round(
        finalScore -
          Math.max(0, scoreWithoutAssistance - recentRides.penaltyPoints),
      ),
    },
    sunshineAssessment,
    factors: {
      distance:
        distance.comfort === null ? null : round(100 * distance.comfort),
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
export const orderDepartures = (a: Assessed, b: Assessed) =>
  Number(b.standards.status === 'meets') -
    Number(a.standards.status === 'meets') ||
  b.score - a.score ||
  b.windAssistance.potentialPoints - a.windAssistance.potentialPoints ||
  a.departureAt.localeCompare(b.departureAt);

export const standardsStatusFor = (
  evaluated: readonly {
    departuresUnknown: number;
    departuresStandardsUnknown: number;
    best: { standards: { status: string } } | null;
  }[],
  configured: boolean,
) => {
  const unknown = evaluated.some(
    (r) => r.departuresUnknown > 0 || r.departuresStandardsUnknown > 0,
  );
  const meets = evaluated.some((r) => r.best?.standards.status === 'meets');
  return !configured
    ? 'not_configured'
    : meets
      ? 'match_found'
      : unknown
        ? 'unknown'
        : evaluated.some((r) => r.best)
          ? 'none_meet'
          : 'no_feasible_departure';
};

export const recommendRides = (
  routes: readonly Route[],
  input: RecommendationInput,
  results: readonly LocationForecastResult[],
  nowMs: number,
  maxLocationDistanceM = 10_000,
  // Offline calibration can retain more candidates; the HTTP API keeps three.
  alternativeLimit = 3,
  history: HistoryAssessment = prepareHistory(
    routes,
    input.preferences.recentRides,
    null,
    new Date(nowMs).toISOString(),
    new Date(nowMs).toISOString(),
  ),
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
        {
          temperature: compileTemperature(
            byDescriptor.get(
              descriptorKey(
                requiredWeatherFor(input)[0] ?? descriptors.airTemperature,
              ),
            ) ?? [],
          ),
          values: [
            ...requiredWeatherFor(input),
            precipitationTypeDescriptor,
          ].map((descriptor) =>
            compileSeries(byDescriptor.get(descriptorKey(descriptor)) ?? []),
          ),
        },
      ];
    }),
  );
  const evaluated = routes.map((route) => {
    const plan = planDepartures(route, input, nowMs);
    const climbing = assessClimbing(
      route,
      input.preferences.climbing.preference,
    );
    const distance = assessDistance(
      route.distanceM,
      input.preferences.distance,
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
        distance,
        history,
      ),
    );
    const weatherAssessed = candidates
      .filter(
        (candidate): candidate is Assessed => candidate.status === 'assessed',
      )
      .sort(orderDepartures);
    const assessed = climbing.status === 'unknown' ? [] : weatherAssessed;
    const partial =
      climbing.status === 'unknown'
        ? [...weatherAssessed].sort(
            (a, b) =>
              b.weatherScore - a.weatherScore ||
              a.departureAt.localeCompare(b.departureAt),
          )[0]
        : undefined;
    const unknown = candidates.filter(
      (candidate) => candidate.status === 'unknown',
    );
    return {
      routeId: route.id,
      routeName: route.name,
      sourceHash: route.sourceHash,
      distanceM: route.distanceM,
      distanceKm: round(route.distanceM / 1000),
      distanceFit: distance.fit,
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
      departuresUnknown: candidates.length - assessed.length,
      departuresWeatherAssessed: weatherAssessed.length,
      assessedDepartures: assessed.map((c) => ({
        departureAt: c.departureAt,
        finishAt: c.finishAt,
      })),
      partialAssessment: partial
        ? {
            ...partial,
            status: 'partial' as const,
            score: null,
            pointsLost: null,
            reasonCode: 'missing-elevation',
          }
        : null,
      departuresStandardsUnknown: assessed.filter(
        (candidate) => candidate.standards.status === 'unknown',
      ).length,
      best: assessed[0]
        ? {
            ...assessed[0],
            forecastDetails: forecastDetailsFor(
              route,
              assessed[0],
              forecasts,
              requiredWeatherFor(input),
            ),
          }
        : null,
      alternatives: assessed
        .slice(1, 1 + alternativeLimit)
        .map((candidate) => ({
          ...candidate,
          forecastDetails: forecastDetailsFor(
            route,
            candidate,
            forecasts,
            requiredWeatherFor(input),
          ),
        })),
      issues: candidates.length
        ? [
            ...new Set([
              ...unknown.flatMap((candidate) => candidate.reasons),
              ...(climbing.status === 'unknown' ? ['missing-elevation'] : []),
            ]),
          ]
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
        ? orderDepartures(a.best, b.best) || a.routeId.localeCompare(b.routeId)
        : 0,
    );
  const minimumStandardsStatus = standardsStatusFor(
    evaluated,
    Object.keys(input.preferences.minimumStandards).length > 0,
  );
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
            ? input.preferences.distance !== null
              ? input.preferences.climbing.preference === 'neutral'
                ? 'Routes ranked by weather comfort and your preferred distance.'
                : 'Routes ranked by weather comfort, preferred distance and climbing preference.'
              : input.preferences.climbing.preference === 'neutral'
                ? 'Routes ranked by comfort throughout the ride.'
                : 'Routes ranked by weather comfort and your climbing preference.'
            : 'No ride could be recommended for this day.',
    rankings: ranked.map((route, index) => ({ rank: index + 1, ...route })),
    unranked: evaluated.filter((route) => route.best === null),
  };
};
