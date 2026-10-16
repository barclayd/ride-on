import { decodeGeometry, distanceM } from '../rides/geometry.ts';
import type { Coordinate } from '../weather/contracts.ts';
import type { Route } from './model.ts';

export type RouteOutline = {
  version: 1;
  points: [latitude: number, longitude: number, distanceM: number][];
};
type Point = Coordinate & { distanceM: number };
const usable = (p: Coordinate) =>
  Number.isFinite(p.latitude) &&
  Number.isFinite(p.longitude) &&
  Math.abs(p.latitude) <= 90 &&
  Math.abs(p.longitude) <= 180;

const outlinePoints = (route: Route): Point[] => {
  if (route.geometry) {
    try {
      const path = decodeGeometry(route.geometry);
      let cumulative = 0;
      const points = path.map((p, i) => {
        const previous = path[i - 1];
        if (previous) cumulative += distanceM(previous, p);
        return { ...p, distanceM: cumulative };
      });
      // Stored geometry was already simplified during import. Align its chainage
      // with the route's authoritative length before simplifying the sketch.
      if (points.length >= 2 && cumulative > 0)
        return points.map((p) => ({
          ...p,
          distanceM: (p.distanceM / cumulative) * route.distanceM,
        }));
    } catch {
      // A display sketch must not make an otherwise assessable route fail.
    }
  }
  const start = route.weatherLocations.find((p) => p.distanceM === 0);
  const end = route.weatherLocations.find(
    (p) => p.distanceM === route.distanceM,
  );
  // Legs store midpoints, not endpoints. Never present a midpoint as the start.
  if (!start || !end || !usable(start.coordinate) || !usable(end.coordinate))
    return [];
  return [
    { ...start.coordinate, distanceM: 0 },
    ...route.legs
      .filter((leg) => usable(leg.coordinate))
      .map((leg) => ({
        ...leg.coordinate,
        distanceM: (leg.fromM + leg.toM) / 2,
      }))
      .filter((p) => p.distanceM > 0 && p.distanceM < route.distanceM)
      .sort((a, b) => a.distanceM - b.distanceM),
    { ...end.coordinate, distanceM: route.distanceM },
  ];
};

/** Point-budget Douglas–Peucker: split the greatest remaining error first.
 * Earth-centred metres avoid discontinuities at the date line and poles.
 * At most 62 splits; endpoints and each retained point's chainage survive. */
const simplify = (points: readonly Point[]) => {
  if (points.length <= 64) return points;
  const vectors = points.map((p) => {
    const lat = (p.latitude * Math.PI) / 180;
    const lon = (p.longitude * Math.PI) / 180;
    return [
      6371000 * Math.cos(lat) * Math.cos(lon),
      6371000 * Math.cos(lat) * Math.sin(lon),
      6371000 * Math.sin(lat),
    ];
  });
  const interval = (first: number, last: number) => {
    const a = vectors[first];
    const b = vectors[last];
    let index = -1;
    let error = 0;
    if (a && b) {
      const d = b.map((v, i) => v - (a[i] ?? 0));
      const squared = d.reduce((n, v) => n + v * v, 0);
      for (let i = first + 1; i < last; i++) {
        const p = vectors[i];
        if (!p) continue;
        const t = squared
          ? Math.max(
              0,
              Math.min(
                1,
                p.reduce((n, v, j) => n + (v - (a[j] ?? 0)) * (d[j] ?? 0), 0) /
                  squared,
              ),
            )
          : 0;
        const next = p.reduce(
          (n, v, j) => n + (v - (a[j] ?? 0) - t * (d[j] ?? 0)) ** 2,
          0,
        );
        if (next > error) {
          error = next;
          index = i;
        }
      }
    }
    return { first, last, index, error };
  };
  const kept = new Set([0, points.length - 1]);
  const pending = [interval(0, points.length - 1)];
  while (kept.size < 64 && pending.length) {
    pending.sort((a, b) => b.error - a.error || a.first - b.first);
    const next = pending.shift();
    if (!next || next.index < 0) break;
    kept.add(next.index);
    pending.push(
      interval(next.first, next.index),
      interval(next.index, next.last),
    );
  }
  return [...kept]
    .sort((a, b) => a - b)
    .flatMap((i) => (points[i] ? [points[i]] : []));
};

/** Display-only, deliberately independent of weather, departures and scoring. */
export const routeOutline = (route: Route): RouteOutline | null => {
  const points = outlinePoints(route);
  if (points.length < 2) return null;
  return {
    version: 1,
    points: simplify(points).map((p) => [
      Math.round(p.latitude * 1e5) / 1e5,
      Math.round(p.longitude * 1e5) / 1e5,
      Math.round(p.distanceM),
    ]),
  };
};
