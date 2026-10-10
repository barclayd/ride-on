import { expect, test } from 'bun:test';
import { recommendRides } from '../src/recommendations/engine.ts';
import { recommendationSchema } from '../src/recommendations/input.ts';
import {
  defaultValue,
  forecastsFor,
  inputFor,
  makeRoute,
  now,
  present,
} from './fixtures/rides.ts';

const routeWithAscent = async (distanceKm: number, ascentM: number | null) => {
  const base = await makeRoute();
  const scale = (distanceKm * 1000) / base.distanceM;
  return {
    ...base,
    distanceM: distanceKm * 1000,
    ascentM,
    legs: base.legs.map((leg) => ({
      ...leg,
      fromM: leg.fromM * scale,
      toM: leg.toM * scale,
    })),
    weatherLocations: base.weatherLocations.map((location) => ({
      ...location,
      distanceM: location.distanceM * scale,
    })),
  };
};

test('flatter favours less ascent per kilometre even when total ascent is higher; hillier reverses it', async () => {
  const gentle = await routeWithAscent(60, 600);
  const hilly = await routeWithAscent(30, 450);
  const routes = [hilly, gentle];
  const forecasts = forecastsFor(routes);
  for (const [preference, expected] of [
    ['flatter', gentle.id],
    ['hillier', hilly.id],
  ] as const) {
    const result = recommendRides(
      routes,
      inputFor(routes, { preferences: { climbing: { preference } } }),
      forecasts,
      now.getTime(),
    );
    expect(result.recommendedRouteId).toBe(expected);
    expect(
      result.rankings.find((r) => r.routeId === gentle.id)?.ascentMPerKm,
    ).toBe(10);
    expect(
      result.rankings.find((r) => r.routeId === hilly.id)?.ascentMPerKm,
    ).toBe(15);
  }
});

test('no preference preserves weather scores, departures and ordering regardless of ascent or missing elevation', async () => {
  const a = await routeWithAscent(20, 100);
  const b = await routeWithAscent(20, 1000);
  const routes = [a, b];
  const forecasts = forecastsFor(routes, (q, _h, r) =>
    q === 'air-temperature' ? (r.id === a.id ? 13 : 18) : defaultValue(q),
  );
  const omitted = recommendRides(
    routes,
    inputFor(routes),
    forecasts,
    now.getTime(),
  );
  const changed = routes.map((r) => ({
    ...r,
    ascentM: r.id === a.id ? null : 0,
  }));
  const explicit = recommendRides(
    changed,
    inputFor(changed, { preferences: { climbing: { preference: 'neutral' } } }),
    forecasts,
    now.getTime(),
  );
  expect(explicit.rankings.map((r) => [r.routeId, r.best])).toEqual(
    omitted.rankings.map((r) => [r.routeId, r.best]),
  );
  for (const result of explicit.rankings) {
    expect(result.best?.score).toBe(result.best?.weatherScore);
    expect(result.best?.factors.climbing).toBeNull();
  }
});

test('climbing is monotonic, bounded and independent of the other shortlisted routes', async () => {
  const base = await routeWithAscent(20, 0);
  for (const preference of ['flatter', 'hillier'] as const) {
    let previous = preference === 'flatter' ? Infinity : -Infinity;
    for (const ascentM of [0, 50, 100, 200, 400, 800, 10_000]) {
      const route = { ...base, ascentM };
      const input = inputFor([route], {
        preferences: { climbing: { preference } },
      });
      const result = recommendRides(
        [route],
        input,
        forecastsFor([route]),
        now.getTime(),
      );
      const best = present(result.rankings[0]?.best ?? undefined);
      expect(best.score).toBeGreaterThanOrEqual(0);
      expect(best.score).toBeLessThanOrEqual(100);
      expect(Math.abs(best.score - best.weatherScore)).toBeLessThanOrEqual(10);
      if (preference === 'flatter')
        expect(best.score).toBeLessThanOrEqual(previous);
      else expect(best.score).toBeGreaterThanOrEqual(previous);
      previous = best.score;
      const extra = await routeWithAscent(20, 2000);
      const together = [route, extra];
      const comparison = recommendRides(
        together,
        inputFor(together, { preferences: { climbing: { preference } } }),
        forecastsFor(together),
        now.getTime(),
      );
      expect(
        comparison.rankings.find((r) => r.routeId === route.id)?.best?.score,
      ).toBe(best.score);
    }
  }
});

