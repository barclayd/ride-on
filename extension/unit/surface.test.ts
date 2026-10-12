import { expect, test } from 'bun:test';
import { journeySurface, surfaceSeenKey } from '../lib/surface';

const points: [number, number][] = Array.from({ length: 7 }, (_, i) => [
  51 + i * 0.001,
  -1,
]);
const full = (
  index: number,
  mode: number,
  name = 'Test path',
  instruction = 1,
  distance = 111,
) => [instruction, name, distance, index, 30, 0, '', 0, mode];

test('short mode instructions locate paved paths, broad unpaved, rough and unsurveyed sections', () => {
  const result = journeySurface(
    points,
    [
      [111, 0, 13],
      [111, 1, 15],
      [111, 2, 16],
      [111, 3, 9],
      [111, 4, 31],
      [111, 5, 21],
    ],
    2,
  );
  expect(result?.sections.map((s) => s.surface)).toEqual([
    'paved',
    'unpaved',
    'rough-unpaved',
    'unknown',
    'unknown',
    'non-cycling',
  ]);
  expect(result?.geometryDistanceM).toBeCloseTo(667.17, 1);
  expect(result?.sections[1].fromM).toBeCloseTo(111.195, 2);
  expect(result?.sections.at(-1)?.toM).toBe(result?.geometryDistanceM);
});

test('full instructions mask mode flags and retain original category codes', () => {
  const result = journeySurface(
    points,
    [full(0, 13 | 256), full(3, 8), full(6, 0, '', 15, 0)],
    2,
  );
  expect(result?.sections.map((s) => [s.surface, s.sourceCode])).toEqual([
    ['paved', 'mode:269'],
    ['rough-unpaved', 'mode:8'],
  ]);
  expect(result?.sections[0].toM).toBe(result?.sections[1].fromM);
});

test('legacy explicit materials survive; absent surface is not inferred from road type', () => {
  const result = journeySurface(
    points,
    ['c', 'g', 'e', 'r', '', 'z'].map((code, i) =>
      full(i, 0, `||${code}|r|Private name||`),
    ),
    undefined,
  );
  expect(result?.source.formatVersion).toBe(1);
  expect(result?.sections.map((s) => s.surface)).toEqual([
    'compacted',
    'gravel',
    'earth',
    'grass',
    'unknown',
    'unknown',
  ]);
  expect(result?.sections.at(-1)?.sourceCode).toBe('surface:z');
  expect(JSON.stringify(result)).not.toContain('Private name');
  expect(
    journeySurface(points, [full(0, 0, '||constructor|r|Path||')], 1)
      ?.sections[0].surface,
  ).toBe('unknown');
  for (const code of ['p', 's', 'o']) {
    expect(
      journeySurface(points, [full(0, 0, `||${code}|c|Path||`)], 1)?.sections[0]
        .surface,
    ).toBe('paved');
  }
});

test('transport is separate, and manually drawn lines do not claim paved surface', () => {
  const result = journeySurface(
    points,
    [
      full(0, 13, 'Train{r}'),
      full(1, 13, 'Bus{b}'),
      full(2, 21),
      full(3, 13, 'Direct', 126),
      full(4, 13),
    ],
    2,
  );
  expect(result?.sections.map((s) => s.surface)).toEqual([
    'non-cycling',
    'non-cycling',
    'unknown',
    'paved',
  ]); // adjacent bus/train entries share a transport code
  expect(
    journeySurface(points, [full(0, 0, '||p|y|Ferry||')], 1)?.sections[0]
      .surface,
  ).toBe('non-cycling');
});

test('leading gaps stay unclassified and zero-length terminal markers do not cover tails', () => {
  const result = journeySurface(
    points,
    [full(2, 13), full(4, 0, '', 15, 0)],
    2,
  );
  expect(result?.sections[0].fromM).toBeGreaterThan(200);
  expect(result?.sections[1].surface).toBe('unknown');
});

test('duplicate polyline positions preserve instruction indices and GPX distance', () => {
  const repeated: [number, number][] = [
    points[0],
    points[0],
    points[1],
    points[2],
  ];
  const result = journeySurface(
    repeated,
    [
      [100, 0, 13],
      [100, 1, 15],
      [0, 3, 0],
    ],
    2,
  );
  expect(result?.sections).toHaveLength(1);
  expect(result?.sections[0].surface).toBe('unpaved');
  expect(result?.geometryDistanceM).toBeCloseTo(222.39, 1);
});

test('unsupported/malformed directions omit evidence without breaking GPX import', () => {
  for (const directions of [
    undefined,
    null,
    [],
    'bad',
    [[100, 8, 13]],
    [[100, -1, 13]],
    [
      [100, 3, 13],
      [100, 2, 15],
    ],
    [[NaN, 0, 13]],
    [[-1, 0, 13]],
    [[100, 0.5, 13]],
    [[100, 0, 13], null],
    Array.from({ length: 10_001 }, () => [1, 0, 13]),
  ]) {
    expect(journeySurface(points, directions, 2)).toBeUndefined();
  }
  expect(journeySurface(points, [[100, 0, 13]], 3)).toBeUndefined();
  expect(journeySurface(points, [[100, 0, 13]], 1)).toBeUndefined();
  expect(
    journeySurface(
      [
        [91, 0],
        [92, 0],
      ],
      [[100, 0, 13]],
      2,
    ),
  ).toBeUndefined();
  expect(journeySurface(points, [full(0, -1)], 2)?.sections[0].surface).toBe(
    'unknown',
  );
});

test('surface refresh marker cannot match the previous timestamp-only marker', () => {
  const seen: Record<string, number> = { '123': 77 };
  expect(seen[surfaceSeenKey('123')]).toBeUndefined();
  seen[surfaceSeenKey('123')] = 77;
  expect(seen[surfaceSeenKey('123')]).toBe(77);
});
