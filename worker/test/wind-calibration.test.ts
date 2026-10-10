import { expect, test } from 'bun:test';
import profile from '../../evaluation/sunshine-profile-v4.json';
import {
  recommendRides,
  requiredWeatherFor,
} from '../src/recommendations/engine.ts';
import { recommendationSchema } from '../src/recommendations/input.ts';
import { importGpx } from '../src/routes/gpx.ts';
import { skyConditions } from '../src/weather/conditions.ts';
import {
  defaultValue,
  forecastsFor,
  inputFor,
  makeRoute,
  now,
  present,
} from './fixtures/rides.ts';

const kphPerMph = 1.609344;

test('personal crosswind sensitivity can outweigh sunshine while a tolerant rider chooses the sunny route', async () => {
  const cross = await makeRoute({ name: 'Sunny with eight mph crosswind' });
  const calm = await makeRoute({ name: 'Warmer overcast with three mph wind' });
  const routes = [cross, calm];
  const input = inputFor(routes, profile.request);
  const weather = forecastsFor(
    routes,
    (q, _h, route) => {
      const windy = route.id === cross.id;
      if (q === 'air-temperature') return windy ? 14 : 17;
      if (q === 'wind-speed' || q === 'wind-gust')
        return ((windy ? 8 : 3) * kphPerMph) / 3.6;
      if (q === 'wind-from-direction') return 90;
      if (q === 'sky-condition')
        return windy ? skyConditions.sunny : skyConditions.overcast;
      return defaultValue(q);
    },
    requiredWeatherFor(input),
  );
  const result = recommendRides(routes, input, weather, now.getTime());
  expect(result.recommendedRouteId).toBe(calm.id);
  const crossRide = present(
    result.rankings.find((r) => r.routeId === cross.id)?.best ?? undefined,
  );
  expect(crossRide.conditions.assistedDistanceFraction).toBe(0);
  expect(crossRide.conditions.averageCrosswindKph).toBeCloseTo(
    8 * kphPerMph,
    2,
  );
  const tolerant = inputFor(routes, {
    ...profile.request,
    preferences: {
      ...profile.request.preferences,
      wind: { ...profile.request.preferences.wind, crosswindSensitivity: 1 },
    },
  });
  expect(
    recommendRides(routes, tolerant, weather, now.getTime()).recommendedRouteId,
  ).toBe(cross.id);
});

test('calibration retains cooler sunshine, dry conditions and warmer helpful-wind preferences', async () => {
  const a = await makeRoute();
  const b = await makeRoute();
  const routes = [a, b];
  const input = inputFor(routes, profile.request);
  for (const scenario of ['sunshine', 'rain', 'tailwind'] as const) {
    const weather = forecastsFor(
      routes,
      (q, _h, route) => {
        const preferred = route.id === a.id;
        if (q === 'air-temperature')
          return scenario === 'sunshine'
            ? preferred
              ? 14
              : 17
            : scenario === 'rain'
              ? preferred
                ? 13
                : 18
              : preferred
                ? 18
                : 13;
        if (q === 'wind-speed')
          return scenario === 'tailwind' ? (preferred ? 22 : 8) / 3.6 : 1;
        if (q === 'wind-gust') return scenario === 'tailwind' ? 22 / 3.6 : 2;
        if (q === 'sky-condition')
          return scenario === 'sunshine'
            ? preferred
              ? skyConditions.sunnyIntervals
              : skyConditions.overcast
            : skyConditions.sunnyIntervals;
        if (scenario === 'rain' && !preferred) {
          // A defined synthetic case, not inferred probabilities from the original question.
          if (q === 'probability') return 0.6;
          if (q === 'precipitation-rate') return 0.8;
        }
        return defaultValue(q);
      },
      requiredWeatherFor(input),
    );
    expect(
      recommendRides(routes, input, weather, now.getTime()).recommendedRouteId,
    ).toBe(a.id);
  }
});

test('three mph circular rides remain fully wind-comfortable regardless of assistance', async () => {
  const loop = await importGpx(
    '<gpx version="1.1"><trk><trkseg><trkpt lat="51.5" lon="-0.1"/><trkpt lat="51.52" lon="-0.1"/><trkpt lat="51.52" lon="-0.08"/><trkpt lat="51.5" lon="-0.08"/><trkpt lat="51.5" lon="-0.1"/></trkseg></trk></gpx>',
  );
  const input = inputFor([loop], profile.request);
  const weather = forecastsFor(
    [loop],
    (q) =>
      q === 'wind-speed' || q === 'wind-gust'
        ? (3 * kphPerMph) / 3.6
        : q === 'sky-condition'
          ? skyConditions.sunny
          : defaultValue(q),
    requiredWeatherFor(input),
  );
  const best = present(
    recommendRides([loop], input, weather, now.getTime()).rankings[0]?.best ??
      undefined,
  );
  expect(best.factors.wind).toBe(100);
  expect(best.score).toBe(100);
  expect(best.conditions.assistedDistanceFraction).toBeLessThan(0.5);
});

test('stronger crosswinds worsen comfort monotonically, sensitivity is bounded, and tailwinds are not penalised as crosswind', async () => {
  const route = await makeRoute();
  const input = inputFor([route], profile.request);
  let previous = Infinity;
  for (const speed of [0, 3, 5, 8, 13, 18, 25, 50]) {
    const weather = forecastsFor(
      [route],
      (q) =>
        q === 'wind-speed'
          ? speed / 3.6
          : q === 'wind-from-direction'
            ? 90
            : q === 'sky-condition'
              ? skyConditions.sunny
              : defaultValue(q),
      requiredWeatherFor(input),
    );
    const score = present(
      recommendRides([route], input, weather, now.getTime()).rankings[0]
        ?.best ?? undefined,
    ).score;
    expect(score).toBeLessThanOrEqual(previous);
    expect(score).toBeGreaterThanOrEqual(0);
    previous = score;
  }
  for (const direction of [0, 90, 100, 180, 270]) {
    const weather = forecastsFor(
      [route],
      (q) =>
        q === 'wind-speed'
          ? 22 / 3.6
          : q === 'wind-from-direction'
            ? direction
            : q === 'sky-condition'
              ? skyConditions.sunny
              : defaultValue(q),
      requiredWeatherFor(input),
    );
    const best = present(
      recommendRides([route], input, weather, now.getTime()).rankings[0]
        ?.best ?? undefined,
    );
    expect(best.conditions.assistedDistanceFraction).toBe(
      direction === 180 ? 1 : 0,
    );
    if (direction === 180) expect(best.factors.wind).toBe(100);
  }
  expect(inputFor([route]).preferences.wind.crosswindSensitivity).toBe(1);
  for (const value of [-1, 10.01, 'high', null]) {
    expect(
      recommendationSchema.safeParse({
        routeIds: [route.id],
        date: '2026-10-10',
        preferences: { wind: { crosswindSensitivity: value } },
      }).success,
    ).toBe(false);
  }
});
