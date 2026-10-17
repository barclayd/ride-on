import { expect, test } from 'bun:test';
import { encodeGeometry } from '../src/rides/geometry.ts';
import {
  decideMatches,
  matchActivity,
  type RouteMatch,
} from '../src/strava/matching.ts';
import { makeRoute } from './fixtures/rides.ts';

const line = (from = 0, to = 100, longitude = -0.1) =>
  Array.from({ length: to - from + 1 }, (_, i) => ({
    latitude: 51.5 + (from + i) * 0.0002,
    longitude,
  }));
const route = async (points = line()) => ({
  route: await makeRoute({ geometry: encodeGeometry(points) }),
  version: 1,
  updatedAt: '2026-10-09T10:00:00Z',
  source: null,
});
const candidate = (coverageFraction: number, routeId = 'a'): RouteMatch => ({
  routeId,
  routeName: 'Synthetic',
  routeVersion: 1,
  routeDistanceM: 1000,
  matchedDistanceM: 1000 * coverageFraction,
  coverageFraction,
  direction: 'forward',
});

test('inclusive 50% automatic threshold and deterministic best-match selection', () => {
  expect(decideMatches([candidate(0.49999)]).status).toBe('unmatched');
  expect(decideMatches([candidate(0.5)]).status).toBe('matched');
  expect(decideMatches([candidate(0.89999)]).status).toBe('matched');
  expect(decideMatches([candidate(0.9)]).status).toBe('matched');
  expect(decideMatches([candidate(0.95), candidate(0.92, 'b')]).reason).toBe(
    'multiple_routes',
  );
  expect(decideMatches([candidate(0.92), candidate(0.89, 'b')]).status).toBe(
    'matched',
  );
  expect(decideMatches([candidate(1)], false).status).toBe('matched');
  expect(
    decideMatches([candidate(0.5, 'b'), candidate(0.8, 'a')]).primaryRouteId,
  ).toBe('a');
  expect(
    decideMatches([candidate(0.5, 'b'), candidate(0.5, 'a')]).primaryRouteId,
  ).toBe('a');
  expect(
    decideMatches([{ ...candidate(0.6), direction: 'mixed' }]).primaryRouteId,
  ).toBe('a');
});
test('forward and reversed routes match, regardless of route dates or extra distance', async () => {
  const r = await route();
  const forward = matchActivity(line(), [r]);
  expect(forward.status).toBe('matched');
  expect(forward.candidates[0]?.coverageFraction).toBeCloseTo(1, 2);
  const reverse = matchActivity(line().reverse(), [r]);
  expect(reverse.status).toBe('matched');
  expect(reverse.candidates[0]?.direction).toBe('reverse');
  expect(matchActivity(line(-30, 130), [r]).status).toBe('matched');
});
test('extra laps do not penalize, but repeating the outbound leg cannot complete an out-and-back', async () => {
  const out = line(),
    back = line().reverse();
  const r = await route([...out, ...back.slice(1)]);
  const partial = matchActivity(out, [r]);
  expect(partial.status).toBe('matched');
  expect(partial.candidates[0]?.coverageFraction).toBeCloseTo(0.5, 3);
  expect(partial.candidates[0]?.coverageFraction ?? 0).toBeLessThanOrEqual(
    0.51,
  );
  expect(matchActivity([...out, ...back.slice(1)], [r]).status).toBe('matched');
  expect(
    matchActivity(
      [...out, ...back.slice(1), ...out.slice(1), ...back.slice(1)],
      [r],
    ).status,
  ).toBe('matched');
});
test('detours do not alter the denominator; partial coverage is automatically logged', async () => {
  const r = await route();
  expect(matchActivity(line(0, 50), [r]).status).toBe('matched');
  expect(matchActivity(line(0, 90), [r]).status).toBe('matched');
  expect(matchActivity(line(0, 60), [r]).status).toBe('matched');
  expect(matchActivity(line(0, 40), [r]).status).toBe('unmatched');
  const extra = [
    ...line(0, 50),
    ...line(0, 50).reverse().slice(1),
    ...line(0, 100).slice(1),
  ];
  expect(matchActivity(extra, [r]).status).toBe('matched');
});
test('parallel paths, crossings, missing GPS and unsupported gaps provide no match', async () => {
  const r = await route();
  expect(matchActivity(line(0, 100, -0.0995), [r]).status).toBe('unmatched');
  const crossing = Array.from({ length: 101 }, (_, i) => ({
    latitude: 51.51,
    longitude: -0.11 + i * 0.0002,
  }));
  expect(matchActivity(crossing, [r]).status).toBe('unmatched');
  expect(matchActivity([], [r]).status).toBe('unavailable');
  expect(
    matchActivity(
      [
        { latitude: 51.5, longitude: -0.1 },
        { latitude: 51.52, longitude: -0.1 },
      ],
      [r],
    ).status,
  ).toBe('unavailable');
  expect(
    matchActivity(line(), [
      r,
      { ...r, route: { ...r.route, id: crypto.randomUUID(), geometry: null } },
    ]).status,
  ).toBe('matched');
});
test('two saved versions select one stable primary route', async () => {
  const a = await route(),
    b = await route();
  const result = matchActivity(line(), [a, b]);
  expect(result.status).toBe('matched');
  expect(result.reason).toBe('multiple_routes');
  expect(result.primaryRouteId).toBe(
    [a.route.id, b.route.id].sort()[0] ?? null,
  );
  expect(matchActivity(line(), [b, a]).primaryRouteId).toBe(
    result.primaryRouteId,
  );
});
