import assert from 'node:assert/strict';
import { z } from 'zod';
import {
  preferencesSchema,
  ridingWindowSchema,
} from '../src/recommendations/input.ts';
import { routeGpx } from './fixtures.ts';
import { type Harness, RIDE_DATE } from './harness.ts';

const conditions = z.object({
  windDistanceFractions: z.object({
    headwind: z.number().min(0).max(1),
    tailwind: z.number().min(0).max(1),
    crosswind: z.number().min(0).max(1),
  }),
  precipitationSummary: z.enum([
    'dry',
    'possible',
    'drizzle',
    'light_showers',
    'light_rain',
    'showers',
    'rain',
    'heavy_showers',
    'heavy_rain',
    'sleet',
    'snow',
    'hail',
    'thunder',
  ]),
  temperatureC: z.object({ minimum: z.number(), maximum: z.number() }),
  maximumGustKph: z.number(),
  skyConditionDistanceFractions: z
    .record(z.string(), z.number().min(0).max(1))
    .nullable(),
  skyConditionShares: z
    .record(
      z.enum([
        'sunny',
        'sunnyIntervals',
        'cloudy',
        'overcast',
        'obscured',
        'precipitation',
        'clearNight',
        'partlyCloudyNight',
        'unknown',
      ]),
      z.number().min(0).max(1),
    )
    .nullable(),
  averageWindSpeedKph: z.number(),
  averageCrosswindKph: z.number(),
  cloudCoverFraction: z
    .object({ mean: z.number(), maximum: z.number() })
    .nullable(),
  maximumPrecipitationProbability: z.number().min(0).max(1),
  maximumPrecipitationRateMmH: z.number(),
  maximumPrecipitationAmountMm: z.number().nonnegative(),
  precipitationAmountBasis: z.enum([
    'hourly-accumulation',
    'rate-estimate',
    'mixed',
  ]),
  assistedDistanceFraction: z.number().min(0).max(1),
});
const statistic = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('deterministic') }),
  z.object({ kind: z.literal('ensemble-mean') }),
  z.object({ kind: z.literal('percentile'), percentile: z.number() }),
]);
const period = z.object({ start: z.iso.datetime(), end: z.iso.datetime() });
const forecastDetails = z.object({
  temperatureMethod: z.literal('linear-interpolation'),
  locations: z
    .array(
      z.object({
        source: z.object({ providerId: z.string(), productId: z.string() }),
        sourceLocationId: z.string().nullable(),
        coordinate: z.object({ latitude: z.number(), longitude: z.number() }),
        retrievedAt: z.iso.datetime(),
        forecastRunAt: z.iso.datetime().nullable(),
        temperatureStatistic: statistic.nullable(),
        gustStatistic: statistic.nullable(),
        routePeriods: z.array(period),
        temperatures: z.array(
          z.object({ at: z.iso.datetime(), celsius: z.number().nullable() }),
        ),
        gusts: z.array(period.extend({ maximumKph: z.number().nullable() })),
      }),
    )
    .min(1),
});
export const temperatureAlongRideSchema = z.object({
  points: z
    .array(
      z.tuple([
        z.number().nonnegative(),
        z.number().nullable(),
        z.number().nullable(),
        z.number().nullable(),
      ]),
    )
    .min(2),
  feelsLikeBasis: z.enum(['provider', 'derived', 'mixed']).nullable(),
  usual: z
    .object({
      month: z.number().int().min(1).max(12),
      averageHighC: z.number(),
      averageLowC: z.number(),
      bandHalfWidthC: z.literal(2.5),
      differenceC: z.number().nullable(),
      method: z.literal('monthly-diurnal-estimate'),
      coveredDistanceFraction: z.number().min(0).max(1),
      source: z.object({
        version: z.string(),
        referencePeriod: z.string(),
        statistics: z.tuple([z.literal('maximum'), z.literal('minimum')]),
        attribution: z.string(),
        source: z.url(),
        licence: z.url(),
      }),
    })
    .nullable(),
});
const candidate = z.object({
  recommendationRef: z.uuid().nullable().optional(),
  departureAt: z.iso.datetime(),
  finishAt: z.iso.datetime(),
  score: z.number().min(0).max(100),
  recommendationPriority: z.number().min(0).max(105),
  tailwindOpportunity: z.object({
    enabled: z.boolean(),
    maximumPoints: z.literal(5),
    priorityPoints: z.number().min(0).max(5),
    basis: z.literal('route-leg-bearings-and-sustained-wind'),
    routeDirectionality: z.number().min(0).max(1),
    alignment: z.number().min(0).max(1),
    opposingExposure: z.number().min(0).max(1),
    reason: z.string().nullable(),
  }),
  weatherScore: z.number().min(0).max(100),
  windAssistance: z.object({
    usefulDistanceFraction: z.number().min(0).max(1),
    potentialPoints: z.number().nonnegative(),
    appliedPoints: z.number().nonnegative(),
  }),
  factors: z.object({
    climbing: z.number().min(0).max(100).nullable(),
    distance: z.number().min(0).max(100).nullable(),
  }),
  conditions,
  forecastDetails,
  temperatureAlongRide: temperatureAlongRideSchema,
  standards: z.object({
    status: z.enum(['meets', 'below', 'unknown', 'not_configured']),
    failures: z.array(
      z.object({
        standard: z.string(),
        limit: z.number(),
        actual: z.number(),
        affectedDistanceKm: z.number(),
        sections: z.array(
          z.object({
            fromKm: z.number(),
            toKm: z.number(),
            observedAt: z.iso.datetime(),
          }),
        ),
      }),
    ),
  }),
  rideHours: z.array(
    z.object({
      start: z.iso.datetime(),
      end: z.iso.datetime(),
      conditions: conditions.nullable(),
    }),
  ),
  drawbacks: z.array(z.string()),
});
const issue = z.object({
  code: z.string(),
  message: z.string(),
  retryAfterSeconds: z.number().optional(),
});
const responseSchema = z.object({
  recommendationId: z.uuid().nullable(),
  algorithmVersion: z.string(),
  generatedAt: z.iso.datetime(),
  recommendedRouteId: z.uuid().nullable(),
  message: z.string(),
  minimumStandardsStatus: z.enum([
    'not_configured',
    'match_found',
    'none_meet',
    'unknown',
    'no_feasible_departure',
  ]),
  riding: z.object({
    averageSpeedKph: z.number(),
    window: ridingWindowSchema,
    departureStepMinutes: z.number(),
  }),
  savedUser: z.object({ id: z.string(), version: z.number() }).nullable(),
  resolvedPreferences: preferencesSchema,
  timeZone: z.string(),
  resolvedMinimumTemperature: z.object({
    valueC: z.number().nullable(),
    resolved: z.boolean(),
    origin: z.string(),
  }),
  rankings: z.array(
    z.object({
      routeId: z.uuid(),
      distanceM: z.number().positive(),
      distanceFit: z
        .object({
          status: z.enum(['within_range', 'below_range', 'above_range']),
          deviationKm: z.number().nonnegative(),
        })
        .nullable(),
      ascentM: z.number().nonnegative().nullable(),
      ascentMPerKm: z.number().nonnegative().nullable(),
      best: candidate,
      alternatives: z.array(candidate),
      estimatedDurationMinutes: z.number(),
      daylight: z.object({ start: z.iso.datetime(), end: z.iso.datetime() }),
      effectiveWindow: z.object({
        start: z.iso.datetime(),
        end: z.iso.datetime(),
      }),
      departuresAssessed: z.number(),
      departuresUnknown: z.number(),
      warnings: z.array(z.string()),
    }),
  ),
  unranked: z.array(
    z.object({
      routeId: z.uuid(),
      status: z.enum(['unassessable', 'no_feasible_departure']),
      issues: z.array(z.string()),
    }),
  ),
  weather: z.object({
    selectedSource: z
      .object({ providerId: z.string(), productId: z.string() })
      .nullable(),
    attempts: z.array(z.object({ status: z.string() })),
    cache: z.object({ hits: z.number(), misses: z.number() }),
    locations: z.array(
      z.object({
        id: z.string(),
        status: z.enum(['complete', 'partial', 'unavailable']),
        issues: z.array(issue),
        provenance: z
          .object({
            source: z.object({ providerId: z.string() }),
            dataVersion: z.string().nullable(),
            forecastRunAt: z.string().optional(),
            retrievedAt: z.iso.datetime(),
            expiresAt: z.iso.datetime().optional(),
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
          })
          .optional(),
      }),
    ),
  }),
});
export const upload = async (
  harness: Harness,
  name = 'Synthetic ride',
  longitude = -1,
  southbound = false,
) => {
  const response = await harness.send('/routes', {
    body: routeGpx(name, longitude, southbound),
    contentType: 'application/gpx+xml',
  });
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  return z
    .object({
      route: z.object({
        id: z.uuid(),
        name: z.string(),
        distanceM: z.number(),
        ascentM: z.number().nullable(),
        warnings: z.array(z.string()),
      }),
    })
    .parse(await response.json()).route;
};
export const recommend = async (
  harness: Harness,
  routeIds: string[],
  overrides: Record<string, unknown> = {},
) => {
  const response = await harness.send('/recommendations', {
    body: JSON.stringify({ routeIds, date: RIDE_DATE, ...overrides }),
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  return responseSchema.parse(await response.json());
};
export const first = <T>(items: readonly T[]): T => {
  const value = items[0];
  if (value === undefined) throw new Error('Expected at least one result.');
  return value;
};

/** Existing Met Office scenarios choose their source explicitly, independently of new-user defaults. */
export const recommendMetOffice = (
  harness: Harness,
  routeIds: string[],
  overrides: Record<string, unknown> = {},
) =>
  recommend(harness, routeIds, {
    weather: { mode: 'strict', providerId: 'met-office' },
    forecast: { representation: 'deterministic', freshnessBasis: 'model-run' },
    ...overrides,
  });
