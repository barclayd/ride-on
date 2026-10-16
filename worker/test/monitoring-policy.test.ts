import { expect, test } from 'bun:test';
import {
  acceptAlert,
  decide,
  initialState,
  type MonitorState,
  qualifyingAlternative,
  summaryAt,
} from '../src/monitoring/policy.ts';
import type { Snapshot } from '../src/tracking/model.ts';
import { trackingSnapshot } from './fixtures/tracking.ts';

const must = <T>(value: T | null | undefined): T => {
  if (value == null) throw new Error('Missing test value');
  return value;
};
const at = '2026-10-09T12:00:00.000Z';
const check = (
  state: MonitorState,
  current: Snapshot | null,
  time = at,
  extra = {},
) =>
  decide({
    state,
    current,
    at: time,
    departure: '2026-10-10T10:00:00.000Z',
    createdAt: at,
    timeZone: 'Europe/London',
    lastSuccessAt: at,
    staleSince: at,
    ...extra,
  });
const failure = (snapshot: Snapshot, names: string[]) => {
  snapshot.pick.candidate.standards = {
    ...snapshot.pick.candidate.standards,
    status: names.length ? 'below' : 'meets',
    failures: names.map(
      (standard) =>
        ({
          standard,
          limit: 10,
          actual: 20,
        }) as Snapshot['pick']['candidate']['standards']['failures'][number],
    ),
  };
};
test('score changes accumulate from last accepted alert with a three-hour cooldown in both directions', async () => {
  const snapshot = await trackingSnapshot();
  let state = await initialState(snapshot, at);
  snapshot.pick.candidate.score = 75.001;
  expect((await check(state, snapshot)).alert).toBeNull();
  snapshot.pick.candidate.score = 74;
  const first = await check(state, snapshot);
  expect(first.alert?.reasons).toEqual(['score_worsened']);
  state = acceptAlert(first.state, must(first.alert), at);
  snapshot.pick.candidate.score = 72;
  expect(
    (await check(state, snapshot, '2026-10-09T15:00:00.000Z')).alert,
  ).toBeNull();
  snapshot.pick.candidate.score = 68;
  expect(
    (await check(state, snapshot, '2026-10-09T14:59:59.000Z')).alert,
  ).toBeNull();
  expect(
    (await check(state, snapshot, '2026-10-09T15:00:00.000Z')).alert
      ?.scoreDelta,
  ).toBe(-6);
  snapshot.pick.candidate.score = 79;
  expect(
    (await check(state, snapshot, '2026-10-09T15:00:00.000Z')).alert?.reasons,
  ).toEqual(['score_improved']);
});
test('new minimum breaches bypass cooldown; recoveries list any remaining failures', async () => {
  const snapshot = await trackingSnapshot();
  let state = await initialState(snapshot, at);
  state.lastNotifiedAt = at;
  failure(snapshot, ['maximumGustKph', 'maximumTemperatureC']);
  const breach = await check(state, snapshot);
  expect(breach.alert?.newlyFailing).toHaveLength(2);
  state = acceptAlert(breach.state, must(breach.alert), at);
  expect((await check(state, snapshot)).alert).toBeNull();
  failure(snapshot, ['maximumGustKph']);
  expect((await check(state, snapshot)).alert).toBeNull();
  const recovered = await check(state, snapshot, '2026-10-09T15:00:00.000Z');
  expect(recovered.alert?.recovered).toEqual(['maximumTemperatureC']);
  expect(recovered.alert?.remainingFailures).toEqual(['maximumGustKph']);
  snapshot.pick.candidate.standards.status = 'unknown';
  expect(
    (await check(state, snapshot, '2026-10-09T15:00:00.000Z')).alert,
  ).toBeNull();
});
test('settings, route, history, algorithm and provider changes rebase quietly, unlike forecast evidence', async () => {
  for (const field of [
    'inputs',
    'routes',
    'history',
    'algorithmVersion',
    'weather',
  ] as const) {
    const snapshot = await trackingSnapshot(),
      state = await initialState(snapshot, at);
    snapshot.pick.candidate.score = 40;
    if (field === 'inputs')
      must(snapshot.context.inputs[0]).riding.averageSpeedKph += 1;
    if (field === 'routes')
      snapshot.context.routes.push({
        id: 'different',
      } as Snapshot['context']['routes'][number]);
    if (field === 'history') snapshot.context.history.revision = 1;
    if (field === 'algorithmVersion') snapshot.context.algorithmVersion = 'new';
    if (field === 'weather')
      snapshot.context.weather.selectedSource = {
        providerId: 'new',
        productId: 'new',
        adapterVersion: '1',
      };
    const result = await check(state, snapshot);
    expect(result.alert).toBeNull();
    expect(result.state.reference.score).toBe(40);
    expect(state.reference.score).toBe(80);
  }
  const snapshot = await trackingSnapshot(),
    state = await initialState(snapshot, at);
  snapshot.context.generatedAt = '2026-10-09T13:00:00.000Z';
  snapshot.context.eligibleDepartures = 9;
  snapshot.pick.candidate.score = 74;
  expect((await check(state, snapshot)).alert?.reasons).toContain(
    'score_worsened',
  );
});
test('fully assessed better route or time needs five points or resolves minimums; rankings alone stay quiet', async () => {
  const snapshot = await trackingSnapshot(),
    state = await initialState(snapshot, at);
  snapshot.context.best = {
    routeId: 'other',
    candidate: {
      ...structuredClone(snapshot.pick.candidate),
      score: 84,
      recommendationPriority: 90,
    },
  };
  expect((await check(state, snapshot)).alert).toBeNull();
  snapshot.context.best.candidate.score = 85;
  expect((await check(state, snapshot)).alert?.reasons).toEqual([
    'better_option',
  ]);
  snapshot.context.coverageComplete = false;
  expect(qualifyingAlternative(snapshot, at)).toBeNull();
  snapshot.context.coverageComplete = true;
  snapshot.context.best.routeId = snapshot.pick.routeId;
  snapshot.context.best.candidate.departureAt = '2026-10-10T09:30:00.000Z';
  expect((await check(state, snapshot)).alert?.alternative?.departureAt).toBe(
    '2026-10-10T09:30:00.000Z',
  );
  snapshot.context.best.candidate.score = 70;
  failure(snapshot, ['maximumGustKph']);
  expect(qualifyingAlternative(snapshot, at)).not.toBeNull();
  snapshot.context.best.candidate.standards.status = 'unknown';
  expect(qualifyingAlternative(snapshot, at)).toBeNull();
});
test('one outage after an hour within 24 hours, then one recovery; missing data never changes score', async () => {
  const snapshot = await trackingSnapshot();
  let state = await initialState(snapshot, at);
  const early = await check(state, null, '2026-10-09T12:59:59.000Z');
  expect(early.alert).toBeNull();
  const outage = await check(early.state, null, '2026-10-09T13:00:00.000Z');
  expect(outage.alert?.reasons).toEqual(['unavailable']);
  state = acceptAlert(
    outage.state,
    must(outage.alert),
    '2026-10-09T13:00:00.000Z',
  );
  expect(state.reference.score).toBe(80);
  expect(
    (await check(state, null, '2026-10-09T14:00:00.000Z')).alert,
  ).toBeNull();
  const recovery = await check(state, snapshot, '2026-10-09T14:00:00.000Z');
  expect(recovery.alert?.reasons).toEqual(['available_again']);
  state = acceptAlert(
    recovery.state,
    must(recovery.alert),
    '2026-10-09T14:00:00.000Z',
  );
  expect(
    (await check(state, snapshot, '2026-10-09T14:15:00.000Z')).alert,
  ).toBeNull();
  expect(
    (
      await check(state, null, '2026-10-09T14:00:00.000Z', {
        departure: '2026-10-11T15:00:00.000Z',
      })
    ).alert,
  ).toBeNull();
});
test('19:00 summary handles DST, late enrollment, outages, coalescing, no quiet hours and departure closure', async () => {
  expect(summaryAt('2026-10-25T09:00:00.000Z', 'Europe/London')).toBe(
    '2026-10-24T18:00:00.000Z',
  );
  expect(summaryAt('2026-10-26T09:00:00.000Z', 'Europe/London')).toBe(
    '2026-10-25T19:00:00.000Z',
  );
  const snapshot = await trackingSnapshot(),
    state = await initialState(snapshot, at);
  state.lastNotifiedAt = '2026-10-09T17:00:00.000Z';
  const time = '2026-10-09T18:00:00.000Z';
  expect((await check(state, snapshot, time)).alert?.reasons).toEqual([
    'evening_summary',
  ]);
  expect(
    (
      await check(state, snapshot, time, {
        createdAt: '2026-10-09T18:00:01.000Z',
      })
    ).alert,
  ).toBeNull();
  const unavailable = await check(state, null, time);
  expect(unavailable.alert?.reasons).toEqual([
    'evening_summary',
    'unavailable',
  ]);
  const accepted = acceptAlert(
    unavailable.state,
    must(unavailable.alert),
    time,
  );
  expect(
    (await check(accepted, null, '2026-10-09T19:00:00.000Z')).alert,
  ).toBeNull();
  snapshot.pick.candidate.score = 60;
  expect(
    (
      await check(
        { ...state, summaryDone: true },
        snapshot,
        '2026-10-09T23:00:00.000Z',
      )
    ).alert?.reasons,
  ).toContain('score_worsened');
  expect(
    (await check(state, snapshot, '2026-10-10T10:00:00.000Z')).alert,
  ).toBeNull();
});

test('unknown previous minimums do not imply that a newly available reading crossed a satisfied limit', async () => {
  const snapshot = await trackingSnapshot();
  snapshot.pick.candidate.standards.status = 'unknown';
  const state = await initialState(snapshot, at);
  failure(snapshot, ['maximumGustKph']);
  const result = await check(state, snapshot);
  expect(result.alert).toBeNull();
  expect(result.state.reference.failures).toEqual(['maximumGustKph']);
});

test('a minimum that clears and breaches again bypasses cooldown even if the recovery was held', async () => {
  const snapshot = await trackingSnapshot();
  let state = await initialState(snapshot, at);
  failure(snapshot, ['maximumGustKph']);
  const breach = await check(state, snapshot);
  state = acceptAlert(breach.state, must(breach.alert), at);
  failure(snapshot, []);
  const clearing = await check(state, snapshot, '2026-10-09T12:15:00.000Z');
  expect(clearing.alert).toBeNull();
  failure(snapshot, ['maximumGustKph']);
  const again = await check(
    clearing.state,
    snapshot,
    '2026-10-09T12:30:00.000Z',
  );
  expect(again.alert?.reasons).toEqual(['minimum_breach']);
});
