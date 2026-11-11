import { expect, test } from 'bun:test';
import { filteredAscent } from '../src/routes/elevation.ts';

test('continuous climbs retain their full rise, including sub-metre steps', () => {
  expect(filteredAscent([])).toBe(0);
  expect(filteredAscent([100])).toBe(0);
  expect(filteredAscent([10, 30])).toBe(20);
  expect(filteredAscent(Array.from({ length: 401 }, (_, i) => i / 4))).toBe(
    100,
  );
  expect(filteredAscent([100, 90, 80, 70])).toBe(0);
});

test('repeated small undulations do not accumulate as extra climbing', () => {
  const heights = [
    0,
    100,
    ...Array.from({ length: 1000 }, (_, i) => (i % 2 ? 100 : 96)),
    0,
  ];
  expect(filteredAscent(heights)).toBe(100);
  expect(filteredAscent([0, 100, 50, 100, 0])).toBe(140);
});

test('interpolating points preserves the estimate', () => {
  const heights = [100, 130, 125, 135, 80, 100, 95, 105, 60];
  const dense = heights.flatMap((height, i) => {
    const next = heights[i + 1];
    return next === undefined
      ? [height]
      : Array.from(
          { length: 100 },
          (_, j) => height + ((next - height) * j) / 100,
        );
  });
  expect(filteredAscent(dense)).toBeCloseTo(filteredAscent(heights), 8);
});
