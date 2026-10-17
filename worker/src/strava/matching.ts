import { decodeGeometry, distanceM } from '../rides/geometry.ts';
import type { Route } from '../routes/model.ts';
export type MatchRoute = {
  route: Pick<Route, 'id' | 'name' | 'geometry' | 'distanceM'>;
  version: number;
};

import type { Coordinate } from '../weather/contracts.ts';

export const ACTIVITY_MATCHER = 'strava-route-coverage-v1';
export const SUGGEST_COVERAGE = 0.5;
export const AUTO_COVERAGE = 0.9;
const STEP_M = 10;
const TOLERANCE_M = 12;
const COS_HEADING = Math.cos(Math.PI / 6);
type Vector = [number, number, number];
type Piece = { mid: Vector; direction: Vector; length: number };
const xyz = (p: Coordinate): Vector => {
  const lat = (p.latitude * Math.PI) / 180,
    lon = (p.longitude * Math.PI) / 180;
  return [
    6371000 * Math.cos(lat) * Math.cos(lon),
    6371000 * Math.cos(lat) * Math.sin(lon),
    6371000 * Math.sin(lat),
  ];
};
const delta = (a: Vector, b: Vector): Vector => [
  b[0] - a[0],
  b[1] - a[1],
  b[2] - a[2],
];
const dot = (a: Vector, b: Vector) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const lerp = (a: Vector, b: Vector, t: number): Vector => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
// Resample by distance, not GPS point count. Each recorded piece may cover only
// one planned piece, so a single outbound leg cannot complete an out-and-back.
const sample = (points: readonly Coordinate[], activity: boolean): Piece[] => {
  if (points.length < 2 || points.length > 100_000)
    throw new Error('geometry_unavailable');
  const result: Piece[] = [];
  const first = points[0],
    last = points.at(-1);
  if (!first || !last) throw new Error('geometry_unavailable');
  let start = xyz(first);
  let accumulated = 0;
  for (let i = 1; i < points.length; i++) {
    const previous = points[i - 1],
      point = points[i];
    if (!previous || !point) throw new Error('geometry_unavailable');
    let length = distanceM(previous, point);
    if (!Number.isFinite(length) || (activity && length > 500))
      throw new Error('geometry_gap');
    if (length < 0.01) continue;
    let from = xyz(previous);
    const to = xyz(point);
    // Keep a turning point as a boundary. Sampling across a U-turn would turn
    // ten metres of travelled path into a short chord and lose half-route evidence.
    const incoming = delta(start, from),
      outgoing = delta(from, to);
    if (
      accumulated > 0.1 &&
      dot(incoming, incoming) > 0.01 &&
      dot(incoming, outgoing) <
        COS_HEADING *
          Math.sqrt(dot(incoming, incoming) * dot(outgoing, outgoing))
    ) {
      result.push({
        mid: lerp(start, from, 0.5),
        direction: incoming,
        length: accumulated,
      });
      if (result.length > 60_000) throw new Error('geometry_limit');
      start = from;
      accumulated = 0;
    }
    while (accumulated + length >= STEP_M) {
      const used = STEP_M - accumulated;
      const end = lerp(from, to, used / length);
      const direction = delta(start, end);
      if (dot(direction, direction) > 0.01)
        result.push({ mid: lerp(start, end, 0.5), direction, length: STEP_M });
      if (result.length > 60_000) throw new Error('geometry_limit');
      from = end;
      start = end;
      length -= used;
      accumulated = 0;
    }
    accumulated += length;
  }
  if (accumulated > 0.1) {
    const end = xyz(last);
    const direction = delta(start, end);
    if (dot(direction, direction) > 0.01)
      result.push({
        mid: lerp(start, end, 0.5),
        direction,
        length: accumulated,
      });
  }
  if (!result.length) throw new Error('geometry_unavailable');
  return result;
};
const cell = (p: Vector): Vector => [
  Math.floor(p[0] / 25),
  Math.floor(p[1] / 25),
  Math.floor(p[2] / 25),
];
export type RouteMatch = {
  routeId: string;
  routeName: string;
  routeVersion: number;
  routeDistanceM: number;
  coverageFraction: number;
  matchedDistanceM: number;
  direction: 'forward' | 'reverse' | 'mixed';
};
export type MatchResult = {
  matcherVersion: typeof ACTIVITY_MATCHER;
  status: 'matched' | 'suggested' | 'unmatched' | 'unavailable';
  reason: string | null;
  primaryRouteId: string | null;
  assessmentComplete: boolean;
  candidates: RouteMatch[];
};
export const decideMatches = (
  candidates: RouteMatch[],
  complete = true,
): MatchResult => {
  const sorted = candidates
    .filter((r) => r.coverageFraction >= SUGGEST_COVERAGE)
    .sort(
      (a, b) =>
        b.coverageFraction - a.coverageFraction ||
        a.routeId.localeCompare(b.routeId),
    );
  const first = sorted[0],
    second = sorted[1];
  const ambiguous =
    !!first &&
    !!second &&
    (second.coverageFraction >= AUTO_COVERAGE ||
      first.coverageFraction - second.coverageFraction < 0.05);
  const automatic =
    !!first &&
    complete &&
    !ambiguous &&
    first.coverageFraction >= AUTO_COVERAGE &&
    first.direction !== 'mixed';
  return {
    matcherVersion: ACTIVITY_MATCHER,
    status: automatic
      ? 'matched'
      : first
        ? 'suggested'
        : complete
          ? 'unmatched'
          : 'unavailable',
    reason: !complete
      ? 'incomplete_geometry'
      : ambiguous
        ? 'multiple_routes'
        : first?.direction === 'mixed'
          ? 'mixed_direction'
          : first && !automatic
            ? 'partial_route'
            : null,
    primaryRouteId: automatic ? first.routeId : null,
    assessmentComplete: complete,
    candidates: sorted.slice(0, 50),
  };
};
export const matchActivity = (
  points: readonly Coordinate[],
  routes: readonly MatchRoute[],
  assessmentComplete = true,
): MatchResult => {
  const candidates: RouteMatch[] = [];
  let complete = assessmentComplete && routes.length <= 1000;
  let work = 0;
  try {
    const recorded = sample(points, true);
    const grid = new Map<string, number[]>();
    for (const [i, piece] of recorded.entries()) {
      const key = cell(piece.mid).join(',');
      const indices = grid.get(key) ?? [];
      indices.push(i);
      grid.set(key, indices);
    }
    for (const record of routes.slice(0, 1000)) {
      if (!record.route.geometry) {
        complete = false;
        continue;
      }
      let planned: Piece[];
      try {
        planned = sample(decodeGeometry(record.route.geometry), false);
      } catch {
        complete = false;
        continue;
      }
      const used: [Set<number>, Set<number>, Set<number>] = [
        new Set(),
        new Set(),
        new Set(),
      ];
      const covered: [number, number, number] = [0, 0, 0];
      for (const piece of planned) {
        if (++work > 500_000) throw new Error('assessment_limit');
        const [x, y, z] = cell(piece.mid);
        const options: { index: number; squared: number; reverse: boolean }[] =
          [];
        for (let dx = -1; dx <= 1; dx++)
          for (let dy = -1; dy <= 1; dy++)
            for (let dz = -1; dz <= 1; dz++) {
              for (const index of grid.get(`${x + dx},${y + dy},${z + dz}`) ??
                []) {
                if (++work > 500_000) throw new Error('assessment_limit');
                const other = recorded[index];
                if (!other) continue;
                const offset = delta(piece.mid, other.mid),
                  squared = dot(offset, offset);
                const heading = dot(piece.direction, other.direction);
                if (
                  squared > TOLERANCE_M ** 2 ||
                  Math.abs(heading) <
                    COS_HEADING *
                      Math.sqrt(
                        dot(piece.direction, piece.direction) *
                          dot(other.direction, other.direction),
                      )
                )
                  continue;
                options.push({ index, squared, reverse: heading < 0 });
              }
            }
        options.sort((a, b) => a.squared - b.squared || a.index - b.index);
        for (const mode of [0, 1, 2] as const) {
          const found = options.find(
            (o) =>
              !used[mode].has(o.index) &&
              (mode === 2 || o.reverse === (mode === 1)),
          );
          if (found) {
            used[mode].add(found.index);
            covered[mode] += Math.min(
              piece.length,
              recorded[found.index]?.length ?? 0,
            );
          }
        }
      }
      const length = planned.reduce((n, p) => n + p.length, 0);
      const oriented = Math.max(covered[0], covered[1]);
      // Small sampling differences do not turn a forward route into mixed.
      const mixed = covered[2] > oriented + length * 0.05;
      const matched = mixed ? covered[2] : oriented;
      // Stabilize inclusive percentage boundaries against floating-point distance noise.
      const fraction = Math.min(
        1,
        Math.round((matched / length) * 1_000_000) / 1_000_000,
      );
      if (fraction >= SUGGEST_COVERAGE)
        candidates.push({
          routeId: record.route.id,
          routeName: record.route.name,
          routeVersion: record.version,
          routeDistanceM: record.route.distanceM,
          coverageFraction: fraction,
          matchedDistanceM: record.route.distanceM * fraction,
          direction: mixed
            ? 'mixed'
            : covered[1] > covered[0]
              ? 'reverse'
              : 'forward',
        });
    }
  } catch {
    complete = false;
  }
  return decideMatches(candidates, complete);
};
