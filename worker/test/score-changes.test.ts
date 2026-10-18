import { expect, test } from 'bun:test';
import { recommendRides } from '../src/recommendations/engine.ts';
import {
  planningDaysSchema,
  resolvePlanningDays,
} from '../src/recommendations/planning.ts';
import {
  nextScoreChange,
  rememberScoreChanges,
  type ScoreChangeEntry,
  scoreChangePlanKey,
} from '../src/recommendations/score-changes.ts';
import {
  forecastsFor,
  inputFor,
  makeRoute,
  now,
  present,
} from './fixtures/rides.ts';

const entry: ScoreChangeEntry = {
  routeId: 'ride',
  planKey: 'plan',
  contextKey: 'context',
  score: 84,
};

test('one rounded point updates the badge; unchanged scores retain its timestamp and reversals remain visible', () => {
  const first = nextScoreChange(null, entry, now);
  expect(first).toEqual({ reference: 84, change: null });
  const state = { ...first, contextKey: entry.contextKey };
  expect(nextScoreChange(state, { ...entry, score: 83.6 }, now)).toEqual(first);
  const changedAt = new Date('2026-10-09T13:00:00Z');
  const changed = nextScoreChange(state, { ...entry, score: 83.4 }, changedAt);
  expect(changed).toEqual({
    reference: 83,
    change: { from: 84, to: 83, by: -1, changedAt: changedAt.toISOString() },
  });
  const previous = { ...changed, contextKey: entry.contextKey };
  expect(
    nextScoreChange(
      previous,
      { ...entry, score: 82.6 },
      new Date('2026-10-10'),
    ),
  ).toEqual(changed);
  expect(nextScoreChange(previous, entry, changedAt).change).toEqual({
    from: 83,
    to: 84,
    by: 1,
    changedAt: changedAt.toISOString(),
  });
});

test('quiet rebases keep the historical badge and measure the next weather change from the new reference', () => {
  const change = { from: 84, to: 70, by: -14, changedAt: now.toISOString() };
  const rebased = nextScoreChange(
    { contextKey: 'old', reference: 70, change },
    { ...entry, score: 90 },
    now,
  );
  expect(rebased).toEqual({ reference: 90, change });
  expect(
    nextScoreChange(
      { ...rebased, contextKey: entry.contextKey },
      { ...entry, score: 91 },
      now,
    ).change,
  ).toEqual({ from: 90, to: 91, by: 1, changedAt: now.toISOString() });
});

test('plans distinguish named presets and windows, but equal explicit dates and ranges share state', async () => {
  const key = await scoreChangePlanKey(
    { kind: 'dates', dates: ['2026-10-10', '2026-10-11'] },
    'daylight',
  );
  expect(
    await scoreChangePlanKey(
      { kind: 'range', start: '2026-10-10', end: '2026-10-11' },
      'daylight',
    ),
  ).toBe(key);
  expect(
    await scoreChangePlanKey(
      { kind: 'dates', dates: ['2026-10-10'] },
      'daylight',
    ),
  ).not.toBe(key);
  expect(
    await scoreChangePlanKey({ kind: 'preset', preset: 'weekend' }, 'daylight'),
  ).not.toBe(key);
  expect(
    await scoreChangePlanKey(
      { kind: 'dates', dates: ['2026-10-10', '2026-10-11'] },
      { start: '09:00', end: '14:00' },
    ),
  ).not.toBe(key);
  expect(
    await scoreChangePlanKey({ kind: 'preset', preset: 'next' }, 'daylight'),
  ).not.toBe(
    await scoreChangePlanKey(
      { kind: 'preset', preset: 'next-five-days' },
      'daylight',
    ),
  );
});

