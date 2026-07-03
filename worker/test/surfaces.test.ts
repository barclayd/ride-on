import { describe, expect, test } from 'bun:test';
import {
  aggregateSurfaces,
  type SurfaceBuckets,
  suggestType,
  type ValhallaEdge,
} from '../src/surfaces.ts';

// Hand-computed fixture: 10 edges, 10km total.
//  1. secondary/paved        2.0km -> busyRoad
//  2. primary/paved          1.0km -> busyRoad
//  3. residential/paved      1.5km -> paved
//  4. tertiary/paved_rough   0.5km -> paved
//  5. residential/gravel     1.0km -> unpaved
//  6. unclassified/dirt      0.5km -> unpaved
//  7. residential/cycleway   1.0km -> path (use wins over its paved surface)
//  8. residential/footway    0.8km -> path (surface "path")
//  9. residential/compacted  0.7km -> unpaved
// 10. residential, no attrs  1.0km -> unknown
// busyRoad=3.0 paved=2.0 unpaved=2.2 path=1.8 unknown=1.0 (sum=10.0)
const fixtureEdges: ValhallaEdge[] = [
  { road_class: 'secondary', surface: 'paved', length: 2.0 },
  { road_class: 'primary', surface: 'paved', length: 1.0 },
  { road_class: 'residential', surface: 'paved', length: 1.5 },
  { road_class: 'tertiary', surface: 'paved_rough', length: 0.5 },
  { road_class: 'residential', surface: 'gravel', length: 1.0 },
  { road_class: 'unclassified', surface: 'dirt', length: 0.5 },
  { road_class: 'residential', surface: 'paved', use: 'cycleway', length: 1.0 },
  { road_class: 'residential', surface: 'path', use: 'footway', length: 0.8 },
  { road_class: 'residential', surface: 'compacted', length: 0.7 },
  { road_class: 'residential', length: 1.0 },
];

describe('aggregateSurfaces', () => {
  test('length-weights edges into the correct buckets', () => {
    const { buckets, lengthKm } = aggregateSurfaces(fixtureEdges);

    expect(lengthKm).toBeCloseTo(10.0, 5);
    expect(buckets.busyRoad).toBeCloseTo(0.3, 5);
    expect(buckets.paved).toBeCloseTo(0.2, 5);
    expect(buckets.unpaved).toBeCloseTo(0.22, 5);
    expect(buckets.path).toBeCloseTo(0.18, 5);
    expect(buckets.unknown).toBeCloseTo(0.1, 5);
  });

  test('fractions always sum to 1', () => {
    const { buckets } = aggregateSurfaces(fixtureEdges);
    const sum = Object.values(buckets).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 10);
  });

  test('handles an empty edge list', () => {
    const { buckets, lengthKm } = aggregateSurfaces([]);
    expect(lengthKm).toBe(0);
    expect(Object.values(buckets).reduce((a, b) => a + b, 0)).toBe(0);
  });
});

describe('suggestType', () => {
  const buckets = (partial: Partial<SurfaceBuckets>): SurfaceBuckets => ({
    busyRoad: 0,
    paved: 0,
    unpaved: 0,
    path: 0,
    unknown: 0,
    ...partial,
  });

  test('road when paved + busyRoad >= 0.9', () => {
    expect(
      suggestType(
        buckets({ busyRoad: 0.5, paved: 0.45, unpaved: 0.03, path: 0.02 }),
      ),
    ).toBe('road');
  });

  test('gravel when unpaved + path >= 0.35', () => {
    expect(
      suggestType(
        buckets({
          busyRoad: 0.4,
          paved: 0.3,
          unpaved: 0.15,
          path: 0.1,
          unknown: 0.05,
        }),
      ),
    ).toBe('mixed'); // 0.15 + 0.1 = 0.25 < 0.35, sanity check on the boundary case below

    expect(suggestType(buckets({ paved: 0.65, unpaved: 0.35 }))).toBe('gravel'); // exactly at the 0.35 threshold
  });

  test('mixed otherwise', () => {
    expect(
      suggestType(
        buckets({
          busyRoad: 0.4,
          paved: 0.3,
          unpaved: 0.15,
          path: 0.1,
          unknown: 0.05,
        }),
      ),
    ).toBe('mixed');
  });

  test('the fixture route is gravel (unpaved + path = 0.4)', () => {
    const { buckets: fixtureBuckets } = aggregateSurfaces(fixtureEdges);
    expect(suggestType(fixtureBuckets)).toBe('gravel');
  });
});
