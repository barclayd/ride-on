import { describe, expect, test } from 'bun:test';
import { rdp, simplifyToMax } from '../src/simplify.ts';
import type { Point } from '../src/types.ts';

describe('rdp (Douglas-Peucker)', () => {
  test('collapses a perfectly straight line to just its endpoints', () => {
    const points: Point[] = Array.from({ length: 50 }, (_, i) => [
      51.7 + i * 0.001,
      -1.9 + i * 0.001,
    ]);

    const simplified = rdp(points, 0.0001);
    expect(simplified).toEqual([
      points[0] as Point,
      points[points.length - 1] as Point,
    ]);
  });

  test('keeps a point that deviates from the line beyond epsilon', () => {
    const points: Point[] = [
      [0, 0],
      [1, 1.5], // spike off the 0,0 -> 2,2 line
      [2, 2],
    ];

    const simplified = rdp(points, 0.01);
    expect(simplified).toHaveLength(3);
  });

  test('always preserves the first and last point', () => {
    const points: Point[] = Array.from({ length: 30 }, (_, i) => [
      Math.sin(i / 3),
      Math.cos(i / 5),
    ]);

    const simplified = rdp(points, 0.5);
    expect(simplified[0]).toEqual(points[0] as Point);
    expect(simplified[simplified.length - 1]).toEqual(
      points[points.length - 1] as Point,
    );
  });
});

describe('simplifyToMax', () => {
  test('bounds output to at most maxPoints', () => {
    const points: Point[] = Array.from({ length: 2000 }, (_, i) => [
      51.7 + Math.sin(i / 17) * 0.05 + i * 0.00001,
      -1.9 + Math.cos(i / 23) * 0.05 + i * 0.00001,
    ]);

    const simplified = simplifyToMax(points, 500);
    expect(simplified.length).toBeLessThanOrEqual(500);
    expect(simplified.length).toBeGreaterThan(1);
  });

  test('preserves endpoints under aggressive simplification', () => {
    const points: Point[] = Array.from({ length: 2000 }, (_, i) => [
      51.7 + Math.sin(i / 17) * 0.05,
      -1.9 + Math.cos(i / 23) * 0.05,
    ]);

    const simplified = simplifyToMax(points, 50);
    expect(simplified[0]).toEqual(points[0] as Point);
    expect(simplified[simplified.length - 1]).toEqual(
      points[points.length - 1] as Point,
    );
  });

  test('is a no-op when already under the limit', () => {
    const points: Point[] = [
      [0, 0],
      [1, 1],
      [2, 0],
    ];
    expect(simplifyToMax(points, 500)).toEqual(points);
  });
});
