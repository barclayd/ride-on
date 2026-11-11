import type { Route } from '../routes/model.ts';
import type { Coordinate } from './contracts.ts';
import boundaries from './taiwan-boundaries.json' with { type: 'json' };

// MOI county boundaries served by Hualien County's public map service, retrieved
// 2026-11-05 UTC (layers 179 and 180). Simplified to 0.0005 degrees, rounded to five
// decimals. Includes Penghu, Kinmen, Matsu, Green Island and Orchid Island.
// See docs/cwa-weather.md for source and maintenance. Border uncertainty keeps
// the global provider; nearest-township distance is never country containment.
const inRing = (longitude: number, latitude: number, ring: number[][]) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i],
      b = ring[j];
    if (!a || !b) continue;
    const [ax = NaN, ay = NaN] = a,
      [bx = NaN, by = NaN] = b;
    if (
      ay > latitude !== by > latitude &&
      longitude < ((bx - ax) * (latitude - ay)) / (by - ay) + ax
    )
      inside = !inside;
  }
  return inside;
};
export const isTaiwanCoordinate = ({ latitude, longitude }: Coordinate) =>
  Number.isFinite(latitude) &&
  Number.isFinite(longitude) &&
  boundaries.some(
    ({ bounds, rings }) =>
      longitude >= (bounds[0] ?? Infinity) &&
      longitude <= (bounds[2] ?? -Infinity) &&
      latitude >= (bounds[1] ?? Infinity) &&
      latitude <= (bounds[3] ?? -Infinity) &&
      rings.reduce(
        (inside, ring) =>
          inRing(longitude, latitude, ring) ? !inside : inside,
        false,
      ),
  );

/** All samples and leg midpoints must lie in Taiwan. Applied to each route
 * independently so foreign routes in the shortlist cannot suppress CWA. */
export const taiwanRoutes = (routes: readonly Route[]) =>
  routes.length > 0 &&
  routes.every((route) =>
    [...route.weatherLocations, ...route.legs].every(({ coordinate }) =>
      isTaiwanCoordinate(coordinate),
    ),
  );