test('substantially better weather outweighs the preferred terrain', async () => {
  const flatWet = await routeWithAscent(20, 0);
  const hillyDry = await routeWithAscent(20, 400);
  const routes = [flatWet, hillyDry];
  const result = recommendRides(
    routes,
    inputFor(routes, { preferences: { climbing: { preference: 'flatter' } } }),
    forecastsFor(routes, (q, _h, r) =>
      q === 'probability' && r.id === flatWet.id ? 0.8 : defaultValue(q),
    ),
    now.getTime(),
  );
  expect(result.recommendedRouteId).toBe(hillyDry.id);
});

test('configured weather minimums take precedence over climbing and the combined score', async () => {
  const flat = await routeWithAscent(20, 0);
  const hilly = await routeWithAscent(20, 400);
  const routes = [flat, hilly];
  const result = recommendRides(
    routes,
    inputFor(routes, {
      preferences: {
        climbing: { preference: 'flatter' },
        minimumStandards: { maximumPrecipitationProbability: 0.01 },
      },
    }),
    forecastsFor(routes, (q, _h, r) =>
      q === 'probability' && r.id === flat.id ? 0.02 : defaultValue(q),
    ),
    now.getTime(),
  );
  expect(result.recommendedRouteId).toBe(hilly.id);
  expect(present(result.rankings[1]?.best ?? undefined).score).toBeGreaterThan(
    present(result.rankings[0]?.best ?? undefined).score,
  );
  expect(result.minimumStandardsStatus).toBe('match_found');
});

test('missing elevation remains unranked with an active preference; zero ascent is known flat terrain', async () => {
  const missing = await routeWithAscent(20, null);
  const flat = await routeWithAscent(20, 0);
  const routes = [missing, flat];
  for (const preference of ['flatter', 'hillier'] as const) {
    const result = recommendRides(
      routes,
      inputFor(routes, { preferences: { climbing: { preference } } }),
      forecastsFor(routes),
      now.getTime(),
    );
    expect(result.rankings.map((r) => r.routeId)).toEqual([flat.id]);
    expect(result.unranked[0]?.issues).toContain('missing-elevation');
    expect(result.unranked[0]?.ascentMPerKm).toBeNull();
    expect(result.rankings[0]?.best?.factors.climbing).toBe(
      preference === 'flatter' ? 100 : 0,
    );
  }
});

test('missing elevation cannot produce a false none-meet result, and an impossible ride remains infeasible', async () => {
  const unknown = await routeWithAscent(20, null);
  const below = await routeWithAscent(20, 100);
  const routes = [unknown, below];
  const result = recommendRides(
    routes,
    inputFor(routes, {
      preferences: {
        climbing: { preference: 'flatter' },
        minimumStandards: { minimumTemperature: { kind: 'fixed', valueC: 30 } },
      },
    }),
    forecastsFor(routes),
    now.getTime(),
  );
  expect(result.minimumStandardsStatus).toBe('unknown');
  const impossible = recommendRides(
    [unknown],
    inputFor([unknown], {
      riding: { window: { start: '09:00', end: '09:15' } },
      preferences: { climbing: { preference: 'flatter' } },
    }),
    [],
    now.getTime(),
  );
  expect(impossible.unranked[0]?.status).toBe('no_feasible_departure');
});

test('climbing preference rejects unsupported modes, limits and malformed values', async () => {
  const route = await makeRoute();
  for (const climbing of [
    null,
    [],
    'flatter',
    { preference: 'flat' },
    { preference: null },
    { maximumAscentM: 800 },
  ]) {
    expect(
      recommendationSchema.safeParse({
        routeIds: [route.id],
        date: '2026-10-10',
        preferences: { climbing },
      }).success,
    ).toBe(false);
  }
});
