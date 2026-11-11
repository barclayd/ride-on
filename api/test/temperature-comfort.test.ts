import { expect, test } from 'bun:test';
import {
  recommendRides,
  requiredWeatherFor,
} from '../src/recommendations/engine.ts';
import {
  heatScoreCeiling,
  temperatureComfort,
} from '../src/recommendations/temperature-comfort.ts';
import { skyConditions } from '../src/weather/conditions.ts';
import {
  forecastsFor,
  inputFor,
  makeRoute,
  now,
  present,
} from './fixtures/rides.ts';

const standard = {
  comfortMinC: 16,
  comfortMaxC: 32,
  coldSensitivity: 'standard' as const,
  seasonalTolerance: 'none' as const,
};
const loss = (c: number, p = standard) => {
  const t = temperatureComfort(c, p, null);
  return 1 - t.blendComfort + t.coldPenalty;
};

test('shared preference curve is symmetric, continuous and increasingly steep beyond the band', () => {
  for (const [min, max] of [
    [16, 32],
    [20, 20],
    [-10, 45],
  ] as const) {
    const p = { ...standard, comfortMinC: min, comfortMaxC: max };
    expect(loss(min, p)).toBe(0);
    expect(loss(max, p)).toBe(0);
    expect(loss(min - 1e-6, p)).toBeLessThan(1e-5);
    expect(loss(max + 1e-6, p)).toBeLessThan(1e-5);
    let previous = 0;
    let increment = 0;
    for (let d = 1; d <= 80; d++) {
      const cold = loss(min - d, p);
      expect(cold).toBeCloseTo(loss(max + d, p), 10);
      expect(cold).toBeGreaterThan(previous);
      expect(cold - previous).toBeGreaterThanOrEqual(increment - 1e-10);
      increment = cold - previous;
      previous = cold;
    }
  }
});

test('a warmer midpoint increases cold loss even with the same lower bound', () => {
  expect(loss(1, { ...standard, comfortMaxC: 32 })).toBeGreaterThan(
    loss(1, { ...standard, comfortMaxC: 24 }),
  );
});

test('high cold sensitivity never plateaus, while displayed comfort remains bounded', () => {
  let previous = 0;
  for (let c = 15; c >= -60; c--) {
    const t = temperatureComfort(
      c,
      { ...standard, coldSensitivity: 'high' },
      null,
    );
    expect(t.coldPenalty).toBeGreaterThan(previous);
    expect(t.comfort).toBeGreaterThanOrEqual(0);
    expect(t.comfort).toBeLessThanOrEqual(1);
    previous = t.coldPenalty;
  }
});

test('absolute heat ceiling joins continuously and tightens beyond 35°C', () => {
  expect(heatScoreCeiling(35)).toBe(100);
  expect(heatScoreCeiling(35 + 1e-6)).toBeCloseTo(100, 8);
  let previous = 100;
  for (let c = 35.1; c <= 80; c += 0.1) {
    const ceiling = heatScoreCeiling(c);
    expect(ceiling).toBeLessThan(previous);
    expect(ceiling).toBeGreaterThanOrEqual(0);
    previous = ceiling;
  }
});

