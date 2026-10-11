import { expect, test } from 'bun:test';
import { recommendRides } from '../src/recommendations/engine.ts';
import {
  defaultSettings,
  mergeSettings,
  settingsSchema,
} from '../src/recommendations/input.ts';
import { decodeGeometry, encodeGeometry } from '../src/rides/geometry.ts';
import { prepareHistory } from '../src/rides/overlap.ts';
import type { HistorySnapshot } from '../src/rides/store.ts';
import type { Route } from '../src/routes/model.ts';
import { forecastsFor, inputFor, makeRoute, now } from './fixtures/rides.ts';

const line = (from = 0, to = 100, longitude = -0.1, step = 1) =>
  Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, n) => ({
    latitude: 51.5 + (from + n * step) * 0.0002,
    longitude,
  }));
const route = async (
  points = line(),
  hash = crypto.randomUUID(),
): Promise<Route> =>
  makeRoute({ geometry: encodeGeometry(points), sourceHash: hash });
const preference = { mode: 'prefer-variety' as const, lookbackDays: 28 };
const history = (routes: Route[], dates = ['2026-10-10']): HistorySnapshot => ({
  revision: 1,
  limited: false,
  entries: routes.map((r, i) => ({
    id: crypto.randomUUID(),
    sourceHash: r.sourceHash,
    riddenOn: dates[i % dates.length] ?? '2026-10-10',
    timeZone: 'Europe/London',
  })),
  geometries: new Map(
    routes.flatMap((r) =>
      r.geometry ? [[r.sourceHash, r.geometry] as const] : [],
    ),
  ),
});
const assess = (
  routes: Route[],
  snapshot: HistorySnapshot,
  date = '2026-10-10T10:00:00Z',
) => prepareHistory(routes, preference, snapshot, date, date);

test('geometry retains bends/date-line coordinates, rejects sparse evidence, and bounds malformed decoding', () => {
  const points = [
    { latitude: 0, longitude: 179.999 },
    { latitude: 0, longitude: -179.999 },
    { latitude: 0.001, longitude: -179.999 },
  ];
  const geometry = encodeGeometry(points);
  expect(geometry).not.toBeNull();
  if (!geometry) throw new Error('Expected geometry');
  expect(decodeGeometry(geometry)).toEqual(points);
  expect(
    encodeGeometry([
      { latitude: 0, longitude: 0 },
      { latitude: 0.1, longitude: 0 },
    ]),
  ).toBeNull();
  expect(() => decodeGeometry({ ...geometry, data: '~' })).toThrow();
});

test('same path, reversed path and different GPX sampling match independent of IDs', async () => {
  const original = await route();
  const reversed = await route(line().reverse());
  const resampled = await route(line(0, 100, -0.1, 0.5));
  const evaluation = assess(
    [original, reversed, resampled],
    history([original]),
  );
  for (const r of [original, reversed, resampled]) {
    const result = evaluation.assess(r.id, '2026-10-10T10:00:00Z');
    expect(result.status).toBe('assessed');
    expect(result.overlapFraction).toBeCloseTo(1, 3);
    expect(result.penaltyPoints).toBeCloseTo(10, 2);
  }
});

test('crossings and parallel paths are not overlaps; a shared half gets half the penalty', async () => {
  const original = await route();
  const parallel = await route(line(0, 100, -0.0996));
  const crossing = await route(
    Array.from({ length: 101 }, (_, n) => ({
      latitude: 51.51,
      longitude: -0.11 + n * 0.0002,
    })),
  );
  const longer = await route(line(0, 200));
  const evaluation = assess([parallel, crossing, longer], history([original]));
  expect(
    evaluation.assess(parallel.id, '2026-10-10T10:00:00Z').penaltyPoints,
  ).toBe(0);
  expect(
    evaluation.assess(crossing.id, '2026-10-10T10:00:00Z').penaltyPoints,
  ).toBe(0);
  expect(
    evaluation.assess(longer.id, '2026-10-10T10:00:00Z').penaltyPoints,
  ).toBeCloseTo(5, 1);
});

test('historical coverage is a union: duplicate logs do not stack, disjoint sections combine', async () => {
  const whole = await route();
  const first = await route(line(0, 50));
  const second = await route(line(50, 100));
  const snapshot = history(
    [first, first, second],
    ['2026-10-10', '2026-10-09', '2026-10-10'],
  );
  expect(
    assess([whole], snapshot).assess(whole.id, '2026-10-10T10:00:00Z')
      .penaltyPoints,
  ).toBeCloseTo(10, 2);
});

