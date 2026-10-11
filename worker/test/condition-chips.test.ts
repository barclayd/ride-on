import { expect, test } from 'bun:test';
import { conditionsSchema } from '../src/recommendations/conditions.ts';
import {
  ALGORITHM_VERSION,
  recommendRides,
  requiredWeatherFor,
} from '../src/recommendations/engine.ts';
import { applePrecipitationType } from '../src/weather/apple-weather.ts';
import { precipitationTypeDescriptor } from '../src/weather/descriptors.ts';
import { metOfficePrecipitationType } from '../src/weather/met-office-symbols.ts';
import {
  summarizePrecipitation,
  precipitationTypes as wet,
} from '../src/weather/precipitation.ts';
import {
  defaultValue,
  forecastsFor,
  inputFor,
  makeRoute,
  now,
  present,
} from './fixtures/rides.ts';

test.each([
  ['tailwind', [0], [30000], { headwind: 0, tailwind: 1, crosswind: 0 }],
  ['crosswind', [90], [30000], { headwind: 0, tailwind: 0, crosswind: 1 }],
  ['headwind', [180], [30000], { headwind: 1, tailwind: 0, crosswind: 0 }],
  [
    'half and half',
    [0, 90],
    [15000, 15000],
    { headwind: 0, tailwind: 0.5, crosswind: 0.5 },
  ],
  [
    'unequal lengths',
    [0, 90],
    [10000, 20000],
    { headwind: 0, tailwind: 0.33, crosswind: 0.67 },
  ],
  [
    'thirds',
    [0, 90, 180],
    [10000, 10000, 10000],
    { headwind: 0.33, tailwind: 0.33, crosswind: 0.33 },
  ],
] as const)('wind shares measure route distance: %s', async (_name, bearings, distances, expected) => {
  const base = await makeRoute();
  let from = 0;
  const route = {
    ...base,
    distanceM: 30000,
    legs: bearings.map((bearingDegrees, i) => {
      const fromM = from;
      from += distances[i] ?? 0;
      return { ...present(base.legs[0]), bearingDegrees, fromM, toM: from };
    }),
  };
  const input = inputFor([route]);
  const result = recommendRides(
    [route],
    input,
    forecastsFor([route]),
    now.getTime(),
  );
  const best = present(result.rankings[0]).best;
  if (!best) throw new Error('Expected a ranked ride');
  expect(best.conditions.windDistanceFractions).toEqual(expected);
  expect(
    Math.abs(Object.values(expected).reduce<number>((a, b) => a + b, 0) - 1),
  ).toBeLessThanOrEqual(0.010000001);
  expect(best.rideHours.some((h) => h.conditions !== null)).toBe(true);
  for (const hour of best.rideHours) {
    if (!hour.conditions) continue;
    expect(hour.conditions.windDistanceFractions).toBeDefined();
    expect(hour.conditions.precipitationSummary).toBe('dry');
  }
});

test.each([
  [0, 0, 'dry'],
  [0.099, 0.299, 'dry'],
  [0, 0.3, 'possible'],
  [0.1, 0, 'light_rain'],
  [0.499, 0.9, 'light_rain'],
  [0.5, 0, 'rain'],
  [3.999, 0, 'rain'],
  [4, 0, 'heavy_rain'],
] as const)('precipitation fallback uses rate %s and probability %s', (rate, probability, expected) => {
  expect(
    summarizePrecipitation([
      {
        precipitationType: null,
        precipitationRateMmH: rate,
        precipitationProbability: probability,
      },
    ]),
  ).toBe(expected);
});

test('provider type has precedence and the worst observed type wins in any row order', () => {
  const rows = Object.values(wet).map((precipitationType) => ({
    precipitationType,
    precipitationRateMmH: 9,
    precipitationProbability: 0,
  }));
  for (let i = 1; i <= rows.length; i++) {
    const subset = rows.slice(0, i);
    const expected = present(Object.keys(wet)[i - 1]);
    expect(expected).toBe(summarizePrecipitation(subset));
    expect(expected).toBe(summarizePrecipitation(subset.reverse()));
  }
});

