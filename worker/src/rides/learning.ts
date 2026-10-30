import { z } from 'zod';
import type { Experience } from './experience.ts';

export const LEARNING_VERSION = 'ride-comfort-shadow-v1';
export const factorNames = ['cold', 'heat', 'wind', 'rain', 'shade'] as const;
export const featuresSchema = z.object({
  cold: z.number().min(0).max(1),
  heat: z.number().min(0).max(1),
  wind: z.number().min(0).max(1),
  rain: z.number().min(0).max(1),
  shade: z.number().min(0).max(1),
});
export type Features = z.infer<typeof featuresSchema>;
export type LearningExample = {
  experience: Experience;
  features: Features;
  quality: number;
  baseline?: number;
};
const clamp = (v: number, min = 0, max = 1) => Math.max(min, Math.min(max, v));
/** Fixed population prior for the pilot. This is retrospective comfort, not the
 * live forecast scorer: realised rain is never a precipitation probability. */
export const baselineComfort = (x: Features) =>
  clamp(1 - 0.3 * Math.max(x.cold, x.heat) - 0.2 * x.wind - 0.5 * x.rain);
const eligible = (e: LearningExample) =>
  e.experience.feedback?.includeInLearning &&
  e.experience.feedback.weatherComfort !== null &&
  e.experience.timing?.routeFollowed === 'yes' &&
  e.quality > 0;
/** Regularised residual regression. Zero-centred prior shrinks each rider back
 * to the fixed baseline. Refit from current evidence so edits/undo are exact. */
export const learnComfort = (examples: LearningExample[]) => {
  const rows = examples.filter(eligible);
  const matrix: number[][] = Array.from({ length: 6 }, (_, i) =>
    Array.from({ length: 7 }, (_, j) => (i === j ? 12 : 0)),
  );
  const support = factorNames.map(() => ({
    count: 0,
    weight: 0,
    min: 1,
    max: 0,
  }));
  for (const row of rows) {
    const feedback = row.experience.feedback;
    if (!feedback || feedback.weatherComfort === null) continue;
    const confounded = feedback.reasons.some(
      (r) =>
        r.impact === 'negative' &&
        ['tiredness', 'mechanical', 'traffic'].includes(r.factor),
    );
    const weight =
      row.quality *
      (row.experience.timing?.precision === 'approximate' ? 0.5 : 1) *
      (confounded ? 0.25 : 1);
    const x = [1, ...factorNames.map((k) => row.features[k])];
    const residual =
      (feedback.weatherComfort - 1) / 4 -
      (row.baseline ?? baselineComfort(row.features));
    for (let i = 0; i < 6; i++) {
      const m = matrix[i];
      if (!m) continue;
      for (let j = 0; j < 6; j++)
        m[j] = (m[j] ?? 0) + weight * (x[i] ?? 0) * (x[j] ?? 0);
      m[6] = (m[6] ?? 0) + weight * (x[i] ?? 0) * residual;
    }
    factorNames.forEach((key, i) => {
      const s = support[i];
      if (!s) return;
      s.min = Math.min(s.min, row.features[key]);
      s.max = Math.max(s.max, row.features[key]);
      if (row.features[key] >= 0.1) {
        s.count++;
        s.weight += weight;
      }
    });
  }
  // Ridge makes the matrix positive definite, including empty/collinear data.
  for (let i = 0; i < 6; i++) {
    const pivot = matrix[i];
    if (!pivot) continue;
    const divisor = pivot[i] ?? 1;
    for (let j = i; j <= 6; j++) pivot[j] = (pivot[j] ?? 0) / divisor;
    for (let k = 0; k < 6; k++) {
      const row = matrix[k];
      if (k === i || !row) continue;
      const scale = row[i] ?? 0;
      for (let j = i; j <= 6; j++)
        row[j] = (row[j] ?? 0) - scale * (pivot[j] ?? 0);
    }
  }
  const factors = factorNames.map((factor, i) => {
    const s = support[i] ?? { count: 0, weight: 0, min: 1, max: 0 };
    const enough = s.count >= 5 && s.max - s.min >= 0.2;
    const confidence = enough ? Math.min(0.75, s.weight / (s.weight + 20)) : 0;
    return {
      factor,
      evidenceCount: s.count,
      confidence,
      adjustmentPoints: enough
        ? clamp((matrix[i + 1]?.[6] ?? 0) * 100, -10, 10) * confidence
        : 0,
    };
  });
  return {
    modelVersion: LEARNING_VERSION,
    mode: 'shadow' as const,
    scoringApplied: false as const,
    eligibleRideCount: rows.length,
    factors,
  };
};
export const shadowScore = (
  features: Features,
  profile: ReturnType<typeof learnComfort>,
  baseline = baselineComfort(features),
) => ({
  baseline: baseline * 100,
  personalised: clamp(
    baseline * 100 +
      clamp(
        profile.factors.reduce(
          (sum, f) => sum + features[f.factor] * f.adjustmentPoints,
          0,
        ),
        -10,
        10,
      ),
    0,
    100,
  ),
});

/** Held-out labels in chronological order. Reconstructed weather means this
 * is not a replay of forecasts available at the original decision time. */
export const evaluateLearning = (orderedExamples: LearningExample[]) => {
  const examples = orderedExamples.filter(eligible);
  let baselineError = 0;
  let personalisedError = 0;
  let count = 0;
  for (let i = 5; i < examples.length; i++) {
    const row = examples[i];
    if (!row || row.experience.feedback?.weatherComfort == null) continue;
    const prediction = shadowScore(
      row.features,
      learnComfort(examples.slice(0, i)),
      row.baseline,
    );
    const target = (row.experience.feedback.weatherComfort - 1) * 25;
    baselineError += Math.abs(prediction.baseline - target);
    personalisedError += Math.abs(prediction.personalised - target);
    count++;
  }
  return {
    kind: 'retrospective-walk-forward' as const,
    prospectiveForecastValidation: false,
    evaluatedRideCount: count,
    baselineMeanAbsoluteError: count ? baselineError / count : null,
    personalisedMeanAbsoluteError: count ? personalisedError / count : null,
  };
};
