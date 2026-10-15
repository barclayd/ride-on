import { expect, test } from 'bun:test';
import data from '../src/climate/haduk-grid.json';
import { monthlyClimateAt, seasonalNormal } from '../src/climate/seasonal.ts';
import {
  recommendRides,
  requiredWeatherFor,
} from '../src/recommendations/engine.ts';
import {
  defaultSettings,
  mergeSettings,
  settingsPatchSchema,
  settingsSchema,
} from '../src/recommendations/input.ts';
import { temperatureComfort } from '../src/recommendations/temperature-comfort.ts';
import { skyConditions } from '../src/weather/conditions.ts';
import {
  forecastsFor,
  inputFor,
  makeRoute,
  now,
  present,
} from './fixtures/rides.ts';

const personal = {
  comfortMinC: 16,
  comfortMaxC: 32,
  coldSensitivity: 'high' as const,
  seasonalTolerance: 'cooler-winters' as const,
};

test('bundled normals have complete months, unique cells and bounded geometry', () => {
  expect(data.cells).toHaveLength(1707);
  expect(new Set(data.cells.map((c) => c.id)).size).toBe(1707);
  for (const cell of data.cells) {
    expect(cell.maximumC).toHaveLength(12);
    expect(
      cell.maximumC.every((v) => Number.isFinite(v) && v > -30 && v < 50),
    ).toBe(true);
    expect(cell.ring[0]).toEqual(cell.ring.at(-1));
    expect(
      cell.ring.every(
        ([x, y]) =>
          x !== undefined &&
          y !== undefined &&
          x > -10 &&
          x < 3 &&
          y > 49 &&
          y < 61,
      ),
    ).toBe(true);
  }
});

test('local normals cover the UK examples, without assigning UK seasons abroad', () => {
  for (const coordinate of [
    { latitude: 51.06, longitude: -0.33 },
    { latitude: 51.46, longitude: -0.3 },
    { latitude: 55.86, longitude: -4.25 },
  ]) {
    const monthly = monthlyClimateAt(coordinate);
    expect(monthly).not.toBeNull();
    expect(seasonalNormal(monthly ?? [], '2026-10-17')).toBeGreaterThan(
      seasonalNormal(monthly ?? [], '2027-01-17') ?? Infinity,
    );
  }
  for (const coordinate of [
    { latitude: 48.86, longitude: 2.35 },
    { latitude: -33.87, longitude: 151.21 },
    { latitude: 0, longitude: 0 },
  ])
    expect(monthlyClimateAt(coordinate)).toBeNull();
});

test('normal interpolation is continuous over month/year boundaries and leap days', () => {
  const monthly = [8, 9, 11, 14, 17, 20, 22, 22, 19, 15, 11, 9];
  expect(seasonalNormal(monthly, '2026-10-15')).toBe(15);
  expect(seasonalNormal(monthly, '2026-10-31')).toBeCloseTo(15 - (4 * 16) / 31);
  expect(seasonalNormal(monthly, '2026-11-01')).toBeCloseTo(15 - (4 * 17) / 31);
  expect(seasonalNormal(monthly, '2027-01-01')).toBeCloseTo(9 - 17 / 31);
  expect(seasonalNormal(monthly, '2028-02-29')).toBeCloseTo(9 + (2 * 14) / 29);
});

test('legacy profiles gain neutral defaults; partial patches preserve explicit intent', () => {
  const legacy = structuredClone(defaultSettings);
  const {
    coldSensitivity: _cold,
    seasonalTolerance: _season,
    ...temperature
  } = legacy.preferences.temperature;
  const parsed = settingsSchema.parse({
    ...legacy,
    preferences: { ...legacy.preferences, temperature },
  });
  expect(parsed.preferences.temperature.coldSensitivity).toBe('standard');
  expect(parsed.preferences.temperature.seasonalTolerance).toBe('none');
  const saved = settingsSchema.parse(
    mergeSettings({ preferences: { temperature: personal } }, parsed),
  );
  const patched = settingsSchema.parse(
    mergeSettings(
      settingsPatchSchema.parse({
        preferences: { temperature: { comfortMaxC: 30 } },
      }),
      saved,
    ),
  );
  expect(patched.preferences.temperature).toEqual({
    ...personal,
    comfortMaxC: 30,
  });
  for (const value of [null, true, 1, 'automatic', {}]) {
    expect(
      settingsPatchSchema.safeParse({
        preferences: { temperature: { seasonalTolerance: value } },
      }).success,
    ).toBe(false);
    expect(
      settingsPatchSchema.safeParse({
        preferences: { temperature: { coldSensitivity: value } },
      }).success,
    ).toBe(false);
  }
});

test('cold comfort is monotonic, bounded and continuous; heat and the ideal band are preserved', () => {
  for (const seasonalTolerance of ['none', 'cooler-winters'] as const) {
    for (const normal of [null, -10, 8, 15, 24]) {
      let previous = 0;
      for (let value = -50; value <= 32; value += 0.1) {
        const t = temperatureComfort(
          value,
          { ...personal, seasonalTolerance },
          normal,
        );
        expect(t.comfort).toBeGreaterThanOrEqual(previous - 1e-12);
        expect(t.comfort).toBeGreaterThanOrEqual(0);
        expect(t.comfort).toBeLessThanOrEqual(1);
        expect(t.adjustmentC).toBeGreaterThanOrEqual(0);
        expect(t.adjustmentC).toBeLessThanOrEqual(6);
        previous = t.comfort;
      }
      for (const value of [16, 24, 30, 32])
        expect(temperatureComfort(value, personal, normal).comfort).toBe(1);
      for (const value of [33, 36, 45]) {
        const high = temperatureComfort(value, personal, normal);
        const standard = temperatureComfort(
          value,
          {
            ...personal,
            coldSensitivity: 'standard',
            seasonalTolerance: 'none',
          },
          null,
        );
        expect(high.comfort).toBe(standard.comfort);
        expect(high.blendComfort).toBe(standard.blendComfort);
        expect(high.coldPenalty).toBe(0);
      }
    }
  }
  expect(
    temperatureComfort(16 - 0.000001, personal, null).coldPenalty,
  ).toBeLessThan(0.000001);
  expect(temperatureComfort(10, personal, null)).toEqual(
    temperatureComfort(10, { ...personal, seasonalTolerance: 'none' }, 8),
  );
  expect(temperatureComfort(10, personal, 8).coldPenalty).toBeLessThan(
    temperatureComfort(10, personal, 15).coldPenalty,
  );
});

