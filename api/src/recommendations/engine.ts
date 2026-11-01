import {
  climateSource,
  compileSeasonalNormal,
  monthlyClimateAt,
} from '../climate/seasonal.ts';
import { haversineKm } from '../geo.ts';
import { type HistoryAssessment, prepareHistory } from '../rides/overlap.ts';
import type { Route } from '../routes/model.ts';
import { type RouteOutline, routeOutline } from '../routes/outline.ts';
import { skyConditions } from '../weather/conditions.ts';
import type {
  ForecastDescriptor,
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
import {
  assessTailwindOpportunity,
  routeDirectionality,
} from './tailwind-opportunity.ts';
import { compileTemperature } from './temperature.ts';
import {
  compileDisplayWeather,
  temperatureAlongRideFor,
  usualClimateFor,
} from './temperature-along-ride.ts';
import { compileSeries } from './weather-sampling.ts';

export { sampleAt } from './weather-sampling.ts';

import { temperatureComfort } from './temperature-comfort.ts';
import { windAssistanceBenefit, windExposure } from './wind-comfort.ts';
import { meanWindFrom } from './wind-direction.ts';
import { windStretchesFor } from './wind-stretches.ts';

export const ALGORITHM_VERSION = 'comfort-v0.17';
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
const roundTemperature = (value: number) => Math.round(value * 10) / 10;
const round = (value: number) => Math.round(value * 100) / 100;
const iso = (value: number) => new Date(value).toISOString();

type PreparedWeather = ReadonlyMap<
  string,
  {
    values: readonly ReturnType<typeof compileSeries>[];
    temperature: ReturnType<typeof compileTemperature>;
    display: ReturnType<typeof compileDisplayWeather>;
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
  precipitationAmountMm: number;
  precipitationAmountBasis: 'hourly-accumulation' | 'rate-estimate';
  temperature: number;
  blendTemperature: number;
  coldPenalty: number;
  effectiveMinimumC: number;
  normalMaximumC: number | null;
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
const summarize = (rows: readonly Observation[], sunshineEnabled: boolean) => {
  const distance = rows.reduce((sum, row) => sum + row.distanceM, 0);
  const mean = (value: (row: Observation) => number) =>
    rows.reduce((sum, row) => sum + value(row) * row.distanceM, 0) / distance;
  const skyFractions = sunshineEnabled
    ? Object.fromEntries(
        Object.entries(skyConditions).map(([name, code]) => [
          name,
          round(mean((r) => (r.skyCondition === code ? 1 : 0))),
        ]),
      )
    : null;
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
      ? skyFractions
      : null,
    skyConditionShares: skyFractions
      ? {
          ...skyFractions,
          unknown: round(mean((r) => (r.skyCondition === null ? 1 : 0))),
        }
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
      minimum: roundTemperature(
        Math.min(...rows.map((row) => row.temperatureRange.minimum.value)),
      ),
      maximum: roundTemperature(
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
    maximumPrecipitationAmountMm: roundTemperature(
      Math.max(...rows.map((row) => row.precipitationAmountMm)),
    ),
    precipitationAmountBasis: rows.every(
      (row) =>
        row.precipitationAmountBasis === rows[0]?.precipitationAmountBasis,
    )
      ? rows[0]?.precipitationAmountBasis
      : 'mixed',
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
  seasonalNormals: ReadonlyMap<Route['legs'][number], number | null>,
  directionality: number,
  includeWindStretches = false,
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
    const normalMaximumC = seasonalNormals.get(leg) ?? null;
    const thermal = temperatureComfort(
      temperatureC,
      preferences.temperature,
      normalMaximumC,
    );
    const temperature = thermal.comfort;
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
      precipitationAmountMm:
        weather?.display.precipitationAmount(at) ?? precipitationRateMmH,
      precipitationAmountBasis:
        weather?.display.precipitationAmount(at) == null
          ? 'rate-estimate'
          : 'hourly-accumulation',
      temperature,
      blendTemperature: thermal.blendComfort,
      coldPenalty: thermal.coldPenalty,
      effectiveMinimumC: thermal.effectiveMinimumC,
      normalMaximumC,
      wind: exposure.comfort,
      dryness,
      nonWindComfort:
        (weights.temperature * thermal.blendComfort +
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
  const conditions = summarize(rows, weights.sunshine > 0);
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
      | 'coldPenalty'
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
            (1 -
              (ideal === 'temperature'
                ? row.blendTemperature
                : (row[ideal] ?? (ideal === 'sunshine' ? 0.5 : 0)))),
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
        windShare * (ideal === 'wind' ? 1 : mean('wind')) -
        (ideal === 'temperature'
          ? 0
          : (weights.temperature / weightTotal) * mean('coldPenalty')))
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
  const weatherScore =
    100 * clamp((unassistedWeatherScore + assistancePoints) / 100);
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
        conditions: section.length
          ? summarize(section, weights.sunshine > 0)
          : null,
      };
    },
  );
  const recentRides = history.assess(route.id, iso(departure));
  const afterHistory = (base: number) =>
    Math.max(0, base - recentRides.penaltyPoints);
  const finalScore = afterHistory(score);
  const tailwindOpportunity = assessTailwindOpportunity(
    directionality,
    rows,
    preferences.wind,
  );
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
              100 * clamp((unassistedScore(factor) + assistancePoints) / 100),
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
    score -
    weatherShare *
      Math.max(0, weatherScore - 100 * clamp(unassistedWeatherScore / 100));
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
    recommendationPriority: round(
      round(finalScore) + tailwindOpportunity.priorityPoints,
    ),
    tailwindOpportunity,
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
    temperatureAssessment: {
      coldSensitivity: preferences.temperature.coldSensitivity,
      seasonalTolerance: preferences.temperature.seasonalTolerance,
      idealRangeC: {
        minimum: preferences.temperature.comfortMinC,
        maximum: preferences.temperature.comfortMaxC,
      },
      effectiveMinimumC: {
        minimum: round(Math.min(...rows.map((row) => row.effectiveMinimumC))),
        maximum: round(Math.max(...rows.map((row) => row.effectiveMinimumC))),
      },
      seasonal: {
        status:
          preferences.temperature.seasonalTolerance === 'none'
            ? ('disabled' as const)
            : rows.every((row) => row.normalMaximumC !== null)
              ? ('complete' as const)
              : rows.some((row) => row.normalMaximumC !== null)
                ? ('partial' as const)
                : ('unavailable' as const),
        coveredDistanceFraction: round(
          rows.reduce(
            (sum, row) =>
              sum + (row.normalMaximumC === null ? 0 : row.distanceM),
            0,
          ) / route.distanceM,
        ),
        normalMaximumC: rows.some((row) => row.normalMaximumC !== null)
          ? {
              minimum: round(
                Math.min(
                  ...rows.flatMap((row) =>
                    row.normalMaximumC === null ? [] : [row.normalMaximumC],
                  ),
                ),
              ),
              maximum: round(
                Math.max(
                  ...rows.flatMap((row) =>
                    row.normalMaximumC === null ? [] : [row.normalMaximumC],
                  ),
                ),
              ),
            }
          : null,
        source:
          preferences.temperature.seasonalTolerance === 'none'
            ? null
            : climateSource,
      },
    },
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
    windStretches: includeWindStretches
      ? windStretchesFor(rows, route.distanceM, departure, durationMs)
      : [],
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
  b.recommendationPriority - a.recommendationPriority ||
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
  exactDepartures?: ReadonlyMap<string, number>,
  outlines?: ReadonlyMap<string, RouteOutline | null>,
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
          display: compileDisplayWeather(result, requiredWeatherFor(input)),
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
  const displayWeather = new Map(
    [...prepared].map(([id, weather]) => [id, weather.display]),
  );
  const normalForDate = compileSeasonalNormal(input.date);
  const evaluated = routes.map((route) => {
    const plan = planDepartures(
      route,
      input,
      nowMs,
      exactDepartures?.get(route.id),
    );
    const directionality = routeDirectionality(route);
    const climbing = assessClimbing(
      route,
      input.preferences.climbing.preference,
    );
    const distance = assessDistance(
      route.distanceM,
      input.preferences.distance,
    );
    // Resolve once per leg/day, shared by every departure. No climate network calls.
    const seasonalNormals = new Map(
      route.legs.map((leg) => {
        const monthly =
          input.preferences.temperature.seasonalTolerance === 'cooler-winters'
            ? monthlyClimateAt(leg.coordinate)
            : null;
        return [leg, monthly ? normalForDate(monthly) : null] as const;
      }),
    );
    const usualClimate = usualClimateFor(route, input.date);
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
        seasonalNormals,
        directionality,
      ),
    );
    const weatherAssessed = candidates
      .filter(
        (candidate): candidate is Assessed => candidate.status === 'assessed',
      )
      .sort(orderDepartures);
    const assessed = climbing.status === 'unknown' ? [] : weatherAssessed;
    // Only materialize section arrays for returned departures. Keeping up to
    // 1,000 sections for every searched slot would inflate multi-route memory.
    // The same prepared observations and pure assessment supply this display pass.
    const withWind = (candidate: Assessed) => {
      const detailed = assessCandidate(
        route,
        Date.parse(candidate.departureAt),
        plan.durationMs,
        input,
        forecasts,
        prepared,
        maxLocationDistanceM,
        climbing,
        distance,
        history,
        seasonalNormals,
        directionality,
        true,
      );
      return {
        ...candidate,
        temperatureAlongRide: temperatureAlongRideFor(
          route,
          Date.parse(candidate.departureAt),
          Date.parse(candidate.finishAt),
          displayWeather,
          usualClimate,
          input.timeZone,
        ),
        windStretches:
          detailed.status === 'assessed' ? detailed.windStretches : [],
      };
    };
    const best = assessed[0] ? withWind(assessed[0]) : null;
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
      outline: outlines?.has(route.id)
        ? (outlines.get(route.id) ?? null)
        : routeOutline(route),
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
            ...withWind(partial),
            status: 'partial' as const,
            score: null,
            recommendationPriority: null,
            tailwindOpportunity: null,
            pointsLost: null,
            reasonCode: 'missing-elevation',
          }
        : null,
      departuresStandardsUnknown: assessed.filter(
        (candidate) => candidate.standards.status === 'unknown',
      ).length,
      best: best
        ? {
            ...best,
            forecastDetails: forecastDetailsFor(
              route,
              best,
              forecasts,
              requiredWeatherFor(input),
            ),
          }
        : null,
      alternatives: assessed
        .slice(1, 1 + alternativeLimit)
        .map((candidate) => ({
          ...withWind(candidate),
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
            ? input.preferences.wind.preferTailwind &&
              input.preferences.wind.prioritiseTailwindOpportunities
              ? 'Routes ranked by comfort and your tailwind opportunity preference.'
              : input.preferences.distance !== null
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
