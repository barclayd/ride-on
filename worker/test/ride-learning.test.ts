import { expect, test } from 'bun:test';
import {
  experienceInputSchema,
  experienceSchema,
  resolveExperience,
} from '../src/rides/experience.ts';
import {
  baselineComfort,
  evaluateLearning,
  type LearningExample,
  learnComfort,
  shadowScore,
} from '../src/rides/learning.ts';

const example = (wind: number, rating = 2): LearningExample => ({
  features: { cold: 0, heat: 0, wind, rain: 0, shade: 0 },
  quality: 0.6,
  experience: experienceSchema.parse({
    timing: {
      startTime: '09:00',
      startedAt: '2026-10-01T08:00:00.000Z',
      finishedAt: '2026-10-01T10:00:00.000Z',
      durationMinutes: 120,
      precision: 'confirmed',
      routeFollowed: 'yes',
    },
    feedback: {
      enjoyment: 5,
      weatherComfort: rating,
      reasons: [{ factor: 'wind', impact: 'negative' }],
      includeInLearning: true,
    },
    firstSubmittedAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
  }),
});
test('timing is explicit, local-zone aware and rejects future finishes and DST ambiguity', () => {
  const input = experienceInputSchema.parse({
    expectedVersion: 0,
    expectedRideVersion: 1,
    feedback: null,
    timing: {
      startTime: '09:00',
      durationMinutes: 120,
      precision: 'approximate',
      routeFollowed: 'yes',
    },
  });
  const ride = { ridden_on: '2026-10-01', time_zone: 'Europe/London' };
  expect(
    resolveExperience(input, ride, new Date('2026-10-02'), null).timing
      ?.startedAt,
  ).toBe('2026-10-01T08:00:00.000Z');
  expect(() =>
    resolveExperience(input, ride, new Date('2026-10-01T08:30Z'), null),
  ).toThrow('finishes in the past');
  const ambiguous = {
    ...input,
    timing: {
      ...input.timing,
      startTime: '01:30',
      durationMinutes: 30,
      precision: 'approximate' as const,
      routeFollowed: 'yes' as const,
    },
  };
  expect(() =>
    resolveExperience(
      ambiguous,
      { ...ride, ridden_on: '2026-10-25' },
      new Date('2026-10-26'),
      null,
    ),
  ).toThrow('unambiguous');
  expect(
    resolveExperience(
      { ...input, timing: null },
      ride,
      new Date('2026-10-02'),
      null,
    ).timing,
  ).toBeNull();
});
test('learning stays at the prior for sparse, unvaried, missing, excluded or unconfirmed evidence', () => {
  for (const rows of [
    [],
    [example(0.9)],
    Array.from({ length: 30 }, () => example(0.9)),
  ]) {
    const profile = learnComfort(rows);
    expect(profile.scoringApplied).toBe(false);
    expect(profile.factors.every((f) => f.adjustmentPoints === 0)).toBe(true);
  }
  const excluded = example(1);
  if (excluded.experience.feedback)
    excluded.experience.feedback.includeInLearning = false;
  const missing = example(1);
  missing.quality = 0;
  const partial = example(1);
  if (partial.experience.timing)
    partial.experience.timing.routeFollowed = 'partly';
  expect(learnComfort([excluded, missing, partial]).eligibleRideCount).toBe(0);
});
test('varied windy feedback learns a bounded wind correction without inventing rain tolerance', () => {
  const rows = Array.from({ length: 40 }, (_, i) =>
    example(i % 2 ? 1 : 0, i % 2 ? 1 : 5),
  );
  const profile = learnComfort(rows);
  expect(
    profile.factors.find((f) => f.factor === 'wind')?.adjustmentPoints,
  ).toBeLessThan(0);
  expect(profile.factors.find((f) => f.factor === 'rain')?.confidence).toBe(0);
  const x = example(1).features;
  const score = shadowScore(x, profile);
  expect(score.personalised).toBeLessThan(score.baseline);
  expect(score.personalised).toBeGreaterThanOrEqual(score.baseline - 10);
  expect(score.baseline).toBe(baselineComfort(x) * 100);
  expect(
    learnComfort(rows.slice(0, 4)).factors.every(
      (f) => f.adjustmentPoints === 0,
    ),
  ).toBe(true);
});
test('overall enjoyment is not substituted for weather comfort; uncertainty reduces influence', () => {
  const rows = Array.from({ length: 30 }, (_, i) =>
    example(i % 2, i % 2 ? 1 : 5),
  );
  const changedEnjoyment = structuredClone(rows);
  for (const row of changedEnjoyment)
    if (row.experience.feedback) row.experience.feedback.enjoyment = 1;
  expect(learnComfort(rows)).toEqual(learnComfort(changedEnjoyment));
  const uncertain = structuredClone(rows);
  for (const row of uncertain)
    if (row.experience.timing) row.experience.timing.precision = 'approximate';
  expect(
    Math.abs(learnComfort(uncertain).factors[2]?.adjustmentPoints ?? 0),
  ).toBeLessThan(
    Math.abs(learnComfort(rows).factors[2]?.adjustmentPoints ?? 0),
  );
  const evaluation = evaluateLearning(rows);
  expect(evaluation.evaluatedRideCount).toBe(25);
  expect(evaluation.prospectiveForecastValidation).toBe(false);
  expect(evaluation.personalisedMeanAbsoluteError).toBeLessThan(
    evaluation.baselineMeanAbsoluteError ?? 0,
  );
});
