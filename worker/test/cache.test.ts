import { expect, test } from 'bun:test';
import { requiredWeather } from '../src/recommendations/engine.ts';
import { withForecastCache } from '../src/weather/cache.ts';
import type {
  ForecastProvider,
  ForecastRequest,
} from '../src/weather/contracts.ts';
import { forecastsFor, makeRoute, now, present } from './fixtures/rides.ts';

test('cache reuses equivalent locations with new IDs, expires by retrieval and model age, and ignores corruption', async () => {
  const route = await makeRoute();
  const values = new Map<string, string>();
  let calls = 0;
  let current = now.getTime();
  const provider: ForecastProvider = {
    source: { providerId: 'fixture', productId: 'hourly', adapterVersion: '1' },
    getCapabilities: async () => ({
      available: [],
      maxLocationsPerUpstreamRequest: 1,
    }),
    getForecast: async (request) => {
      calls++;
      return forecastsFor([route])
        .slice(0, 1)
        .map((result) =>
          result.status === 'unavailable'
            ? result
            : {
                ...result,
                provenance: {
                  ...result.provenance,
                  retrievedAt: new Date(current).toISOString(),
                },
                location: {
                  ...result.location,
                  requested: present(request.locations[0]),
                },
              },
        );
    },
  };
  const cached = withForecastCache(
    provider,
    {
      get: async (key) => values.get(key) ?? null,
      put: async (key, value) => {
        values.set(key, value);
      },
    },
    { now: () => new Date(current) },
  );
  const request: ForecastRequest = {
    locations: [present(route.weatherLocations[0])],
    range: { start: '2026-10-10T07:00:00Z', end: '2026-10-10T17:00:00Z' },
    required: requiredWeather,
    maxTimeStepSeconds: 3600,
    maxAgeSeconds: 21600,
    maxLocationDistanceM: 10000,
  };
  const signal = new AbortController().signal;
  await cached.getForecast(request, signal);
  await cached.getForecast(request, signal);
  expect(calls).toBe(1);
  const renamed = await cached.getForecast(
    {
      ...request,
      locations: [{ ...present(request.locations[0]), id: 'renamed' }],
    },
    signal,
  );
  expect(calls).toBe(1);
  expect(
    renamed[0]?.status !== 'unavailable' && renamed[0]?.location.requested.id,
  ).toBe('renamed');
  current += 1_201_000;
  await cached.getForecast(request, signal);
  expect(calls).toBe(2);
  for (const key of values.keys()) values.set(key, '{broken');
  await cached.getForecast(request, signal);
  expect(calls).toBe(3);
  current = now.getTime() + 21601_000;
  await cached.getForecast(request, signal);
  expect(calls).toBe(4);
  await cached.getForecast(request, signal);
  expect(calls).toBe(5);
});
