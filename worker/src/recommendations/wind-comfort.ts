import type { RecommendationInput } from './input.ts';

const clamp = (v: number) => Math.max(0, Math.min(1, v));
// Small breezes remain ideal. A comfort setting marks the end of the gentle
// slope, not a promise of perfect comfort at every speed below that setting.
const approach = (speed: number, ideal: number, comfort: number) => {
  const start = Math.min(ideal, comfort);
  return speed <= start
    ? 0
    : clamp((speed - start) / Math.max(comfort - start, 1));
};

export const windComfort = (
  headwindKph: number,
  crosswindKph: number,
  gustKph: number,
  p: RecommendationInput['preferences']['wind'],
) => {
  const head =
    0.15 * approach(headwindKph, 5, p.comfortableHeadwindKph) +
    0.45 * clamp((headwindKph - p.comfortableHeadwindKph) / 20);
  const cross =
    Math.min(1, p.crosswindSensitivity) *
      0.2 *
      approach(crosswindKph, 5, p.comfortableCrosswindKph) +
    0.35 *
      p.crosswindSensitivity *
      clamp((crosswindKph - p.comfortableCrosswindKph) / 20);
  const gust =
    0.1 * approach(gustKph, 10, p.comfortableGustKph) +
    0.45 * clamp((gustKph - p.comfortableGustKph) / 30);
  return 1 - clamp(head + cross + gust);
};