test('next-five-days starts tomorrow in the effective zone through DST and persists as a planning preference', () => {
  const days = planningDaysSchema.parse({
    kind: 'preset',
    preset: 'next-five-days',
  });
  expect(
    resolvePlanningDays(days, 'Europe/London', new Date('2026-10-24T22:30:00Z'))
      .dates,
  ).toEqual([
    '2026-10-25',
    '2026-10-26',
    '2026-10-27',
    '2026-10-28',
    '2026-10-29',
  ]);
  expect(
    resolvePlanningDays(days, 'Europe/London', new Date('2026-10-24T23:30:00Z'))
      .dates,
  ).toEqual([
    '2026-10-26',
    '2026-10-27',
    '2026-10-28',
    '2026-10-29',
    '2026-10-30',
  ]);
  expect(
    resolvePlanningDays(
      days,
      'America/Los_Angeles',
      new Date('2026-01-01T01:00:00Z'),
    ).dates,
  ).toEqual([
    '2026-01-01',
    '2026-01-02',
    '2026-01-03',
    '2026-01-04',
    '2026-01-05',
  ]);
});

test('scoring context rebases for inputs and slots, not midnight, display units, route names or the winning departure', async () => {
  const route = await makeRoute();
  const input = inputFor([route]);
  const evaluation = recommendRides(
    [route],
    input,
    forecastsFor([route]),
    now.getTime(),
  );
  const ranked = present(evaluation.rankings[0]);
  const best = present(ranked.best ?? undefined);
  const capture = async (
    options: {
      input?: typeof input;
      route?: typeof route;
      result?: typeof evaluation;
      at?: Date;
      source?: unknown;
      history?: unknown;
    } = {},
  ) => {
    let entries: readonly ScoreChangeEntry[] = [];
    await rememberScoreChanges(
      options.result ?? evaluation,
      [options.route ?? route],
      { kind: 'preset', preset: 'tomorrow' },
      options.input ?? input,
      options.source ?? { providerId: 'fixture', productId: 'hourly' },
      options.history ?? { revision: 1 },
      'alice',
      options.at ?? now,
      async (_owner, received) => {
        entries = received;
        return new Map();
      },
    );
    return present(entries[0]);
  };
  const initial = await capture();
  for (const options of [
    { at: new Date('2026-10-10T00:00:00Z') },
    {
      input: {
        ...input,
        display: { unit: 'mi' as const },
        units: { temperature: 'F' as const, windSpeed: 'mph' as const },
      },
    },
    { route: { ...route, name: 'Renamed' } },
    {
      result: {
        ...evaluation,
        rankings: [
          {
            ...ranked,
            best: {
              ...best,
              score: 50,
              departureAt: '2026-10-10T13:00:00Z',
              date: '2026-10-11',
            },
          },
        ],
      },
    },
  ])
    expect((await capture(options)).contextKey).toBe(initial.contextKey);
  for (const options of [
    {
      input: {
        ...input,
        preferences: {
          ...input.preferences,
          wind: { ...input.preferences.wind, preferTailwind: true },
        },
      },
    },
    { input: { ...input, riding: { ...input.riding, averageSpeedKph: 22 } } },
    {
      input: {
        ...input,
        riding: { ...input.riding, departureStepMinutes: 60 },
      },
    },
    {
      input: {
        ...input,
        weather: { mode: 'strict' as const, providerId: 'other' },
      },
    },
    { input: { ...input, timeZone: 'UTC' } },
    { route: { ...route, distanceM: route.distanceM + 100 } },
    { route: { ...route, ascentM: 999 } },
    { source: { providerId: 'fixture', productId: 'other' } },
    { history: { revision: 2 } },
    {
      result: {
        ...evaluation,
        rankings: [
          { ...ranked, assessedDepartures: ranked.assessedDepartures.slice(1) },
        ],
      },
    },
  ]) {
    const changed = await capture(options);
    expect(changed.contextKey).not.toBe(initial.contextKey);
    expect(changed.planKey).toBe(initial.planKey);
  }
  const unranked = await capture({
    result: { ...evaluation, rankings: [], unranked: [ranked] },
  });
  expect(unranked).toEqual(initial);
  expect(
    await rememberScoreChanges(
      evaluation,
      [route],
      { kind: 'preset', preset: 'tomorrow' },
      input,
      null,
      null,
      'alice',
      now,
      async () => {
        throw new Error('synthetic failure');
      },
    ),
  ).toEqual(new Map());
});
