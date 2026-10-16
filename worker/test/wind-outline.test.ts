import { expect, test } from 'bun:test';
import { recommendRides } from '../src/recommendations/engine.ts';
import {
  windStretchesFor,
  windStretchesSchema,
} from '../src/recommendations/wind-stretches.ts';
import { decodeGeometry, encodeGeometry } from '../src/rides/geometry.ts';
import { routeOutline } from '../src/routes/outline.ts';
import {
  defaultValue,
  forecastsFor,
  inputFor,
  makeRoute,
  now,
  present,
} from './fixtures/rides.ts';

test('outline preserves endpoints and chainage with at most 64 points on a complex loop', async () => {
  const points = Array.from({ length: 2001 }, (_, i) => {
    const angle = (i / 2000) * Math.PI * 2;
    return {
      latitude: 51 + 0.03 * Math.sin(angle),
      longitude: -0.1 + (0.04 + 0.003 * Math.sin(80 * angle)) * Math.cos(angle),
    };
  });
  const geometry = present(encodeGeometry(points) ?? undefined);
  expect(geometry.pointCount).toBeGreaterThan(64);
  const route = await makeRoute({ geometry, distanceM: 23123.456 });
  const outline = present(routeOutline(route) ?? undefined);
  expect(outline.version).toBe(1);
  expect(outline.points.length).toBeLessThanOrEqual(64);
  expect(outline.points.length).toBeGreaterThan(2);
  const path = decodeGeometry(geometry);
  for (const [point, original, distance] of [
    [present(outline.points[0]), present(path[0]), 0],
    [
      present(outline.points.at(-1)),
      present(path.at(-1)),
      Math.round(route.distanceM),
    ],
  ] as const) {
    expect(point).toEqual([
      Math.round(original.latitude * 1e5) / 1e5,
      Math.round(original.longitude * 1e5) / 1e5,
      distance,
    ]);
  }
  expect(
    outline.points.every(
      (p, i) => i === 0 || p[2] >= present(outline.points[i - 1])[2],
    ),
  ).toBe(true);
  const distances = new Map<number, number>();
  for (const p of outline.points)
    distances.set(p[2], (distances.get(p[2]) ?? 0) + 1);
  expect(distances.size).toBe(outline.points.length);
});

test('legacy outline uses real start/finish weather points and leg midpoints; insufficient evidence stays null', async () => {
  const route = await makeRoute({ geometry: null });
  const outline = present(routeOutline(route) ?? undefined);
  const start = present(route.weatherLocations[0]),
    end = present(route.weatherLocations.at(-1));
  expect(outline.points[0]).toEqual([
    Math.round(start.coordinate.latitude * 1e5) / 1e5,
    Math.round(start.coordinate.longitude * 1e5) / 1e5,
    0,
  ]);
  expect(outline.points.at(-1)).toEqual([
    Math.round(end.coordinate.latitude * 1e5) / 1e5,
    Math.round(end.coordinate.longitude * 1e5) / 1e5,
    Math.round(route.distanceM),
  ]);
  expect(outline.points[1]?.[2]).toBe(
    Math.round((present(route.legs[0]).fromM + present(route.legs[0]).toM) / 2),
  );
  expect(routeOutline({ ...route, weatherLocations: [], legs: [] })).toBeNull();
  expect(
    routeOutline({
      ...route,
      geometry: {
        version: 1,
        encoding: 'polyline6',
        data: 'broken',
        pointCount: 2,
      },
    }),
  ).toEqual(outline);
});

test('outline handles date-line crossings without cutting away the bend', async () => {
  const geometry = present(
    encodeGeometry([
      { latitude: 0, longitude: 179.99 },
      { latitude: 0.01, longitude: 180 },
      { latitude: 0, longitude: -179.99 },
    ]) ?? undefined,
  );
  const outline = routeOutline(await makeRoute({ geometry, distanceM: 3000 }));
  expect(outline?.points).toEqual([
    [0, 179.99, 0],
    [0.01, 180, 1500],
    [0, -179.99, 3000],
  ]);
});

const example = async (bearings = [90, 270], wind = [270, 270], speed = 20) => {
  const base = await makeRoute();
  const locations = [
    present(base.weatherLocations[0]),
    present(base.weatherLocations.at(-1)),
  ];
  const route = {
    ...base,
    distanceM: 40000,
    legs: bearings.map((bearingDegrees, i) => ({
      ...present(base.legs[0]),
      fromM: i * 20000,
      toM: (i + 1) * 20000,
      bearingDegrees,
      coordinate: present(locations[i]).coordinate,
      weatherLocationId: present(locations[i]).id,
    })),
  };
  const input = inputFor([route], {
    timeZone: 'UTC',
    riding: { window: { start: '09:00', end: '12:00' } },
  });
  const forecasts = forecastsFor([route], (q, _hour, _route, i) =>
    q === 'wind-from-direction'
      ? present(wind[i])
      : q === 'wind-speed'
        ? speed / 3.6
        : q === 'wind-gust'
          ? 40 / 3.6
          : defaultValue(q),
  );
  const result = recommendRides([route], input, forecasts, now.getTime());
  const best = present(result.rankings[0]?.best ?? undefined);
  return { route, input, forecasts, result, best };
};

