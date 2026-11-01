import { expect, test } from 'bun:test';
import {
  recommendRides,
  requiredWeatherFor,
} from '../src/recommendations/engine.ts';
import { skyConditions } from '../src/weather/conditions.ts';
import {
  forecastsFor,
  inputFor,
  makeRoute,
  now,
  present,
} from './fixtures/rides.ts';

// Explicit personal settings from the interview, never application defaults.
const preferences = {
  temperature: { comfortMinC: 16, comfortMaxC: 32 },
  sunshine: { sunnyIntervalsComfort: 0.7 },
  weights: {
    temperature: 0.15,
    wind: 0.4,
    dryness: 0.2,
    sunshine: 0.25,
    clearSkies: 0,
  },
};

const assess = async (
  temperatureC: number,
  skyCondition: number,
  settings = preferences,
) => {
  const base = await makeRoute();
  const route = {
    ...base,
    distanceM: 80_000,
    legs: [{ ...present(base.legs[0]), fromM: 0, toM: 80_000 }],
  };
  const input = inputFor([route], {
    preferences: settings,
    riding: { window: { start: '09:00', end: '13:00' } },
  });
  const forecasts = forecastsFor(
    [route],
    (q) =>
      q === 'air-temperature'
        ? temperatureC
        : q === 'sky-condition'
          ? skyCondition
          : 0,
    requiredWeatherFor(input),
  );
  return present(
    recommendRides([route], input, forecasts, now.getTime()).rankings[0]
      ?.best ?? undefined,
  );
};

for (const { sunnyC, intervalsC, preferSun } of [
  { sunnyC: 8, intervalsC: 12, preferSun: true },
  { sunnyC: 8, intervalsC: 14, preferSun: false },
  { sunnyC: 16, intervalsC: 20, preferSun: true },
  { sunnyC: 22, intervalsC: 26, preferSun: true },
]) {
  test(`personal warmth/sunshine comparison: ${sunnyC}°C sunny versus ${intervalsC}°C intervals`, async () => {
    const sunny = await assess(sunnyC, skyConditions.sunny);
    const intervals = await assess(intervalsC, skyConditions.sunnyIntervals);
    expect(sunny.score > intervals.score).toBe(preferSun);
    expect(sunny.score).not.toBe(intervals.score);
  });
}

test('the full saved ideal range is equally comfortable, including its boundaries', async () => {
  const rides = await Promise.all(
    [16, 24, 30, 32].map((c) => assess(c, skyConditions.sunnyIntervals)),
  );
  for (const ride of rides) {
    expect(ride.factors.temperature).toBe(100);
    expect(ride.score).toBe(present(rides[0]).score);
  }
});

test('another rider’s ideal range changes the choice rather than inheriting the interview temperatures', async () => {
  const settings = {
    ...preferences,
    temperature: { comfortMinC: 8, comfortMaxC: 12 },
  };
  const sunny = await assess(8, skyConditions.sunny, settings);
  const warmer = await assess(14, skyConditions.sunnyIntervals, settings);
  expect(sunny.factors.temperature).toBe(100);
  expect(warmer.factors.temperature).toBeLessThan(100);
  expect(sunny.score).toBeGreaterThan(warmer.score);
});

test('sunshine affects this trade-off only when the saved preferences value it', async () => {
  const settings = {
    ...preferences,
    weights: { ...preferences.weights, sunshine: 0 },
  };
  const cold = await assess(8, skyConditions.sunny, settings);
  const warmer = await assess(12, skyConditions.sunnyIntervals, settings);
  expect(warmer.score).toBeGreaterThan(cold.score);
  const insideSunny = await assess(16, skyConditions.sunny, settings);
  const insideIntervals = await assess(
    24,
    skyConditions.sunnyIntervals,
    settings,
  );
  expect(insideSunny.score).toBe(insideIntervals.score);
});

test('temperature importance comes from the saved profile, not the interview’s trade-off', async () => {
  const settings = {
    ...preferences,
    weights: { ...preferences.weights, temperature: 0 },
  };
  const sunny = await assess(8, skyConditions.sunny, settings);
  const warmer = await assess(14, skyConditions.sunnyIntervals, settings);
  expect(sunny.score).toBeGreaterThan(warmer.score);
});
