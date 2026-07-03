import { describe, expect, test } from 'bun:test';
import { decodePolyline, encodePolyline } from '../src/polyline.ts';
import type { Point } from '../src/types.ts';

describe('polyline', () => {
  test('decodes the canonical Google polyline example', () => {
    const decoded = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
    expect(decoded).toHaveLength(3);
    expect(decoded[0]?.[0]).toBeCloseTo(38.5, 5);
    expect(decoded[0]?.[1]).toBeCloseTo(-120.2, 5);
    expect(decoded[1]?.[0]).toBeCloseTo(40.7, 5);
    expect(decoded[1]?.[1]).toBeCloseTo(-120.95, 5);
    expect(decoded[2]?.[0]).toBeCloseTo(43.252, 5);
    expect(decoded[2]?.[1]).toBeCloseTo(-126.453, 5);
  });

  test('encode(decode(x)) round-trips exactly for the canonical example', () => {
    const original = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';
    expect(encodePolyline(decodePolyline(original))).toBe(original);
  });

  test('decode(encode(x)) round-trips within precision for arbitrary points', () => {
    const points: Point[] = [
      [51.7189, -1.9694],
      [51.72, -1.965],
      [51.7305, -1.9502],
      [51.5, 0],
      [-33.8688, 151.2093],
    ];

    const roundTripped = decodePolyline(encodePolyline(points));
    expect(roundTripped).toHaveLength(points.length);
    roundTripped.forEach(([lat, lon], i) => {
      expect(lat).toBeCloseTo(points[i]?.[0] as number, 5);
      expect(lon).toBeCloseTo(points[i]?.[1] as number, 5);
    });
  });

  test('decoding an empty string yields no points', () => {
    expect(decodePolyline('')).toEqual([]);
  });

  test('throws on a truncated/malformed polyline', () => {
    // A single continuation byte with no terminator: shift never completes.
    expect(() => decodePolyline('~~~~~~~~~~')).toThrow();
  });
});