const assess = async (
  temperatures: number[],
  options: {
    sunny?: boolean;
    uncovered?: boolean;
    weight?: number;
    onlyTemperature?: boolean;
    minimum?: number;
    high?: boolean;
  } = {},
) => {
  const base = await makeRoute();
  const location = present(base.weatherLocations[0]);
  const leg = present(base.legs[0]);
  const locations = temperatures.map((_, index) => ({
    ...location,
    id: `test-${index}`,
    ...(options.uncovered && index === 0
      ? { coordinate: { latitude: 48.86, longitude: 2.35 } }
      : {}),
  }));
  const route = {
    ...base,
    distanceM: 80_000,
    weatherLocations: locations,
    legs: temperatures.map((_, i) => ({
      ...leg,
      weatherLocationId: present(locations[i]).id,
      coordinate: present(locations[i]).coordinate,
      fromM: (i * 80_000) / temperatures.length,
      toM: ((i + 1) * 80_000) / temperatures.length,
    })),
  };
  const input = inputFor([route], {
    riding: { window: { start: '09:00', end: '13:00' } },
    preferences: {
      temperature: {
        ...personal,
        coldSensitivity: options.high === false ? 'standard' : 'high',
      },
      weights: {
        temperature: options.weight ?? 0.15,
        wind: options.onlyTemperature ? 0 : 0.4,
        dryness: options.onlyTemperature ? 0 : 0.2,
        sunshine: options.onlyTemperature ? 0 : 0.25,
        clearSkies: 0,
      },
      minimumStandards:
        options.minimum === undefined
          ? {}
          : {
              minimumTemperature: {
                kind: 'monthly',
                valuesC: { '10': options.minimum },
                fallbackC: null,
              },
            },
    },
  });
  const forecast = forecastsFor(
    [route],
    (quantity, _hour, _route, index) =>
      quantity === 'air-temperature'
        ? present(temperatures[index])
        : quantity === 'sky-condition'
          ? options.sunny === false
            ? skyConditions.sunnyIntervals
            : skyConditions.sunny
          : 0,
    requiredWeatherFor(input),
  );
  const ranked = present(
    recommendRides([route], input, forecast, now.getTime()).rankings[0],
  );
  return present(ranked.best ?? undefined);
};

for (const [sunnyC, intervalsC, sunWins] of [
  [8, 12, true],
  [8, 14, false],
  [16, 20, true],
  [22, 26, true],
] as const) {
  test(`opted-in scoring preserves ${sunnyC} sunny / ${intervalsC} intervals preference`, async () => {
    const sunny = await assess([sunnyC]);
    const intervals = await assess([intervalsC], { sunny: false });
    expect(sunny.score > intervals.score).toBe(sunWins);
  });
}

test('brief cold start is proportional: warming ride beats sustained cold; segmentation does not change it', async () => {
  const warming = await assess([7, 13, 13, 13, 13, 13, 13, 13]);
  const steady = await assess([10]);
  expect(warming.score).toBeGreaterThan(steady.score);
  const split = await assess(Array(8).fill(10));
  expect(split.score).toBe(steady.score);
});

test('seasonal coverage is explicit, does not remove hard monthly limits or change actual conditions', async () => {
  const missing = await assess([10], { uncovered: true });
  expect(missing.temperatureAssessment.seasonal.status).toBe('unavailable');
  expect(missing.temperatureAssessment.effectiveMinimumC).toEqual({
    minimum: 16,
    maximum: 16,
  });
  const mixed = await assess([10, 10], { uncovered: true });
  expect(mixed.temperatureAssessment.seasonal.status).toBe('partial');
  expect(mixed.temperatureAssessment.seasonal.coveredDistanceFraction).toBe(
    0.5,
  );
  const limited = await assess([7, 13], { minimum: 8 });
  expect(limited.standards.status).toBe('below');
  expect(limited.standards.failures[0]?.limit).toBe(8);
  expect(limited.conditions).toEqual(
    (await assess([7, 13], { high: false })).conditions,
  );
});

test('zero temperature importance disables cold loss; counterfactual points include it exactly once and scores are bounded', async () => {
  const cold = await assess([7]);
  const ideal = await assess([20]);
  expect(cold.pointsLost.temperature).toBeCloseTo(ideal.score - cold.score, 2);
  expect((await assess([7], { weight: 0 })).score).toBe(
    (await assess([20], { weight: 0 })).score,
  );
  expect((await assess([7], { weight: 0 })).pointsLost.temperature).toBeNull();
  const extreme = await assess([-40], { weight: 1, onlyTemperature: true });
  expect(extreme.score).toBe(0);
  expect(extreme.pointsLost.temperature).toBe(100);
  expect(extreme.windAssistance.appliedPoints).toBe(0);
});
