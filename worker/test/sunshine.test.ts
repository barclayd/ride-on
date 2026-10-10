import { expect, test } from 'bun:test';
import profile from '../../evaluation/sunshine-profile-v3.json';
import {
  recommendRides,
  requiredWeatherFor,
} from '../src/recommendations/engine.ts';
import { skyConditions } from '../src/weather/conditions.ts';
import { weatherDescriptors } from '../src/weather/descriptors.ts';
import { normaliseBpf } from '../src/weather/met-office-bpf.ts';
import { normaliseGlobalSpot } from '../src/weather/met-office-global-spot.ts';
import { metOfficeSkyCondition } from '../src/weather/met-office-symbols.ts';
import { bpfFixture } from './fixtures/bpf.ts';
import { globalSpotFixture } from './fixtures/global-spot.ts';
import {
  defaultValue,
  forecastsFor,
  inputFor,
  makeRoute,
  now,
} from './fixtures/rides.ts';

test('sunshine and total cloud are independent preferences, not interchangeable percentages', async () => {
  const sunny = await makeRoute();
  const cloudy = await makeRoute();
  const routes = [sunny, cloudy];
  const input = inputFor(routes, profile.request);
  const forecasts = forecastsFor(
    routes,
    (q, _h, route) =>
      q === 'sky-condition'
        ? route.id === sunny.id
          ? skyConditions.sunnyIntervals
          : skyConditions.overcast
        : q === 'air-temperature'
          ? route.id === sunny.id
            ? 14
            : 17
          : defaultValue(q),
    requiredWeatherFor(input),
  );
  const result = recommendRides(routes, input, forecasts, now.getTime());
  expect(result.recommendedRouteId).toBe(sunny.id);
  expect(result.rankings[0]?.best?.factors.sunshine).toBe(70);
  expect(result.rankings[0]?.best?.conditions.cloudCoverFraction).toBeNull();
  expect(
    result.rankings[0]?.best?.conditions.skyConditionDistanceFractions
      ?.sunnyIntervals,
  ).toBe(1);
});

test('BPF weather symbols keep native intervals and are not falsely reported as p50 cloud', () => {
  const location = { id: 'sun', coordinate: { latitude: 51.2, longitude: -1 } };
  const request = {
    locations: [location],
    required: [weatherDescriptors.skyCondition],
    range: { start: '2026-10-10T08:00:00Z', end: '2026-10-10T12:00:00Z' },
    freshnessBasis: 'retrieval-time' as const,
    maxAgeSeconds: 21600,
    maxTimeStepSeconds: 3600,
    maxLocationDistanceM: 10_000,
  };
  const result = normaliseBpf(
    [bpfFixture()],
    location,
    request,
    now.toISOString(),
  );
  expect(result.status).toBe('complete');
  if (result.status === 'unavailable')
    throw new Error('Expected weather symbol');
  expect(result.series[0]?.descriptor).toMatchObject({
    kind: 'category',
    basis: 'provider-weather-symbol',
  });
  expect(result.series[0]?.samples[10]).toMatchObject({
    value: skyConditions.sunnyIntervals,
    time: {
      kind: 'period',
      aggregation: 'categorical-summary',
      range: {
        start: '2026-10-10T09:00:00.000Z',
        end: '2026-10-10T10:00:00.000Z',
      },
    },
  });
});

test('both adapters use the same categorical vocabulary and reject unknown codes', () => {
  const location = { id: 'sun', coordinate: { latitude: 52, longitude: -1 } };
  const result = normaliseGlobalSpot(
    globalSpotFixture(),
    location,
    {
      locations: [location],
      required: [weatherDescriptors.skyCondition],
      range: { start: '2026-10-09T10:00:00Z', end: '2026-10-09T12:00:00Z' },
      maxAgeSeconds: 21600,
      maxTimeStepSeconds: 3600,
      maxLocationDistanceM: 10_000,
    },
    '2026-10-09T12:00:00Z',
  );
  expect(result.status).toBe('complete');
  if (result.status !== 'unavailable')
    expect(result.series[0]?.samples[0]?.value).toBe(
      skyConditions.sunnyIntervals,
    );
  for (const bad of [-2, 4, 31, 100, 1.5, NaN])
    expect(metOfficeSkyCondition(bad)).toBeNull();
  expect(metOfficeSkyCondition(0)).toBe(skyConditions.clearNight);
  expect(metOfficeSkyCondition(1)).toBe(skyConditions.sunny);
  expect(metOfficeSkyCondition(8)).toBe(skyConditions.overcast);
  expect(metOfficeSkyCondition(10)).toBe(skyConditions.precipitation);
});