test('recency uses candidate dates, calendar days over DST, and original history timezone', async () => {
  const r = await route();
  const snapshot = history([r], ['2026-10-10']);
  const evaluate = prepareHistory(
    [r],
    preference,
    snapshot,
    '2026-10-10T10:00:00Z',
    '2026-11-08T10:00:00Z',
  );
  expect(
    evaluate.assess(r.id, '2026-10-24T10:00:00Z').penaltyPoints,
  ).toBeCloseTo(5, 3);
  expect(evaluate.assess(r.id, '2026-11-07T10:00:00Z').penaltyPoints).toBe(0);
  expect(evaluate.assess(r.id, '2026-10-09T10:00:00Z').penaltyPoints).toBe(0);
  const entry = snapshot.entries[0];
  if (!entry) throw new Error('Expected history');
  entry.timeZone = 'Pacific/Auckland';
  entry.riddenOn = '2026-10-11';
  expect(
    assess([r], snapshot, '2026-10-10T12:00:00Z').assess(
      r.id,
      '2026-10-10T12:00:00Z',
    ).penaltyPoints,
  ).toBeCloseTo(10, 3);
});

test('missing candidate/history geometry disables the entire comparison, never rewards unknown roads', async () => {
  const r = await route();
  const missing = { ...r, id: crypto.randomUUID(), geometry: null };
  const evaluation = assess([r, missing], history([r]));
  for (const candidate of [r, missing])
    expect(
      evaluation.assess(candidate.id, '2026-10-10T10:00:00Z'),
    ).toMatchObject({
      status: 'unavailable',
      overlapFraction: null,
      penaltyPoints: 0,
    });
  const snapshot = history([r]);
  snapshot.geometries.clear();
  expect(assess([r], snapshot).status).toBe('unavailable');
  expect(assess([missing], history([])).status).toBe('no_recent_history');
  expect(assess([r], { ...history([r]), limited: true }).reasonCode).toBe(
    'history_assessment_limit',
  );
});

test('neutral/expired histories preserve baseline, modest repetition loses ties but not substantially better weather', async () => {
  const ridden = await route();
  const fresh = await route(line(0, 100, -0.2));
  const routes = [ridden, fresh];
  const input = inputFor(routes, { preferences: { recentRides: preference } });
  const snap = history([ridden], ['2026-10-09']);
  const output = recommendRides(
    routes,
    input,
    forecastsFor(routes),
    now.getTime(),
    10000,
    3,
    assess(routes, snap),
  );
  expect(output.recommendedRouteId).toBe(fresh.id);
  const worse = forecastsFor(routes, (quantity, _hour, r) =>
    quantity === 'air-temperature'
      ? r.id === ridden.id
        ? 20
        : 0
      : quantity === 'wind-from-direction'
        ? 0
        : 0,
  );
  const weatherWins = recommendRides(
    routes,
    input,
    worse,
    now.getTime(),
    10000,
    3,
    assess(routes, snap),
  );
  expect(weatherWins.recommendedRouteId).toBe(ridden.id);
  const plain = inputFor(routes);
  const baseline = recommendRides(
    routes,
    plain,
    forecastsFor(routes),
    now.getTime(),
  );
  const expired = recommendRides(
    routes,
    input,
    forecastsFor(routes),
    now.getTime(),
    10000,
    3,
    assess(routes, history([ridden], ['2026-09-01'])),
  );
  expect(expired.rankings.map((r) => [r.routeId, r.best?.score])).toEqual(
    baseline.rankings.map((r) => [r.routeId, r.best?.score]),
  );
});

test('preference defaults and partial updates preserve existing scoring settings', () => {
  const saved = settingsSchema.parse(
    mergeSettings({ preferences: { recentRides: { mode: 'prefer-variety' } } }),
  );
  expect(saved.preferences.recentRides).toEqual(preference);
  const edited = settingsSchema.parse(
    mergeSettings(
      { preferences: { recentRides: { lookbackDays: 14 } } },
      saved,
    ),
  );
  expect(edited.preferences.recentRides).toEqual({
    ...preference,
    lookbackDays: 14,
  });
  expect(edited.preferences.weights).toEqual(
    defaultSettings.preferences.weights,
  );
  for (const value of [0, 91, 2.5])
    expect(() =>
      settingsSchema.parse(
        mergeSettings({
          preferences: { recentRides: { lookbackDays: value } },
        }),
      ),
    ).toThrow();
});

test('a familiar route meeting minimum standards beats a fresher route with a higher adjusted score', async () => {
  const ridden = await route();
  const fresh = await route(line(0, 100, -0.2));
  const routes = [ridden, fresh];
  const input = inputFor(routes, {
    preferences: {
      recentRides: preference,
      minimumStandards: { minimumTemperature: { kind: 'fixed', valueC: 18 } },
    },
  });
  const weather = forecastsFor(routes, (quantity, _hour, r) =>
    quantity === 'air-temperature' ? (r.id === ridden.id ? 18 : 17) : 0,
  );
  const result = recommendRides(
    routes,
    input,
    weather,
    now.getTime(),
    10000,
    3,
    assess(routes, history([ridden], ['2026-10-09'])),
  );
  expect(result.recommendedRouteId).toBe(ridden.id);
  expect(result.rankings[0]?.best?.standards.status).toBe('meets');
  expect(result.rankings[1]?.best?.standards.status).toBe('below');
  expect(result.rankings[0]?.best?.score ?? 100).toBeLessThan(
    result.rankings[1]?.best?.score ?? 0,
  );
});
