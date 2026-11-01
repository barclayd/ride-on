import { expect, test } from 'bun:test';
import assert from 'node:assert/strict';
import {
  assessGround,
  assessmentWindowError,
} from '../src/ground/assessment.ts';
import { DAY, HOUR } from '../src/ground/contracts.ts';
import { routeExposure } from '../src/ground/spatial.ts';
import {
  estimateGround,
  materialFor,
  wetnessTimeline,
} from '../src/ground/wetness.ts';
import { groundRoute } from './fixtures/ground.ts';
import { GROUND_NOW as now, wetnessEvidence } from './fixtures/wetness.ts';

test('wet history persists beyond 14 days and initial wetness is bracketed rather than assumed dry', async () => {
  const route = groundRoute();
  const dry = await wetnessEvidence([route], (h) => ({
    ...h,
    referenceEt0Mm: 0,
  }));
  const antecedent = await wetnessEvidence([route], (h) => ({
    ...h,
    referenceEt0Mm: 0,
    rainMm: Date.parse(h.end) < now - 14 * DAY ? 1 : 0,
  }));
  const first = present(
    wetnessTimeline(present(dry.cells[0]), now, now).get(now),
  );
  const wet = present(
    wetnessTimeline(present(antecedent.cells[0]), now, now).get(now),
  );
  expect(first.lower).toBe(0);
  expect(first.upper).toBeGreaterThan(0);
  expect(wet.upper).toBeGreaterThan(first.upper);
  expect(wet.central).toBeGreaterThan(first.central);
  expect(first.expectedHours).toBe(672);
});
test('more rain cannot improve wetness; stronger drying improves the same surface without a calendar bonus', async () => {
  const route = groundRoute();
  const scenario = async (rain: number, drying: number, date = now) => {
    const e = await wetnessEvidence(
      [route],
      (h) => ({ ...h, rainMm: rain, referenceEt0Mm: drying }),
      date,
    );
    return present(wetnessTimeline(present(e.cells[0]), date, date).get(date));
  };
  const dry = await scenario(0, 0.02);
  const wet = await scenario(0.3, 0.02);
  const summer = await scenario(0.3, 0.2);
  for (const field of ['lower', 'central', 'upper'] as const) {
    expect(wet[field]).toBeGreaterThanOrEqual(dry[field]);
    expect(summer[field]).toBeLessThan(wet[field]);
  }
  expect(await scenario(0.3, 0.02, Date.parse('2026-06-07T12:00:00Z'))).toEqual(
    wet,
  );
  const gravel = estimateGround(wet, 'granular');
  const earth = estimateGround(wet, 'soft');
  expect(gravel.condition).toBe('muddy');
  expect(earth.condition).toBe('difficult');
  expect(gravel.confidence).toBe('low');
});
test('same-cell sections retain their own arrival times; an unfinished hour and rain after passage are excluded', async () => {
  const route = groundRoute();
  expect(routeExposure(route).sections).toHaveLength(1);
  expect(routeExposure(route, false).sections).toHaveLength(2);
  const e = await wetnessEvidence([route], (h) => ({
    ...h,
    rainMm: Date.parse(h.end) === now + HOUR ? 30 : 0,
  }));
  const departure = now + 58 * 60000;
  const result = assessGround([route], e, departure, 20, now);
  const sections = present(result.routes[0]).sections;
  expect(present(sections[0]).evidenceThrough).toBe(
    new Date(now).toISOString(),
  );
  expect(present(sections[0]).condition).toBe('firm');
  expect(present(sections[1]).evidenceThrough).toBe(
    new Date(now + HOUR).toISOString(),
  );
  expect(present(sections[1]).condition).toBe('muddy');
  expect(present(sections[1]).reasons).toContain('includes-forecast');
  const later = structuredClone(e);
  for (const h of present(later.cells[0]).hours)
    if (Date.parse(h.end) > now + HOUR) {
      h.rainMm = 100;
      h.temperatureC = -10;
      h.snowfallCm = 10;
    }
  expect(assessGround([route], later, departure, 20, now).routes).toEqual(
    result.routes,
  );
  expect(result.scoringApplied).toBe(false);
});
test('missing, stale and post-assessment evidence cannot become firm ground', async () => {
  const route = groundRoute();
  for (const problem of ['missing', 'stale', 'future-retrieval'] as const) {
    const e = await wetnessEvidence([route]);
    const cell = present(e.cells[0]);
    if (problem === 'missing')
      present(cell.hours.find((h) => Date.parse(h.end) === now)).rainMm = null;
    if (problem === 'stale')
      present(cell.days.find((d) => d.date === '2026-10-09')).stale = true;
    if (problem === 'future-retrieval')
      present(cell.days.find((d) => d.date === '2026-10-09')).retrievedAt =
        new Date(now + HOUR).toISOString();
    const result = present(assessGround([route], e, now, 20, now).routes[0]);
    expect(result.coverage.unknownM).toBe(1000);
    expect(present(result.sections[0]).condition).toBeNull();
    expect(present(result.sections[0]).wetnessIndex).toBeNull();
  }
});
test('snow, freezing and recent thaw suppress firm estimates without pretending to model snowmelt', async () => {
  const route = groundRoute();
  for (const problem of ['snow', 'freezing', 'thaw'] as const) {
    const e = await wetnessEvidence([route], (h) => ({
      ...h,
      snowfallCm:
        problem === 'snow' && Date.parse(h.end) === now - 10 * DAY ? 1 : 0,
      temperatureC:
        (problem === 'freezing' && Date.parse(h.end) === now) ||
        (problem === 'thaw' && Date.parse(h.end) === now - DAY)
          ? -2
          : 10,
    }));
    const result = present(assessGround([route], e, now, 20, now).routes[0]);
    expect(result.coverage.freezeThawUncertainM).toBe(1000);
    expect(present(result.sections[0]).status).toBe('freeze-thaw-uncertain');
    expect(present(result.sections[0]).condition).toBeNull();
  }
});
test('unknown material or omitted cells remain unknown; fully paved routes have no ground exposure', async () => {
  const unknown = groundRoute('unknown');
  const paved = groundRoute('paved');
  const gravel = groundRoute();
  const e = await wetnessEvidence([unknown, paved, gravel]);
  const result = assessGround([unknown, paved, gravel], e, now, 20, now);
  expect(present(result.routes[0]).coverage.unknownM).toBe(1000);
  expect(present(present(result.routes[0]).sections[0]).condition).toBeNull();
  expect(present(result.routes[1]).status).toBe('not-applicable');
  expect(present(result.routes[1]).coverage.exposureM).toBe(0);
  e.cells = [];
  expect(
    present(assessGround([gravel], e, now, 20, now).routes[0]).coverage
      .omittedCellM,
  ).toBe(1000);
  present(gravel.surface).sourceHash = 'outdated';
  expect(
    routeExposure(gravel, false).sections.every((s) => s.surface === 'unknown'),
  ).toBe(true);
  expect(materialFor('sand')).toBe('unresolved');
  expect(materialFor('rough-unpaved')).toBe('unresolved');
});
test('affected distance and longest muddy stretch preserve firm and paved breaks', async () => {
  const route = groundRoute();
  present(route.surface).sections = [
    { fromM: 0, toM: 200, surface: 'earth', sourceCode: 'test' },
    { fromM: 200, toM: 300, surface: 'paved', sourceCode: 'test' },
    { fromM: 300, toM: 700, surface: 'earth', sourceCode: 'test' },
    { fromM: 700, toM: 1000, surface: 'compacted', sourceCode: 'test' },
  ];
  const e = await wetnessEvidence([route], (h) => ({
    ...h,
    rainMm: 0.15,
    referenceEt0Mm: 0.01,
  }));
  const r = present(assessGround([route], e, now, 20, now).routes[0]);
  expect(r.coverage.exposureM).toBe(900);
  expect(r.estimatedDistanceM.muddy).toBe(600);
  expect(r.estimatedDistanceM.soft).toBe(300);
  expect(r.longestEstimatedMuddyStretch).toEqual({
    fromM: 300,
    toM: 700,
    distanceM: 400,
  });
  expect(r.muddyOrDifficultM.lowerScenario).toBeLessThanOrEqual(
    r.muddyOrDifficultM.centralScenario,
  );
  expect(r.muddyOrDifficultM.upperScenario).toBeGreaterThanOrEqual(
    r.muddyOrDifficultM.centralScenario,
  );
});
test('assessment window rejects historical replay and rides finishing beyond available forecasts', () => {
  const route = groundRoute();
  expect(assessmentWindowError([route], now - HOUR, 20, now)).toContain(
    'historical',
  );
  expect(assessmentWindowError([route], now + 7 * DAY, 20, now)).toContain(
    'window',
  );
  expect(assessmentWindowError([route], now + DAY, 20, now)).toBeNull();
});

const present = <T>(value: T | null | undefined): T => {
  assert.ok(value != null);
  return value;
};
