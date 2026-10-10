import { expect, test } from 'bun:test';
import { recommendRides } from '../src/recommendations/engine.ts';
import {
  defaultSettings,
  mergeSettings,
  recommendationApiRequestSchema,
  settingsPatchSchema,
  settingsSchema,
} from '../src/recommendations/input.ts';
import { preferenceLevels } from '../src/recommendations/levels.ts';
import {
  planningDaysSchema,
  resolvePlanningDays,
} from '../src/recommendations/planning.ts';
import { presentRoute } from '../src/recommendations/presentation.ts';
import {
  defaultValue,
  forecastsFor,
  inputFor,
  makeRoute,
  now,
  present,
} from './fixtures/rides.ts';

test('weekend resolution on every weekday, next capped at five, and local midnight use calendar days', () => {
  for (let day = 5; day <= 11; day++) {
    const result = resolvePlanningDays(
      { kind: 'preset', preset: 'weekend' },
      'Europe/London',
      new Date(`2026-10-${String(day).padStart(2, '0')}T12:00:00Z`),
    );
    expect(result.dates).toEqual(
      day === 11 ? ['2026-10-11'] : ['2026-10-10', '2026-10-11'],
    );
  }
  expect(
    resolvePlanningDays(
      { kind: 'preset', preset: 'next' },
      'Europe/London',
      new Date('2026-10-24T23:30:00Z'),
    ).dates,
  ).toEqual([
    '2026-10-25',
    '2026-10-26',
    '2026-10-27',
    '2026-10-28',
    '2026-10-29',
  ]);
  expect(
    resolvePlanningDays(
      { kind: 'preset', preset: 'tomorrow' },
      'America/Los_Angeles',
      new Date('2026-10-10T01:00:00Z'),
    ).dates,
  ).toEqual(['2026-10-10']);
});
test('expired ranges are explicit, partially elapsed ranges retain remaining dates, and ranges are bounded', () => {
  expect(
    resolvePlanningDays(
      { kind: 'range', start: '2026-10-01', end: '2026-10-03' },
      'Europe/London',
      now,
    ),
  ).toEqual({ range: null, expired: true, dates: [] });
  expect(
    resolvePlanningDays(
      { kind: 'range', start: '2026-10-08', end: '2026-10-11' },
      'Europe/London',
      now,
    ).dates,
  ).toEqual(['2026-10-09', '2026-10-10', '2026-10-11']);
  for (const [start, end] of [
    ['2026-10-10', '2026-10-09'],
    ['2026-10-10', '2026-10-17'],
  ])
    expect(
      planningDaysSchema.safeParse({ kind: 'range', start, end }).success,
    ).toBe(false);
});
test('API requires one date selection and bounded opt-in previews', () => {
  const routeIds = ['00000000-0000-4000-8000-000000000001'];
  for (const input of [
    {},
    { date: '2026-10-10', days: { kind: 'preset', preset: 'next' } },
    { date: '2026-10-10', previewDays: 8 },
  ])
    expect(
      recommendationApiRequestSchema.safeParse({ routeIds, ...input }).success,
    ).toBe(false);
  expect(
    recommendationApiRequestSchema.parse({ routeIds, date: '2026-10-10' })
      .previewDays,
  ).toBeUndefined();
});
test('levels preserve calibrated and custom weights, conflict atomically, and do not remove standards', () => {
  expect(preferenceLevels({ sunshine: 0.25, dryness: 0.2 })).toEqual({
    sunshine: 'important',
    rain: 'light-ok',
  });
  expect(preferenceLevels({ sunshine: 0.18, dryness: 0.6 })).toEqual({
    sunshine: 'custom',
    rain: 'custom',
  });
  const base = settingsSchema.parse(
    mergeSettings({
      preferences: {
        weights: { sunshine: 0.18, dryness: 0.6 },
        minimumStandards: { maximumPrecipitationProbability: 0.2 },
      },
    }),
  );
  const changed = settingsSchema.parse(
    mergeSettings({ preferenceLevels: { rain: 'dont-mind' } }, base),
  );
  expect(changed.preferences.weights).toEqual({
    ...base.preferences.weights,
    dryness: 0,
  });
  expect(changed.preferences.minimumStandards).toEqual(
    base.preferences.minimumStandards,
  );
  expect(
    settingsPatchSchema.safeParse({
      preferenceLevels: { rain: 'avoid' },
      preferences: { weights: { dryness: 0.2 } },
    }).success,
  ).toBe(false);
  expect(
    recommendationApiRequestSchema.safeParse({
      routeIds: ['00000000-0000-4000-8000-000000000001'],
      date: '2026-10-10',
      preferenceLevels: { sunshine: 'nice' },
      preferences: { weights: { sunshine: 0.3 } },
    }).success,
  ).toBe(false);
  expect(
    settingsPatchSchema.safeParse({ preferenceLevels: { rain: 'custom' } })
      .success,
  ).toBe(false);
});
test('legacy settings gain planning/display without changing weather; planning subvalues replace atomically', () => {
  const { planning: _planning, display: _display, ...legacy } = defaultSettings;
  expect(settingsSchema.parse(legacy).planning).toEqual({
    days: { kind: 'preset', preset: 'next' },
    window: 'daylight',
  });
  const changed = settingsSchema.parse(
    mergeSettings({
      planning: { window: { start: '09:00', end: '13:00' } },
      display: { unit: 'mi' },
    }),
  );
  expect(changed.planning.days).toEqual(defaultSettings.planning.days);
  expect(changed.weather).toEqual(defaultSettings.weather);
  expect(
    settingsPatchSchema.safeParse({ planning: { window: { start: '10:00' } } })
      .success,
  ).toBe(false);
});
test('missing elevation exposes a weather-only assessment without inventing a comparable combined score', async () => {
  const route = await makeRoute({ ascentM: null });
  const input = inputFor([route], {
    preferences: { climbing: { preference: 'flatter' } },
  });
  const result = recommendRides(
    [route],
    input,
    forecastsFor([route]),
    now.getTime(),
  );
  expect(result.rankings).toHaveLength(0);
  const r = presentRoute(present(result.unranked[0]), 30);
  expect(r.partialAssessment?.weatherScore).toBeGreaterThan(0);
  expect(r.partialAssessment?.score).toBeNull();
  expect(r.verdict.code).toBe('missing_elevation');
  expect(r.coverage.assessedFraction).toBe(0);
});
test('worst breach timestamp and position are tied to the worst observation, not the first failure', async () => {
  const route = await makeRoute({ distanceM: 40_000 });
  // Spread section positions over the overridden duration so different hours are encountered.
  route.legs = route.legs.map((leg, i, all) => ({
    ...leg,
    fromM: (i * route.distanceM) / all.length,
    toM: ((i + 1) * route.distanceM) / all.length,
  }));
  const input = inputFor([route], {
    riding: { window: { start: '09:00', end: '11:00' } },
    preferences: {
      minimumStandards: { minimumTemperature: { kind: 'fixed', valueC: 16 } },
    },
  });
  const data = forecastsFor([route], (q, h) =>
    q === 'air-temperature' ? (h < 9 ? 14 : 8) : defaultValue(q),
  );
  const r = recommendRides([route], input, data, now.getTime());
  const failure = present(present(r.rankings[0]).best?.standards.failures[0]);
  expect(failure.actual).toBe(8);
  expect(failure.at).not.toBe(failure.sections[0]?.observedAt);
  expect(failure.positionKm).toBeGreaterThan(0);
  expect(failure.date).toBe('2026-10-10');
});

