import { expect, test } from 'bun:test';
import { recommendRides } from '../src/recommendations/engine.ts';
import {
  attachPreviousScores,
  type PreviousScore,
  type ScoreBaselineStore,
} from '../src/recommendations/score-baselines.ts';
import {
  defaultValue,
  forecastsFor,
  inputFor,
  makeRoute,
  present,
} from './fixtures/rides.ts';

const scenario = async () => {
  const route = await makeRoute();
  const input = inputFor([route]);
  const saved = new Map<string, PreviousScore>();
  const remember: ScoreBaselineStore = async (_owner, entries) => {
    for (const entry of entries)
      if (!saved.has(entry.key))
        saved.set(entry.key, {
          score: entry.score,
          generatedAt: entry.generatedAt,
        });
    return saved;
  };
  const evaluate = async (
    options: {
      at?: string;
      revision?: number;
      provider?: string;
      route?: typeof route;
      value?: Parameters<typeof forecastsFor>[1];
      store?: ScoreBaselineStore;
    } = {},
  ) => {
    const currentRoute = options.route ?? route;
    const at = new Date(options.at ?? '2026-10-09T13:00:00Z');
    const result = recommendRides(
      [currentRoute],
      input,
      forecastsFor([currentRoute], options.value),
      at.getTime(),
    );
    await attachPreviousScores(
      [{ input, result }],
      [currentRoute],
      'owner',
      at,
      { providerId: options.provider ?? 'fixture' },
      { revision: options.revision ?? 1 },
      options.store ?? remember,
    );
    return present(result.rankings[0]?.best ?? undefined);
  };
  return { route, evaluate };
};

test('history, actual route facts and selected source changes invalidate the score baseline', async () => {
  const { route, evaluate } = await scenario();
  const first = await evaluate({ at: '2026-10-09T12:00:00Z' });
  expect(first.previous).toBeNull();
  expect((await evaluate()).previous?.score).toBe(first.score);
  expect((await evaluate({ revision: 2 })).previous).toBeNull();
  expect((await evaluate({ provider: 'other-provider' })).previous).toBeNull();
  expect(
    (await evaluate({ route: { ...route, ascentM: 999 } })).previous,
  ).toBeNull();
});

test('a different best departure remains comparable when the available slots are unchanged', async () => {
  const { evaluate } = await scenario();
  const before = await evaluate({ at: '2026-10-09T12:00:00Z' });
  const later = await evaluate({
    value: (q, hour) =>
      q === 'air-temperature' ? (hour >= 11 ? 20 : 10) : defaultValue(q),
  });
  expect(later.departureAt).not.toBe(before.departureAt);
  expect(later.previous?.score).toBe(before.score);
});

test('local midnight and elapsed departure slots reset comparisons independently', async () => {
  const { evaluate } = await scenario();
  expect((await evaluate({ at: '2026-10-09T22:59:00Z' })).previous).toBeNull();
  // British summer time: local midnight falls within the same UTC date.
  expect((await evaluate({ at: '2026-10-09T23:01:00Z' })).previous).toBeNull();
  expect((await evaluate({ at: '2026-10-10T09:05:00Z' })).previous).toBeNull();
  expect(
    (await evaluate({ at: '2026-10-10T09:10:00Z' })).previous,
  ).not.toBeNull();
  expect((await evaluate({ at: '2026-10-10T11:00:00Z' })).previous).toBeNull();
});

test('unavailable trend storage leaves the current recommendation usable', async () => {
  const { evaluate } = await scenario();
  const current = await evaluate({
    store: async () => {
      throw new Error('synthetic storage failure');
    },
  });
  expect(current.score).toBeGreaterThan(0);
  expect(current.previous).toBeNull();
});
