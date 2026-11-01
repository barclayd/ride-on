import { expect, test } from 'bun:test';
import { alertConditions } from '../src/monitoring/conditions.ts';
import { pushPayload } from '../src/monitoring/message.ts';
import {
  acceptAlert,
  decide,
  initialState,
  type MonitorState,
  qualifyingAlternative,
  summaryAt,
} from '../src/monitoring/policy.ts';
import { allAlertTriggers } from '../src/tracking/alerts.ts';
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
test('better times need five points or resolve minimums; a different route winning stays quiet', async () => {
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
  expect((await check(state, snapshot)).alert).toBeNull();
  const ownBest = {
    routeId: snapshot.pick.routeId,
    candidate: {
      ...structuredClone(snapshot.context.best.candidate),
      departureAt: '2026-10-10T09:30:00.000Z',
      score: 84,
    },
  };
  snapshot.context.routeBests = [ownBest];
  expect((await check(state, snapshot)).alert).toBeNull();
  ownBest.candidate.score = 85;
  expect((await check(state, snapshot)).alert?.reasons).toEqual([
    'better_option',
  ]);
  snapshot.context.coverageComplete = false;
  expect(qualifyingAlternative(snapshot, at)).toBeNull();
  snapshot.context.coverageComplete = true;
  expect((await check(state, snapshot)).alert?.alternative?.departureAt).toBe(
    '2026-10-10T09:30:00.000Z',
  );
  ownBest.candidate.score = 70;
  failure(snapshot, ['maximumGustKph']);
  expect(qualifyingAlternative(snapshot, at)).not.toBeNull();
  ownBest.candidate.standards.status = 'unknown';
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
test('18:00 summary handles DST, late enrollment, outages, coalescing, no quiet hours and departure closure', async () => {
  expect(summaryAt('2026-10-25T09:00:00.000Z', 'Europe/London')).toBe(
    '2026-10-24T17:00:00.000Z',
  );
  expect(summaryAt('2026-10-26T09:00:00.000Z', 'Europe/London')).toBe(
    '2026-10-25T18:00:00.000Z',
  );
  const snapshot = await trackingSnapshot(),
    state = await initialState(snapshot, at);
  expect(summaryAt('2026-03-29T09:00:00.000Z', 'Europe/London')).toBe(
    '2026-03-28T18:00:00.000Z',
  );
  expect(summaryAt('2026-03-30T09:00:00.000Z', 'Europe/London')).toBe(
    '2026-03-29T17:00:00.000Z',
  );
  state.lastNotifiedAt = '2026-10-09T16:00:00.000Z';
  const time = '2026-10-09T17:00:00.000Z';
  expect(
    (await check(state, snapshot, '2026-10-09T16:59:59.000Z')).alert,
  ).toBeNull();
  expect((await check(state, snapshot, time)).alert?.reasons).toEqual([
    'evening_summary',
  ]);
  expect(
    (
      await check(state, snapshot, time, {
        createdAt: '2026-10-09T17:00:01.000Z',
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

const weather = (
  snapshot: Snapshot,
  probability: number,
  air = 12,
  feels: number | null = 12,
) => {
  snapshot.pick.candidate.rideHours = [
    {
      start: snapshot.pick.candidate.departureAt,
      end: snapshot.pick.candidate.finishAt,
      conditions: {
        ...snapshot.pick.candidate.conditions,
        maximumPrecipitationProbability: probability,
      },
    },
  ];
  snapshot.pick.candidate.temperatureAlongRide.points = [[0, air, feels, null]];
};
const calm = async () => {
  const snapshot = await trackingSnapshot();
  must(snapshot.context.inputs[0]).preferences.temperature.comfortMinC = 10;
  weather(snapshot, 0.49);
  return snapshot;
};

test('rain warns at 50%, bypasses cooldown, retries until accepted and re-arms below 50%', async () => {
  const snapshot = await calm();
  let state = await initialState(snapshot, at);
  state.lastNotifiedAt = at;
  expect((await check(state, snapshot)).alert).toBeNull();
  weather(snapshot, 0.5);
  const first = await check(state, snapshot);
  expect(first.alert?.reasons).toEqual(['rain_likely']);
  expect(first.alert?.rain?.probability).toBe(0.5);
  expect((await check(first.state, snapshot)).alert?.reasons).toEqual([
    'rain_likely',
  ]);
  state = acceptAlert(first.state, must(first.alert), at);
  expect((await check(state, snapshot)).alert).toBeNull();
  weather(snapshot, 0.49);
  const clear = await check(state, snapshot);
  expect(clear.alert).toBeNull();
  weather(snapshot, 0.7);
  expect((await check(clear.state, snapshot)).alert?.reasons).toEqual([
    'rain_likely',
  ]);
});

test('rain uses any ride hour and ignores evidence outside the ride', async () => {
  const snapshot = await calm();
  const state = await initialState(snapshot, at);
  const hour = must(snapshot.pick.candidate.rideHours[0]);
  snapshot.pick.candidate.rideHours.push({
    ...hour,
    conditions: {
      ...must(hour.conditions),
      maximumPrecipitationProbability: 0.7,
    },
  });
  expect((await check(state, snapshot)).alert?.rain?.probability).toBe(0.7);
  must(snapshot.pick.candidate.rideHours[1]).start =
    snapshot.pick.candidate.finishAt;
  expect((await check(state, snapshot)).alert).toBeNull();
});

test('cold uses the lowest feels like, falls back per point to air, and re-arms at the comfort floor', async () => {
  const snapshot = await calm();
  let state = await initialState(snapshot, at);
  state.lastNotifiedAt = at;
  weather(snapshot, 0.49, 12, 10);
  expect((await check(state, snapshot)).alert).toBeNull();
  snapshot.pick.candidate.temperatureAlongRide.points.push([1, 12, 6, null]);
  const cold = await check(state, snapshot);
  expect(cold.alert?.reasons).toEqual(['feels_cold']);
  expect(cold.alert?.cold).toEqual({ minimumC: 6, limitC: 10 });
  state = acceptAlert(cold.state, must(cold.alert), at);
  weather(snapshot, 0.49, 12, 10);
  const clear = await check(state, snapshot);
  weather(snapshot, 0.49, 9, null);
  expect((await check(clear.state, snapshot)).alert?.cold?.minimumC).toBe(9);
  // Missing limits can occur on historical snapshots; they are not zero degrees.
  Reflect.deleteProperty(
    must(snapshot.context.inputs[0]).preferences.temperature,
    'comfortMinC',
  );
  expect(alertConditions(snapshot).feelsCold).toBeNull();
  expect((await check(clear.state, snapshot)).alert).toBeNull();
});

test('unknown evidence and legacy monitor state do not fabricate crossings or re-arm warnings', async () => {
  const snapshot = await calm();
  let state = await initialState(snapshot, at);
  weather(snapshot, 0.7, 12, 6);
  const warning = await check(state, snapshot);
  state = acceptAlert(warning.state, must(warning.alert), at);
  must(snapshot.pick.candidate.rideHours[0]).conditions = null;
  snapshot.pick.candidate.temperatureAlongRide.points = [[0, null, null, null]];
  const unknown = await check(state, snapshot);
  expect(unknown.alert).toBeNull();
  weather(snapshot, 0.7, 12, 6);
  expect((await check(unknown.state, snapshot)).alert).toBeNull();
  delete state.reference.rainLikely;
  delete state.reference.feelsCold;
  const legacy = await check(state, snapshot);
  expect(legacy.alert).toBeNull();
  expect(legacy.state.reference.rainLikely).toBe(true);
  expect(legacy.state.reference.feelsCold).toBe(true);
});

for (const [trigger, standards] of [
  ['rain', ['maximumPrecipitationProbability', 'maximumPrecipitationRateMmH']],
  ['wind', ['maximumGustKph']],
  ['cold', ['minimumTemperatureC']],
] as const) {
  test(`${trigger} suppresses only its own breaches and recoveries and advances their reference`, async () => {
    const snapshot = await calm();
    const state = await initialState(snapshot, at);
    const triggers = { ...allAlertTriggers, [trigger]: false };
    failure(snapshot, [...standards, 'maximumTemperatureC']);
    const breach = await check(state, snapshot, at, { triggers });
    expect(breach.alert?.newlyFailing).toEqual(['maximumTemperatureC']);
    expect(breach.alert?.remainingFailures).toEqual(['maximumTemperatureC']);
    const accepted = acceptAlert(breach.state, must(breach.alert), at);
    failure(snapshot, []);
    const recovery = await check(
      accepted,
      snapshot,
      '2026-10-09T15:00:00.000Z',
      { triggers },
    );
    expect(recovery.alert?.recovered).toEqual(['maximumTemperatureC']);
    expect(recovery.state.reference.failures).toEqual(['maximumTemperatureC']);
  });
}

test('disabled reasons stay quiet, without replaying old weather when enabled', async () => {
  const snapshot = await calm();
  const state = await initialState(snapshot, at);
  const triggers = { rain: false, wind: false, cold: false, betterTime: true };
  weather(snapshot, 0.7, 12, 6);
  failure(snapshot, [
    'maximumGustKph',
    'minimumTemperatureC',
    'maximumPrecipitationProbability',
  ]);
  const quiet = await check(state, snapshot, at, { triggers });
  expect(quiet.alert).toBeNull();
  expect(quiet.state.reference.score).toBe(80);
  expect((await check(quiet.state, snapshot)).alert).toBeNull();
  weather(snapshot, 0.49);
  failure(snapshot, []);
  const cleared = await check(quiet.state, snapshot, at, { triggers });
  expect((await check(cleared.state, snapshot)).alert).toBeNull();
  weather(snapshot, 0.5, 12, 9);
  expect((await check(cleared.state, snapshot)).alert?.reasons).toEqual([
    'rain_likely',
    'feels_cold',
  ]);
});

test('betterTime gates alternatives and their copy but keeps independent score changes', async () => {
  const snapshot = await calm();
  const state = await initialState(snapshot, at);
  const triggers = { ...allAlertTriggers, betterTime: false };
  snapshot.context.best = {
    routeId: snapshot.pick.routeId,
    candidate: {
      ...snapshot.pick.candidate,
      departureAt: '2026-10-10T09:30:00.000Z',
      score: 90,
      recommendationPriority: 90,
    },
  };
  const quiet = await check(state, snapshot, at, { triggers });
  expect(quiet.alert).toBeNull();
  expect((await check(quiet.state, snapshot)).alert).toBeNull();
  for (const score of [75, 85]) {
    snapshot.pick.candidate.score = score;
    const change = await check(quiet.state, snapshot, at, { triggers });
    expect(change.alert?.reasons).toEqual([
      score < 80 ? 'score_worsened' : 'score_improved',
    ]);
    expect(change.alert?.alternative).toBeNull();
  }
});

test('summary, outage and recovery ignore switches and combine due reasons', async () => {
  const snapshot = await calm();
  const state = await initialState(snapshot, at);
  const triggers = { rain: false, wind: false, cold: false, betterTime: true };
  const outage = await check(state, null, '2026-10-09T17:00:00.000Z', {
    triggers,
  });
  expect(outage.alert?.reasons).toEqual(['evening_summary', 'unavailable']);
  const accepted = acceptAlert(
    outage.state,
    must(outage.alert),
    '2026-10-09T17:00:00.000Z',
  );
  expect(
    (await check(accepted, snapshot, '2026-10-09T17:15:00.000Z', { triggers }))
      .alert?.reasons,
  ).toEqual(['available_again']);
  weather(snapshot, 0.7, 12, 6);
  snapshot.pick.candidate.score = 75;
  state.lastNotifiedAt = '2026-10-09T16:00:00.000Z';
  const combined = await check(state, snapshot, '2026-10-09T17:00:00.000Z');
  expect(combined.alert?.reasons).toEqual([
    'evening_summary',
    'rain_likely',
    'feels_cold',
    'score_worsened',
  ]);
});

test('warning copy names the ride, local rain time and the rider temperature units', async () => {
  const snapshot = await calm();
  const state = await initialState(snapshot, at);
  weather(snapshot, 0.7, 12, 6);
  const alert = must((await check(state, snapshot)).alert);
  alert.rain = { probability: 0.7, at: '2026-10-10T09:00:00.000Z' };
  const plan = {
    id: 'plan',
    routeName: 'Hilly Loop',
    departureAt: snapshot.pick.candidate.departureAt,
    timeZone: 'Europe/London',
  };
  const body = (temperatureUnit: 'C' | 'F') =>
    JSON.parse(pushPayload(alert, { ...plan, temperatureUnit }, 'event')).aps
      .alert.body;
  expect(body('C')).toContain(
    'Rain is now likely on Hilly Loop (70% at 10:00)',
  );
  expect(body('C')).toContain(
    'Hilly Loop will feel colder than 10°C (down to 6°C)',
  );
  expect(body('F')).toContain(
    'Hilly Loop will feel colder than 50°F (down to 43°F)',
  );
});