test('type enrichment works with sunshine disabled and changes no score or ranking', async () => {
  const route = await makeRoute();
  const input = inputFor([route]);
  const base = recommendRides(
    [route],
    input,
    forecastsFor([route]),
    now.getTime(),
  );
  const enriched = recommendRides(
    [route],
    input,
    forecastsFor(
      [route],
      (q) => (q === 'precipitation-type' ? wet.snow : defaultValue(q)),
      [...requiredWeatherFor(input), precipitationTypeDescriptor],
    ),
    now.getTime(),
  );
  const withoutLabels = (value: unknown) =>
    JSON.parse(
      JSON.stringify(value, (key, item) =>
        key === 'precipitationSummary' ? undefined : item,
      ),
    );
  expect(withoutLabels(enriched)).toEqual(withoutLabels(base));
  expect(enriched.algorithmVersion).toBe(ALGORITHM_VERSION);
  const best = present(enriched.rankings[0]).best;
  if (!best) throw new Error('Expected a ranked ride');
  expect(best.conditions.precipitationSummary).toBe('snow');
  expect(best.conditions.skyConditionDistanceFractions).toBeNull();
  const conditions = best.conditions;
  const {
    windDistanceFractions: _wind,
    precipitationSummary: _rain,
    ...legacy
  } = conditions;
  expect(conditionsSchema.parse(legacy)).toEqual(legacy);
  expect(
    conditionsSchema.safeParse({
      ...conditions,
      windDistanceFractions: { headwind: 1, tailwind: 1, crosswind: 0 },
    }).success,
  ).toBe(false);
  expect(
    conditionsSchema.safeParse({
      ...conditions,
      precipitationSummary: 'invented',
    }).success,
  ).toBe(false);
});

test('Met Office symbols preserve light showers, frozen precipitation, thunder and trace rain', () => {
  const expected = [
    wet.light_showers,
    wet.light_showers,
    wet.drizzle,
    wet.light_rain,
    wet.heavy_showers,
    wet.heavy_showers,
    wet.heavy_rain,
    wet.sleet,
    wet.sleet,
    wet.sleet,
    wet.hail,
    wet.hail,
    wet.hail,
    wet.snow,
    wet.snow,
    wet.snow,
    wet.snow,
    wet.snow,
    wet.snow,
    wet.thunder,
    wet.thunder,
    wet.thunder,
  ];
  for (const [i, type] of expected.entries())
    expect(metOfficePrecipitationType(i + 9)).toBe(type);
  expect(metOfficePrecipitationType(-1)).toBe(wet.light_rain);
  for (const code of [0, 1, 4, 8, 31, 12.5, NaN])
    expect(metOfficePrecipitationType(code)).toBeNull();
});

test('Apple labels preserve showers, snow and thunder without treating wind or blowing snow as falling rain', () => {
  for (const [code, expected] of [
    ['Drizzle', wet.drizzle],
    ['FreezingDrizzle', wet.drizzle],
    ['Rain', wet.rain],
    ['FreezingRain', wet.rain],
    ['HeavyRain', wet.heavy_rain],
    ['SunShowers', wet.showers],
    ['Sleet', wet.sleet],
    ['WintryMix', wet.sleet],
    ['Snow', wet.snow],
    ['SunFlurries', wet.snow],
    ['Flurries', wet.snow],
    ['Blizzard', wet.snow],
    ['HeavySnow', wet.snow],
    ['Hail', wet.hail],
    ['Thunderstorms', wet.thunder],
    ['IsolatedThunderstorms', wet.thunder],
    ['ScatteredThunderstorms', wet.thunder],
    ['StrongStorms', wet.thunder],
    ['TropicalStorm', wet.rain],
    ['Hurricane', wet.rain],
  ] as const)
    expect(applePrecipitationType(code)).toBe(expected);
  for (const code of ['Breezy', 'Clear', 'BlowingSnow', 'FutureCode', null])
    expect(applePrecipitationType(code)).toBeNull();
});
