import { expect, test } from 'bun:test';
import { requiredWeather } from '../src/recommendations/engine.ts';
import { withForecastCache } from '../src/weather/cache.ts';
import type { ForecastProvider } from '../src/weather/contracts.ts';
import { forecastsFor, makeRoute, now, present } from './fixtures/rides.ts';

test('horizon snapshots survive the hour and freshness-policy changes without discarding retained evidence', async () => {
  const route = await makeRoute();
  const result = present(forecastsFor([route])[0]);
  if (result.status === 'unavailable') throw new Error('Expected fixture');
  const saved = new Map<string, string>();
  let clock = new Date('2026-10-09T19:55:00Z');
  let calls = 0;
  const cache = {
    get: async (key: string) => saved.get(key) ?? null,
    put: async (key: string, value: string, ttl: number) => {
      expect(ttl).toBe(43200);
      saved.set(key, value);
    },
  };
  const provider: ForecastProvider = {
    source: result.provenance.source,
    getCapabilities: async () => ({
      available: [],
      maxLocationsPerUpstreamRequest: 1,
    }),
    getForecast: async (request) => {
      calls++;
      return request.locations.map((location) => ({
        ...result,
        location: { ...result.location, requested: location },
        provenance: { ...result.provenance, retrievedAt: clock.toISOString() },
      }));
    },
  };
  const read = (hours: number) =>
    withForecastCache(provider, cache, {
      now: () => clock,
      forecastHorizonHours: 48,
      ttlSeconds: hours * 3600,
      retentionSeconds: 43200,
    }).getForecast(
      {
        locations: [result.location.requested],
        required: requiredWeather,
        maxTimeStepSeconds: 3600,
        maxLocationDistanceM: 10000,
        maxAgeSeconds: hours * 3600,
        freshnessBasis: 'retrieval-time',
        range: { start: '2026-10-10T08:00:00Z', end: '2026-10-10T17:00:00Z' },
      },
      new AbortController().signal,
    );
  await read(3);
  clock = new Date('2026-10-09T20:05:00Z');
  await read(3);
  expect(calls).toBe(1);
  clock = new Date('2026-10-10T03:00:00Z');
  await read(12);
  expect(calls).toBe(1); // Seven-hour-old evidence remains available for distant days.
  await read(3);
  expect(calls).toBe(2); // Selecting today tightens freshness immediately.
  expect(saved.size).toBe(1);
  clock = new Date('2026-10-10T05:59:59Z');
  await read(3);
  expect(calls).toBe(2);
  clock = new Date('2026-10-10T06:00:00Z');
  await read(3);
  expect(calls).toBe(3); // Expiry is relative to retrieval, including the exact boundary.
});

test('horizon caching ignores selected dates but preserves original comparison coverage for fallback and expiry', async () => {
  const route = await makeRoute();
  const result = present(forecastsFor([route])[0]);
  if (result.status === 'unavailable')
    throw new Error('Expected weather fixture');
  const saved = new Map<string, string>();
  let calls = 0;
  const provider: ForecastProvider = {
    source: result.provenance.source,
    getCapabilities: async () => ({
      available: [],
      maxLocationsPerUpstreamRequest: 1,
    }),
    getForecast: async (request) => {
      calls++;
      expect(
        Date.parse(request.range.end) - Date.parse(request.range.start),
      ).toBe(48 * 3600000);
      return [
        {
          ...result,
          status: 'partial',
          issues: [
            {
              code: 'outside-forecast-horizon',
              message: 'Unused prefetched hours are outside coverage.',
            },
          ],
        },
      ];
    },
  };
  let clock = now;
  const cached = withForecastCache(
    provider,
    {
      get: async (key) => saved.get(key) ?? null,
      put: async (key, value) => {
        saved.set(key, value);
      },
    },
    { now: () => clock, forecastHorizonHours: 48 },
  );
  const request = {
    locations: [result.location.requested],
    required: requiredWeather,
    maxTimeStepSeconds: 3600,
    maxLocationDistanceM: 10000,
    maxAgeSeconds: 21600,
    freshnessBasis: 'retrieval-time' as const,
    range: { start: '2026-10-10T08:00:00Z', end: '2026-10-10T17:00:00Z' },
  };
  expect(
    present(
      (await cached.getForecast(request, new AbortController().signal))[0],
    ).status,
  ).toBe('complete');
  const later = present(
    (
      await cached.getForecast(
        {
          ...request,
          range: { start: '2026-10-11T08:00:00Z', end: '2026-10-11T17:00:00Z' },
        },
        new AbortController().signal,
      )
    )[0],
  );
  expect(calls).toBe(1);
  expect(later.status).toBe('partial');
  expect(later.issues.some((i) => i.code === 'outside-forecast-horizon')).toBe(
    true,
  );
  clock = new Date(now.getTime() + 21 * 60000);
  await cached.getForecast(request, new AbortController().signal);
  expect(calls).toBe(2);
});