test('out-and-back wind sections cover the ride and preserve adverse gusts and the linear time model', async () => {
  const { route, result, best } = await example();
  expect(best.windStretches.map((s) => s.effect)).toEqual([
    'tailwind',
    'headwind',
  ]);
  expect(best.windStretches.map((s) => [s.fromM, s.toM])).toEqual([
    [0, 20000],
    [20000, 40000],
  ]);
  expect(
    Math.max(...best.windStretches.map((s) => s.maximumAdverseGustKph)),
  ).toBe(present(best.conditions.gustExposure).maximumAdverseKph);
  expect(best.windStretches[0]?.maximumAdverseGustKph).toBe(0);
  for (const ride of [best, ...present(result.rankings[0]).alternatives]) {
    expect(windStretchesSchema.safeParse(ride.windStretches).success).toBe(
      true,
    );
    for (const stretch of ride.windStretches) {
      const at = (m: number) =>
        new Date(
          Date.parse(ride.departureAt) +
            ((Date.parse(ride.finishAt) - Date.parse(ride.departureAt)) * m) /
              route.distanceM,
        ).toISOString();
      expect(stretch.startAt).toBe(at(stretch.fromM));
      expect(stretch.endAt).toBe(at(stretch.toM));
    }
  }
});

test('veering SW to W splits the same effect; light wind merges regardless of direction', async () => {
  const veer = await example([67.5, 67.5], [225, 270]);
  expect(
    veer.best.windStretches.map((s) => [s.effect, s.windFromDegrees]),
  ).toEqual([
    ['tailwind', 225],
    ['tailwind', 270],
  ]);
  const calm = await example([90, 270], [90, 270], 0);
  expect(calm.best.windStretches).toHaveLength(1);
  expect(calm.best.windStretches[0]?.effect).toBe('light');
  expect(calm.best.windStretches[0]?.windFromDegrees).toBeNull();
});

test('short adverse sections survive; gaps or absent observations never produce a partial cover', () => {
  const row = {
    windSpeedKph: 20,
    windFromDegrees: 270,
    headwindKph: -20,
    crosswindKph: 0,
    adverseGustKph: 0,
  };
  const rows = [
    { ...row, fromM: 0, toM: 10000, distanceM: 10000 },
    {
      ...row,
      fromM: 10000,
      toM: 10100,
      distanceM: 100,
      headwindKph: 20,
      adverseGustKph: 55,
    },
    { ...row, fromM: 10100, toM: 20000, distanceM: 9900 },
  ];
  const result = windStretchesFor(rows, 20000, now.getTime(), 3600000);
  expect(result.map((s) => s.effect)).toEqual([
    'tailwind',
    'headwind',
    'tailwind',
  ]);
  expect(result[1]?.maximumAdverseGustKph).toBe(55);
  expect(windStretchesFor([], 20000, now.getTime(), 3600000)).toEqual([]);
  expect(
    windStretchesFor(
      [present(rows[0]), present(rows[2])],
      20000,
      now.getTime(),
      3600000,
    ),
  ).toEqual([]);
});

test('N wraps into one sector; exact light threshold and distance-weighted means are respected', () => {
  const rows = [359, 1].map((windFromDegrees, i) => ({
    fromM: i ? 1000 : 0,
    toM: i ? 4000 : 1000,
    distanceM: i ? 3000 : 1000,
    windFromDegrees,
    windSpeedKph: i ? 20 : 10,
    headwindKph: -10,
    crosswindKph: 0,
    adverseGustKph: i ? 7 : 5,
  }));
  const stretches = windStretchesFor(rows, 4000, now.getTime(), 3600000);
  expect(stretches).toHaveLength(1);
  expect(stretches[0]?.effect).toBe('tailwind');
  expect(stretches[0]?.averageWindSpeedKph).toBe(17.5);
  expect(stretches[0]?.windFromDegrees).toBe(1);
});

test('partial climbing assessments and zero wind weight retain sections; missing weather retains only the outline', async () => {
  const { route, input, forecasts } = await example();
  const partial = recommendRides(
    [{ ...route, ascentM: null }],
    {
      ...input,
      preferences: {
        ...input.preferences,
        climbing: { preference: 'flatter' },
      },
    },
    forecasts,
    now.getTime(),
  ).unranked[0];
  expect(partial?.partialAssessment?.windStretches).toHaveLength(2);
  const zero = recommendRides(
    [route],
    {
      ...input,
      preferences: {
        ...input.preferences,
        weights: { ...input.preferences.weights, wind: 0 },
      },
    },
    forecasts,
    now.getTime(),
  );
  expect(zero.rankings[0]?.best?.windStretches).toHaveLength(2);
  const missing = recommendRides([route], input, [], now.getTime());
  expect(missing.unranked[0]?.outline).not.toBeNull();
  expect(missing.unranked[0]?.best).toBeNull();
});