const assess = async (
  temperatures: number[],
  options: {
    high?: boolean;
    winter?: boolean;
    weight?: number;
    max?: number;
    minimum?: number;
    maximum?: number;
    tailwind?: boolean;
  } = {},
) => {
  const base = await makeRoute();
  const route = {
    ...base,
    distanceM: 51_000,
    weatherLocations: temperatures.map((_, i) => ({
      ...present(base.weatherLocations[0]),
      id: `point-${i}`,
      coordinate: { latitude: 51.88, longitude: 0.55 },
    })),
    legs: temperatures.map((_, i) => ({
      ...present(base.legs[0]),
      weatherLocationId: `point-${i}`,
      coordinate: { latitude: 51.88, longitude: 0.55 },
      bearingDegrees: 0,
      fromM: (i * 51_000) / temperatures.length,
      toM: ((i + 1) * 51_000) / temperatures.length,
    })),
  };
  const input = inputFor([route], {
    date: options.winter ? '2026-11-14' : '2026-10-10',
    riding: { window: { start: '07:30', end: '12:00' } },
    preferences: {
      temperature: {
        ...standard,
        comfortMaxC: options.max ?? 32,
        coldSensitivity: options.high ? 'high' : 'standard',
        seasonalTolerance: options.winter ? 'cooler-winters' : 'none',
      },
      wind: { preferTailwind: options.tailwind ?? false },
      weights: {
        temperature: options.weight ?? 0.15,
        wind: 0.4,
        dryness: 0.2,
        sunshine: 0.25,
        clearSkies: 0,
      },
      minimumStandards: {
        ...(options.minimum === undefined
          ? {}
          : { minimumTemperature: { kind: 'fixed', valueC: options.minimum } }),
        ...(options.maximum === undefined
          ? {}
          : { maximumTemperatureC: options.maximum }),
      },
    },
  });
  const forecasts = forecastsFor(
    [route],
    (q, _h, _r, i) =>
      q === 'air-temperature'
        ? present(temperatures[i])
        : q === 'sky-condition'
          ? skyConditions.sunny
          : q === 'wind-speed' && options.tailwind
            ? 5
            : q === 'wind-from-direction' && options.tailwind
              ? 180
              : 0,
    requiredWeatherFor(input),
  );
  if (options.winter) {
    // Re-date synthetic October forecast samples without changing their weather.
    const shift = (value: unknown): unknown =>
      typeof value === 'string' && value.startsWith('2026-10-10')
        ? value.replace('2026-10-10', '2026-11-14')
        : Array.isArray(value)
          ? value.map(shift)
          : value && typeof value === 'object'
            ? Object.fromEntries(
                Object.entries(value).map(([k, v]) => [k, shift(v)]),
              )
            : value;
    return present(
      recommendRides(
        [route],
        input,
        shift(forecasts) as typeof forecasts,
        now.getTime(),
      ).rankings[0]?.best ?? undefined,
    );
  }
  return present(
    recommendRides([route], input, forecasts, now.getTime()).rankings[0]
      ?.best ?? undefined,
  );
};

test('synthetic Braintree-like sunny November ride falls into the mid-60s', async () => {
  const ride = await assess([-1, 1, 2], { high: true, winter: true });
  expect(ride.score).toBeGreaterThanOrEqual(63);
  expect(ride.score).toBeLessThanOrEqual(66);
  expect(ride.pointsLost.temperature).toBeCloseTo(100 - ride.score, 2);
});

test('cold and heat continue reducing the final score after temperature comfort reaches zero', async () => {
  for (const temperatures of [
    [6, 1, -5, -15],
    [42, 47, 52, 62],
  ]) {
    let previous = 101;
    for (const c of temperatures) {
      const ride = await assess([c]);
      expect(ride.factors.temperature).toBe(0);
      expect(ride.score).toBeLessThan(previous);
      expect(ride.score).toBeGreaterThanOrEqual(0);
      previous = ride.score;
    }
  }
});

test('heat screen cannot be disabled by a wide band, zero weight or tailwind', async () => {
  const ideal = await assess([24], { weight: 0, max: 50 });
  for (const c of [38, 40, 42, 45]) {
    const hot = await assess([c], { weight: 0, max: 50, tailwind: true });
    expect(hot.score).toBeCloseTo(heatScoreCeiling(c), 2);
    expect(hot.pointsLost.temperature).toBeCloseTo(ideal.score - hot.score, 2);
    expect(hot.windAssistance.appliedPoints).toBe(0);
    expect(hot.drawbacks.some((s) => s.includes('High air temperatures'))).toBe(
      true,
    );
  }
  expect((await assess([1], { weight: 0 })).score).toBe(ideal.score);
});

test('heat screen preserves the hottest section and independent hard standards', async () => {
  const brief = await assess([24, 24, 24, 42], { maximum: 39 });
  expect(brief.score).toBeCloseTo(heatScoreCeiling(42), 2);
  expect(brief.standards.status).toBe('below');
  const cold = await assess([1], { minimum: 5, weight: 0 });
  expect(cold.standards.status).toBe('below');
});
