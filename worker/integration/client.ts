import assert from 'node:assert/strict';
import { z } from 'zod';
import { routeGpx } from './fixtures.ts';
import { type Harness, RIDE_DATE } from './harness.ts';

const conditions = z.object({
  temperatureC: z.object({ minimum: z.number(), maximum: z.number() }),
  maximumGustKph: z.number(),
  skyConditionDistanceFractions: z
    .record(z.string(), z.number().min(0).max(1))
    .nullable(),
  averageWindSpeedKph: z.number(),
  averageCrosswindKph: z.number(),
  cloudCoverFraction: z
    .object({ mean: z.number(), maximum: z.number() })
    .nullable(),
  maximumPrecipitationProbability: z.number().min(0).max(1),
  maximumPrecipitationRateMmH: z.number(),
  assistedDistanceFraction: z.number().min(0).max(1),
});
const candidate = z.object({
  departureAt: z.iso.datetime(),
  finishAt: z.iso.datetime(),
  score: z.number().min(0).max(100),
  conditions,
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
    window: z.literal('daylight'),
  }),
  resolvedMinimumTemperature: z.object({
    valueC: z.number().nullable(),
    resolved: z.boolean(),
    origin: z.string(),
  }),
  rankings: z.array(
    z.object({
      routeId: z.uuid(),
      best: candidate,
      alternatives: z.array(candidate),
      estimatedDurationMinutes: z.number(),
      daylight: z.object({ start: z.iso.datetime(), end: z.iso.datetime() }),
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
            attribution: z.array(
              z.object({ text: z.string(), url: z.string() }),
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
