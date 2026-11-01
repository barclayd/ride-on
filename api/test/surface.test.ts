import { expect, test } from 'bun:test';
import {
  bindSurfaceEvidence,
  type SurfaceInput,
  sameSurfaceEvidence,
  surfaceInputSchema,
  surfaceSummary,
} from '../src/routes/surface.ts';

const route = { sourceHash: 'test-source', distanceM: 1_000 };
const at = '2026-10-12T12:00:00.000Z';
const input: SurfaceInput = {
  schemaVersion: 1,
  source: {
    providerId: 'cycle-travel',
    method: 'route-instructions',
    formatVersion: 2,
    mappingVersion: 1,
  },
  geometryDistanceM: 1_000,
  sections: [
    { fromM: 0, toM: 500, surface: 'paved', sourceCode: 'mode:13' },
    { fromM: 500, toM: 900, surface: 'unpaved', sourceCode: 'mode:15' },
    { fromM: 900, toM: 1_000, surface: 'non-cycling', sourceCode: 'mode:21' },
  ],
};

test('located evidence binds to the GPX hash with separate transport coverage', () => {
  const surface = bindSurfaceEvidence(input, route, 'cycle-travel', at);
  expect(surface.sourceHash).toBe(route.sourceHash);
  expect(surfaceSummary({ ...route, surface })).toEqual({
    status: 'complete',
    pavedM: 500,
    unpavedM: 400,
    nonCyclingM: 100,
    unknownM: 0,
    classifiedFraction: 1,
    unpavedFraction: 0.4,
    source: input.source,
    capturedAt: at,
  });
});

test('gaps and unknown classifications reduce coverage and never count as paved', () => {
  const surface = bindSurfaceEvidence(
    {
      ...input,
      sections: [
        { fromM: 100, toM: 300, surface: 'unknown', sourceCode: 'mode:9' },
        { fromM: 400, toM: 600, surface: 'gravel', sourceCode: 'surface:g' },
      ],
    },
    route,
    'cycle-travel',
    at,
  );
  expect(surfaceSummary({ ...route, surface })).toMatchObject({
    status: 'partial',
    pavedM: 0,
    unpavedM: 200,
    unknownM: 800,
    classifiedFraction: 0.2,
    unpavedFraction: null,
  });
  for (const value of [
    route,
    { ...route, surface: null },
    { ...route, surface, sourceHash: 'different' },
  ]) {
    expect(surfaceSummary(value)).toMatchObject({
      status: 'unavailable',
      unknownM: 1_000,
      unpavedFraction: null,
      source: null,
    });
  }
});

test('range validation rejects overlaps, reversed/outside ranges and source/geometry mismatch', () => {
  const [paved, unpaved] = input.sections;
  if (!paved || !unpaved) throw new Error('Missing test sections');
  for (const sections of [
    [
      {
        fromM: 500,
        toM: 400,
        surface: 'paved' as const,
        sourceCode: 'mode:13',
      },
    ],
    [
      {
        fromM: 0,
        toM: 1_001,
        surface: 'paved' as const,
        sourceCode: 'mode:13',
      },
    ],
    [unpaved, paved],
    [paved, { ...unpaved, fromM: 400 }],
  ])
    expect(() =>
      bindSurfaceEvidence({ ...input, sections }, route, 'cycle-travel', at),
    ).toThrow('Surface evidence');
  expect(() =>
    bindSurfaceEvidence(
      input,
      { ...route, distanceM: 900 },
      'cycle-travel',
      at,
    ),
  ).toThrow();
  expect(() => bindSurfaceEvidence(input, route, 'strava', at)).toThrow();
  for (const bad of [
    { ...input, geometryDistanceM: NaN },
    { ...input, sections: [] },
    { ...input, sections: [{ ...input.sections[0], surface: 'mud' }] },
    { ...input, sections: [{ ...input.sections[0], fromM: -1 }] },
    { ...input, sections: Array(5_001).fill(input.sections[0]) },
    { ...input, prediction: 'dry' },
  ])
    expect(surfaceInputSchema.safeParse(bad).success).toBe(false);
});

test('rounding tolerance ends exactly at the normalized GPX endpoint', () => {
  const surface = bindSurfaceEvidence(
    input,
    { ...route, distanceM: 999.9 },
    'cycle-travel',
    at,
  );
  expect(surface.geometryDistanceM).toBe(999.9);
  expect(surface.sections.at(-1)?.toM).toBe(999.9);
  expect(surfaceSummary({ ...route, distanceM: 999.9, surface }).status).toBe(
    'complete',
  );
});

test('retrieval timestamp changes alone do not change evidence identity', () => {
  const a = bindSurfaceEvidence(input, route, 'cycle-travel', at);
  expect(
    sameSurfaceEvidence(a, { ...a, capturedAt: '2026-10-13T00:00:00.000Z' }),
  ).toBe(true);
  expect(sameSurfaceEvidence(a, { ...a, sourceHash: 'changed' })).toBe(false);
  expect(sameSurfaceEvidence(a, null)).toBe(false);
  expect(sameSurfaceEvidence(null, undefined)).toBe(true);
});
