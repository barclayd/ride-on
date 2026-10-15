import { expect, test } from 'bun:test';
import { conditionsSchema } from '../src/recommendations/conditions.ts';
import {
  recommendRides,
  requiredWeatherFor,
} from '../src/recommendations/engine.ts';
import { meanWindFrom } from '../src/recommendations/wind-direction.ts';
import { prepareHistory } from '../src/rides/overlap.ts';
import {
  defaultValue,
  forecastsFor,
  inputFor,
  makeRoute,
  now,
  present,
} from './fixtures/rides.ts';

const row = (windFromDegrees: number, distanceM = 1, windSpeedKph = 12) => ({
  windFromDegrees,
  distanceM,
  windSpeedKph,
});
test('wind direction is circular, distance weighted, calm-aware and wrapped after rounding', () => {
  expect(meanWindFrom([row(350), row(10)])).toBe(0);
  expect(meanWindFrom([row(359.8)])).toBe(0);
  expect(meanWindFrom([row(90), row(270)])).toBeNull();
  expect(meanWindFrom([row(90, 1, 2.9)])).toBeNull();
  expect(meanWindFrom([row(90, 9, 0), row(270, 1, 40)])).toBe(270);
  expect(meanWindFrom([row(90, 3), row(270, 1)])).toBe(90);
  expect(meanWindFrom([row(90), row(90), row(90), row(270)])).toBe(90);
  expect(meanWindFrom([])).toBeNull();
});

test('departures and ride hours expose meteorological direction; historical plans may omit it', async () => {
  const route = await makeRoute();
  const input = inputFor([route]);
  const weather = forecastsFor([route], (q) =>
    q === 'wind-from-direction' ? 248 : defaultValue(q),
  );
  const ride = present(
    recommendRides([route], input, weather, now.getTime()).rankings[0]?.best ??
      undefined,
  );
  expect(ride.conditions.windFromDegrees).toBe(248);
  expect(ride.rideHours[0]?.conditions?.windFromDegrees).toBe(248);
  const { windFromDegrees: _old, ...old } = ride.conditions;
  expect(conditionsSchema.parse(old).windFromDegrees).toBeUndefined();
  expect(
    conditionsSchema.safeParse({ ...old, windFromDegrees: 360 }).success,
  ).toBe(false);
});

const counterfactualCase = async () => {
  const base = await makeRoute();
  const locations = [
    present(base.weatherLocations[0]),
    present(base.weatherLocations.at(-1)),
  ];
  const leg = present(base.legs[0]);
  const route = {
    ...base,
    distanceM: 20_000,
    ascentM: 500,
    legs: locations.map((location, i) => ({
      ...leg,
      fromM: i * 10_000,
      toM: (i + 1) * 10_000,
      coordinate: location.coordinate,
      weatherLocationId: location.id,
    })),
  };
  const input = inputFor([route], {
    riding: { window: { start: '09:00', end: '10:00' } },
    preferences: {
      temperature: { comfortMinC: 10, comfortMaxC: 22 },
      climbing: { preference: 'flatter' },
      distance: { minKm: 30, maxKm: 50 },
      weights: {
        temperature: 0.3,
        wind: 0.2,
        dryness: 0.3,
        sunshine: 0.1,
        clearSkies: 0.1,
      },
    },
  });
  const assess = (ideal?: string) => {
    const weather = forecastsFor(
      [route],
      (q, _h, _r, i) => {
        if (q === 'air-temperature')
          return ideal === 'temperature' ? 18 : i === 0 ? 27 : 18;
        if (q === 'probability')
          return ideal === 'dryness' ? 0 : i === 0 ? 0 : 0.4;
        if (q === 'sky-condition') return ideal === 'sunshine' ? 1 : 3;
        if (q === 'total-cloud-cover') return ideal === 'clearSkies' ? 0 : 0.5;
        if (q === 'wind-speed') return ideal === 'wind' ? 0 : 8;
        if (q === 'wind-gust') return ideal === 'wind' ? 0 : 15;
        if (q === 'wind-from-direction') return 90;
        return 0;
      },
      requiredWeatherFor(input),
    );
    const changedRoute =
      ideal === 'climbing' ? { ...route, ascentM: 0 } : route;
    const changedInput =
      ideal === 'distance'
        ? {
            ...input,
            preferences: {
              ...input.preferences,
              distance: { minKm: 10, maxKm: 30 },
            },
          }
        : input;
    return present(
      recommendRides([changedRoute], changedInput, weather, now.getTime())
        .rankings[0]?.best ?? undefined,
    );
  };
  return { assess };
};