test('multi-day ordering remains standards-first and deterministic; diagnostic weather can come from a later date', async () => {
  const { mergeDays } = await import('../src/recommendations/multi-day.ts');
  const route = await makeRoute();
  const firstInput = inputFor([route], {
    preferences: { minimumStandards: { maximumGustKph: 25 } },
  });
  const secondInput = { ...firstInput, date: '2026-10-11' };
  const firstWeather = forecastsFor([route], (q) =>
    q === 'wind-gust' ? 8 : defaultValue(q),
  );
  const secondWeather = forecastsFor([route], (q) =>
    q === 'air-temperature' ? 12 : defaultValue(q),
  ).map((result) =>
    result.status === 'unavailable'
      ? result
      : {
          ...result,
          series: result.series.map((series) => ({
            ...series,
            samples: series.samples.map((sample) => {
              const shift = (s: string) =>
                new Date(Date.parse(s) + 86400000).toISOString();
              return {
                ...sample,
                validAt: shift(sample.validAt),
                time:
                  sample.time.kind === 'instant'
                    ? { ...sample.time, at: shift(sample.time.at) }
                    : {
                        ...sample.time,
                        range: {
                          start: shift(sample.time.range.start),
                          end: shift(sample.time.range.end),
                        },
                      },
              };
            }),
          })),
        },
  );
  const firstDay = recommendRides(
    [route],
    firstInput,
    firstWeather,
    now.getTime(),
  );
  const secondDay = recommendRides(
    [route],
    secondInput,
    secondWeather,
    now.getTime(),
  );
  expect(present(firstDay.rankings[0]).best?.score).toBeGreaterThan(
    present(secondDay.rankings[0]).best?.score ?? 0,
  );
  expect(
    present(mergeDays([firstDay, secondDay], true).rankings[0]).best?.date,
  ).toBe('2026-10-11');
  const incomplete = { ...route, ascentM: null };
  const climbingInput = inputFor([incomplete], {
    preferences: { climbing: { preference: 'flatter' } },
  });
  const absent = recommendRides([incomplete], climbingInput, [], now.getTime());
  const diagnostic = recommendRides(
    [incomplete],
    { ...climbingInput, date: '2026-10-11' },
    secondWeather,
    now.getTime(),
  );
  expect(
    present(mergeDays([absent, diagnostic], false).unranked[0])
      .partialAssessment?.date,
  ).toBe('2026-10-11');
});
