import { expect, test } from 'bun:test';
import { assessDistance } from '../src/recommendations/distance.ts';
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

const makeDistanceRoute = async (km: number, ascentM: number | null = 0) => {
  const base = await makeRoute();
  const scale = (km * 1000) / base.distanceM;
  return {
    ...base,
    distanceM: km * 1000,
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

test('the entire inclusive distance range scores equally; nearby misses taper without a cliff', () => {
  const range = { minKm: 30, maxKm: 60 };
  for (const km of [30, 35, 45, 59, 60])
    expect(assessDistance(km * 1000, range)).toEqual({
      comfort: 1,
      fit: { status: 'within_range', deviationKm: 0 },
    });
  const justShort = assessDistance(29_999, range);
  const justLong = assessDistance(60_001, range);
  expect(justShort.fit?.status).toBe('below_range');
  expect(justLong.fit?.status).toBe('above_range');
  expect(justShort.comfort).toBeGreaterThan(0.999);
  expect(justLong.comfort).toBeGreaterThan(0.999);
  expect(assessDistance(15_000, range).comfort).toBe(0.5);
  expect(assessDistance(90_000, range).comfort).toBe(0.5);
  expect(assessDistance(120_000, range).comfort).toBe(0);
});

test('distance comfort is monotonic and bounded outside the range, including a zero lower bound and exact target', () => {
  for (const range of [
    { minKm: 30, maxKm: 60 },
    { minKm: 0, maxKm: 20 },
    { minKm: 25, maxKm: 25 },
  ]) {
    let previous = 0;
    for (const km of [0.1, 1, 5, 10, 20, 25, 30, 60, 90, 120, 400]) {
      const comfort = present(
        assessDistance(km * 1000, range).comfort ?? undefined,
      );
      expect(comfort).toBeGreaterThanOrEqual(0);
      expect(comfort).toBeLessThanOrEqual(1);
      if (km <= range.maxKm) expect(comfort).toBeGreaterThanOrEqual(previous);
      else expect(comfort).toBeLessThanOrEqual(previous);
      previous = comfort;
    }
  }
  expect(assessDistance(100, null)).toEqual({ comfort: null, fit: null });
});

test('preferred range changes rank without excluding out-of-range rides, and all interior distances get full credit', async () => {
  const routes = await Promise.all(
    [15, 30, 45, 60, 90].map((km) => makeDistanceRoute(km)),
  );
  const result = recommendRides(
    routes,
    inputFor(routes, { preferences: { distance: { minKm: 30, maxKm: 60 } } }),
    forecastsFor(routes),
    now.getTime(),
  );
  expect(result.rankings.length).toBe(5);
  expect(result.unranked).toEqual([]);
  expect(
    result.rankings.slice(0, 3).every((r) => r.best?.factors.distance === 100),
  ).toBe(true);
  for (const r of result.rankings) {
    const best = present(r.best ?? undefined);
    expect(Math.abs(best.score - best.weatherScore)).toBeLessThanOrEqual(10);
    if (r.distanceKm < 30 || r.distanceKm > 60) {
      expect(best.factors.distance).toBe(50);
      expect(
        best.drawbacks.some((d) => d.includes('preferred distance range')),
      ).toBe(true);
      expect(r.distanceFit?.deviationKm).toBe(r.distanceKm === 15 ? 15 : 30);
    }
  }
});

test('distance and flatter preferences combine to favour a short recovery route without changing duration estimation', async () => {
  const recovery = await makeDistanceRoute(20, 100);
  const longHilly = await makeDistanceRoute(60, 1200);
  const routes = [longHilly, recovery];
  const weather = forecastsFor(routes);
  const result = recommendRides(
    routes,
    inputFor(routes, {
      preferences: {
        distance: { minKm: 10, maxKm: 30 },
        climbing: { preference: 'flatter' },
      },
    }),
    weather,
    now.getTime(),
  );
  expect(result.recommendedRouteId).toBe(recovery.id);
  expect(result.rankings[0]?.estimatedDurationMinutes).toBe(60);
  expect(result.rankings[1]?.best?.score).toBe(80);
  expect(result.rankings[0]?.best?.score).toBe(97.5);
  expect(result.rankings[0]?.best?.weatherScore).toBe(100);
  const switched = recommendRides(
    routes,
    inputFor(routes, {
      preferences: {
        distance: { minKm: 60, maxKm: 70 },
        climbing: { preference: 'hillier' },
      },
    }),
    weather,
    now.getTime(),
  );
  expect(switched.recommendedRouteId).toBe(longHilly.id);
});

test('substantially better weather can win outside the range, while configured minimum conditions still take precedence', async () => {
  const inRange = await makeDistanceRoute(20);
  const outside = await makeDistanceRoute(60);
  const routes = [inRange, outside];
  const input = inputFor(routes, {
    preferences: { distance: { minKm: 10, maxKm: 30 } },
  });
  const wetWeather = forecastsFor(routes, (q, _h, r) =>
    q === 'probability' && r.id === inRange.id ? 0.8 : defaultValue(q),
  );
  expect(
    recommendRides(routes, input, wetWeather, now.getTime()).recommendedRouteId,
  ).toBe(outside.id);
  const mildWeather = forecastsFor(routes, (q, _h, r) =>
    q === 'probability' && r.id === inRange.id ? 0.02 : defaultValue(q),
  );
  expect(
    recommendRides(routes, input, mildWeather, now.getTime())
      .recommendedRouteId,
  ).toBe(inRange.id);
  const minimum = inputFor(routes, {
    preferences: {
      distance: { minKm: 10, maxKm: 30 },
      minimumStandards: { maximumPrecipitationProbability: 0.01 },
    },
  });
  const result = recommendRides(routes, minimum, mildWeather, now.getTime());
  expect(result.recommendedRouteId).toBe(outside.id);
  expect(result.rankings[0]?.best?.standards.status).toBe('meets');
  expect(present(result.rankings[1]?.best ?? undefined).score).toBeGreaterThan(
    present(result.rankings[0]?.best ?? undefined).score,
  );
});

test('distance does not bypass time windows or the missing-elevation rule', async () => {
  const tooLong = await makeDistanceRoute(60, 0);
  const result = recommendRides(
    [tooLong],
    inputFor([tooLong], {
      preferences: { distance: { minKm: 50, maxKm: 70 } },
      riding: { window: { start: '09:00', end: '10:00' } },
    }),
    [],
    now.getTime(),
  );
  expect(result.unranked[0]?.status).toBe('no_feasible_departure');
  expect(result.unranked[0]?.distanceFit?.status).toBe('within_range');
  const missing = await makeDistanceRoute(20, null);
  const both = recommendRides(
    [missing],
    inputFor([missing], {
      preferences: {
        distance: { minKm: 10, maxKm: 30 },
        climbing: { preference: 'flatter' },
      },
    }),
    [],
    now.getTime(),
  );
  expect(both.unranked[0]?.issues).toContain('missing-elevation');
  const distanceOnly = recommendRides(
    [missing],
    inputFor([missing], {
      preferences: { distance: { minKm: 10, maxKm: 30 } },
    }),
    forecastsFor([missing]),
    now.getTime(),
  );
  expect(distanceOnly.recommendedRouteId).toBe(missing.id);
});

test('omitting or clearing distance preserves climbing-only scores; adding unrelated routes does not change scores', async () => {
  const route = await makeDistanceRoute(20, 400);
  for (const preference of ['neutral', 'flatter', 'hillier'] as const) {
    const settings = { climbing: { preference } };
    const omitted = recommendRides(
      [route],
      inputFor([route], { preferences: settings }),
      forecastsFor([route]),
      now.getTime(),
    );
    const cleared = recommendRides(
      [route],
      inputFor([route], { preferences: { ...settings, distance: null } }),
      forecastsFor([route]),
      now.getTime(),
    );
    expect(cleared.rankings[0]?.best).toEqual(omitted.rankings[0]?.best);
    expect(cleared.rankings[0]?.best?.score).toBe(
      preference === 'flatter' ? 90 : 100,
    );
    expect(cleared.rankings[0]?.best?.factors.distance).toBeNull();
  }
  const prefs = { distance: { minKm: 30, maxKm: 60 } };
  const alone = recommendRides(
    [route],
    inputFor([route], { preferences: prefs }),
    forecastsFor([route]),
    now.getTime(),
  );
  const extra = await makeDistanceRoute(100);
  const together = [route, extra];
  const comparison = recommendRides(
    together,
    inputFor(together, { preferences: prefs }),
    forecastsFor(together),
    now.getTime(),
  );
  expect(
    comparison.rankings.find((r) => r.routeId === route.id)?.best?.score,
  ).toBe(alone.rankings[0]?.best?.score);
});

test('preferred range is strict, bounded and replaced as a whole', async () => {
  const route = await makeRoute();
  for (const distance of [
    {},
    [],
    false,
    '30-60',
    { minKm: 30 },
    { maxKm: 60 },
    { minKm: -1, maxKm: 20 },
    { minKm: 0, maxKm: 0 },
    { minKm: 60, maxKm: 30 },
    { minKm: 30, maxKm: 401 },
    { minKm: '30', maxKm: 60 },
    { minKm: 30, maxKm: 60, strength: 1 },
    { minKm: NaN, maxKm: 60 },
    { minKm: 30, maxKm: Infinity },
  ])
    expect(
      recommendationSchema.safeParse({
        routeIds: [route.id],
        date: '2026-10-10',
        preferences: { distance },
      }).success,
    ).toBe(false);
  for (const distance of [
    null,
    { minKm: 0, maxKm: 400 },
    { minKm: 25, maxKm: 25 },
    { minKm: 12.5, maxKm: 24.5 },
  ])
    expect(
      inputFor([route], { preferences: { distance } }).preferences.distance,
    ).toEqual(distance);
});