test('factor points are actual counterfactual gains across the mean/worst blend and route shares', async () => {
  const { assess } = await counterfactualCase();
  const actual = assess();
  for (const factor of [
    'temperature',
    'wind',
    'dryness',
    'sunshine',
    'clearSkies',
    'climbing',
    'distance',
  ] as const) {
    const ideal = assess(factor);
    expect(actual.pointsLost[factor]).not.toBeNull();
    expect(actual.pointsLost[factor] ?? 0).toBeCloseTo(
      ideal.score - actual.score,
      1,
    );
  }
});

test('temperature-only loss equals the score gap; inactive factors are null', async () => {
  const route = await makeRoute();
  const input = inputFor([route], {
    preferences: { temperature: { comfortMinC: 10, comfortMaxC: 22 } },
  });
  const forecast = forecastsFor([route], (q) =>
    q === 'air-temperature' ? 27 : 0,
  );
  const ride = present(
    recommendRides([route], input, forecast, now.getTime()).rankings[0]?.best ??
      undefined,
  );
  expect(ride.pointsLost.temperature).toBeCloseTo(100 - ride.score, 2);
  expect(ride.pointsLost.wind).toBe(0);
  expect(ride.pointsLost.climbing).toBeNull();
  expect(ride.pointsLost.distance).toBeNull();
  expect(ride.pointsLost.sunshine).toBeNull();
});

test('counterfactual gains respect tailwind ceilings and the score floor after history', async () => {
  const route = await makeRoute();
  const input = inputFor([route], {
    preferences: {
      wind: { preferTailwind: true },
      weights: { temperature: 0.04, wind: 0.96, dryness: 0 },
    },
  });
  const weather = forecastsFor([route], (q) =>
    q === 'air-temperature' ? 12 : defaultValue(q),
  );
  const ride = present(
    recommendRides([route], input, weather, now.getTime()).rankings[0]?.best ??
      undefined,
  );
  expect(ride.score).toBe(100);
  expect(ride.pointsLost.temperature).toBe(0);
  const floorInput = inputFor([route], {
    preferences: { weights: { temperature: 0.01, wind: 0.01, dryness: 0.98 } },
  });
  const rainy = forecastsFor([route], (q) =>
    q === 'air-temperature'
      ? 6
      : q === 'probability'
        ? 1
        : q === 'precipitation-rate'
          ? 2
          : defaultValue(q),
  );
  const history = prepareHistory(
    [route],
    floorInput.preferences.recentRides,
    null,
    now.toISOString(),
    now.toISOString(),
  );
  const assessed = present(
    recommendRides(
      [route],
      floorInput,
      rainy,
      now.getTime(),
      undefined,
      undefined,
      {
        ...history,
        assess: (...args) => ({
          ...history.assess(...args),
          penaltyPoints: 10,
        }),
      },
    ).rankings[0]?.best ?? undefined,
  );
  expect(assessed.score).toBe(0);
  expect(assessed.pointsLost.temperature).toBe(0);
});

test('unknown sunshine has no invented points-lost explanation', async () => {
  const route = await makeRoute();
  const input = inputFor([route], {
    preferences: { weights: { sunshine: 0.25 } },
  });
  const weather = forecastsFor(
    [route],
    (q) => (q === 'sky-condition' ? null : defaultValue(q)),
    requiredWeatherFor(input),
  );
  const ride = present(
    recommendRides([route], input, weather, now.getTime()).rankings[0]?.best ??
      undefined,
  );
  expect(ride.sunshineAssessment?.status).toBe('unavailable');
  expect(ride.pointsLost.sunshine).toBeNull();
});
