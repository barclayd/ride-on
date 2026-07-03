import type { Point } from './types.ts';

// Planar (lat/lon-as-XY) perpendicular distance — fine for Douglas-Peucker,
// which only needs distances relative to each other, not true metric ones.
const perpendicularDistance = (
  point: Point,
  lineStart: Point,
  lineEnd: Point,
): number => {
  const [x, y] = point;
  const [x1, y1] = lineStart;
  const [x2, y2] = lineEnd;
  const dx = x2 - x1;
  const dy = y2 - y1;

  if (dx === 0 && dy === 0) {
    return Math.hypot(x - x1, y - y1);
  }

  const t = ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy);
  const clampedT = Math.max(0, Math.min(1, t));
  const projX = x1 + clampedT * dx;
  const projY = y1 + clampedT * dy;
  return Math.hypot(x - projX, y - projY);
};

/** Ramer-Douglas-Peucker line simplification. Always preserves both endpoints. */
export const rdp = (points: readonly Point[], epsilon: number): Point[] => {
  if (points.length < 3) {
    return [...points];
  }

  const first = points[0] as Point;
  const last = points[points.length - 1] as Point;

  let maxDist = -1;
  let splitIndex = -1;
  for (let i = 1; i < points.length - 1; i++) {
    const dist = perpendicularDistance(points[i] as Point, first, last);
    if (dist > maxDist) {
      maxDist = dist;
      splitIndex = i;
    }
  }

  if (maxDist > epsilon && splitIndex !== -1) {
    const left = rdp(points.slice(0, splitIndex + 1), epsilon);
    const right = rdp(points.slice(splitIndex), epsilon);
    return [...left.slice(0, -1), ...right];
  }

  return [first, last];
};

/**
 * Simplify down to at most `maxPoints` vertices by binary-searching the
 * Douglas-Peucker epsilon (in degrees — a coarse but adequate unit here).
 */
export const simplifyToMax = (
  points: readonly Point[],
  maxPoints: number,
): Point[] => {
  if (points.length <= maxPoints) {
    return [...points];
  }

  let lo = 0;
  let hi = 1;
  let best = rdp(points, hi);
  while (best.length > maxPoints && hi < 100) {
    hi *= 2;
    best = rdp(points, hi);
  }

  for (let i = 0; i < 25; i++) {
    const mid = (lo + hi) / 2;
    const candidate = rdp(points, mid);
    if (candidate.length > maxPoints) {
      lo = mid;
    } else {
      hi = mid;
      best = candidate;
    }
  }

  return best;
};
