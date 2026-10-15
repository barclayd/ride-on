import { expect, test } from 'bun:test';
import {
  recommendRides,
  requiredWeatherFor,
} from '../src/recommendations/engine.ts';
import { windComfort } from '../src/recommendations/wind-comfort.ts';
import { skyConditions } from '../src/weather/conditions.ts';
import {
  forecastsFor,
  inputFor,
  makeRoute,
  now,
  present,
} from './fixtures/rides.ts';

// Agreed calibration case: two dry, warm hours with 10 mph crosswinds and
// 30 mph gusts feel good with noticeable compromises (80–85), not ideal.
const wind = {
  preferTailwind: false,
  comfortableHeadwindKph: 16,
  comfortableCrosswindKph: 16,
  comfortableGustKph: 25,
  crosswindSensitivity: 5,
};
test('warm dry crosswind/gust cases earn 80–85 without failing the separate gust limit', async () => {
  const route = await makeRoute({ distanceM: 40_000 });
  // Use a 40 km synthetic northbound route with uniform section lengths.
  const distance = route.legs.at(-1)?.toM ?? 1;
  const scaled = {
    ...route,
    legs: route.legs.map((l) => ({
      ...l,
      fromM: (l.fromM * 40_000) / distance,
      toM: (l.toM * 40_000) / distance,
    })),
  };
  const input = inputFor([scaled], {
    preferences: {
      wind,
      weights: {
        temperature: 0.15,
        wind: 0.4,
        dryness: 0.2,
        sunshine: 0.25,
        clearSkies: 0,
      },
      minimumStandards: { maximumGustKph: 55 },
    },
  });
  const forecast = (crosswindMph: number, gustMph: number) =>
    forecastsFor(
      [scaled],
      (q) =>
        q === 'air-temperature'
          ? 20
          : q === 'wind-speed'
            ? (crosswindMph * 1.609344) / 3.6
            : q === 'wind-gust'
              ? (gustMph * 1.609344) / 3.6
              : q === 'wind-from-direction'
                ? 270
                : q === 'sky-condition'
                  ? skyConditions.sunny
                  : 0,
      requiredWeatherFor(input),
    );
  const weather = forecast(10, 30);
  const best = present(
    recommendRides([scaled], input, weather, now.getTime()).rankings[0]?.best ??
      undefined,
  );
  expect(best.score).toBeGreaterThanOrEqual(80);
  expect(best.score).toBeLessThanOrEqual(85);
  expect(best.standards.status).toBe('meets');
  expect(best.score).toBeLessThan(90);
  const stronger = present(
    recommendRides([scaled], input, forecast(11, 31), now.getTime()).rankings[0]
      ?.best ?? undefined,
  );
  expect(stronger.score).toBeGreaterThanOrEqual(80);
  expect(stronger.score).toBeLessThanOrEqual(85);
  expect(stronger.score).toBeLessThan(best.score);
  const lowerLimit = {
    ...input,
    preferences: {
      ...input.preferences,
      minimumStandards: { maximumGustKph: 45 },
    },
  };
  const below = present(
    recommendRides([scaled], lowerLimit, weather, now.getTime()).rankings[0]
      ?.best ?? undefined,
  );
  expect(below.standards.status).toBe('below');
  expect(below.score).toBe(best.score);
  const briefGusts = forecastsFor(
    [scaled],
    (q, _h, _r, index) =>
      q === 'air-temperature'
        ? 20
        : q === 'wind-speed'
          ? (10 * 1.609344) / 3.6
          : q === 'wind-gust'
            ? ((index === 0 ? 30 : 10) * 1.609344) / 3.6
            : q === 'wind-from-direction'
              ? 270
              : q === 'sky-condition'
                ? skyConditions.sunny
                : 0,
    requiredWeatherFor(input),
  );
  const brief = present(
    recommendRides([scaled], input, briefGusts, now.getTime()).rankings[0]
      ?.best ?? undefined,
  );
  expect(brief.score).toBeGreaterThan(best.score);
});

test('wind comfort is gradual, monotone, bounded and personal', () => {
  expect(windComfort(0, 0, 0, wind)).toBe(1);
  expect(windComfort(0, 4.8, 4.8, wind)).toBe(1);
  expect(windComfort(0, 15, 20, wind)).toBeLessThan(
    windComfort(0, 6, 20, wind),
  );
  for (const axis of [0, 1, 2]) {
    let previous = 1;
    for (let speed = 0; speed <= 150; speed++) {
      const v = [0, 0, 0];
      v[axis] = speed;
      const score = windComfort(v[0] ?? 0, v[1] ?? 0, v[2] ?? 0, wind);
      expect(score).toBeLessThanOrEqual(previous);
      expect(score).toBeGreaterThanOrEqual(0);
      previous = score;
    }
  }
  expect(
    windComfort(0, 16, 48, {
      ...wind,
      comfortableCrosswindKph: 25,
      comfortableGustKph: 45,
    }),
  ).toBeGreaterThan(windComfort(0, 16, 48, wind));
  expect(windComfort(0, 50, 0, { ...wind, crosswindSensitivity: 0 })).toBe(1);
  expect(windComfort(-25, 0, 0, wind)).toBe(1);
  expect(
    windComfort(0, 0, 0, {
      ...wind,
      comfortableHeadwindKph: 0,
      comfortableCrosswindKph: 0,
      comfortableGustKph: 0,
    }),
  ).toBe(1);
});
