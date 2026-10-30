export const clamp = (value: number, min = 0, max = 1) =>
  Math.min(max, Math.max(min, value));

/** Ease in-out cubic. */
export const easeInOut = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;

/** Ease out cubic. */
export const easeOut = (t: number) => 1 - (1 - t) ** 3;

type Point = readonly [number, number];

/** A point along a cubic Bézier. */
export const bezier = (
  [p0, p1, p2, p3]: readonly [Point, Point, Point, Point],
  t: number,
): Point => {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return [
    a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
    a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
  ];
};
