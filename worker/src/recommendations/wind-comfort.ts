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

export const windExposure = (
  headwindKph: number,
  crosswindKph: number,
  gustKph: number,
  p: RecommendationInput['preferences']['wind'],
) => {
  const speed = Math.hypot(headwindKph, crosswindKph);
  // Gust direction is not supplied. Project its magnitude using the prevailing
  // wind as an explicit estimate. With no directional signal, retain the full
  // gust magnitude instead of inferring a helpful gust from calm conditions.
  const adverseGustKph =
    gustKph *
    (speed > 0
      ? Math.hypot(Math.max(0, headwindKph), crosswindKph) / speed
      : 1);
  const head =
    0.15 * approach(headwindKph, 5, p.comfortableHeadwindKph) +
    0.45 * clamp((headwindKph - p.comfortableHeadwindKph) / 20);
  const cross =
    Math.min(1, p.crosswindSensitivity) *
      0.15 *
      approach(crosswindKph, 5, p.comfortableCrosswindKph) +
    0.35 *
      p.crosswindSensitivity *
      // Build excess discomfort progressively: a wind just above comfort
      // should have a small effect; a large exceedance still matters strongly.
      clamp((crosswindKph - p.comfortableCrosswindKph) / 20) ** 1.5;
  const gust =
    0.08 * approach(adverseGustKph, 10, p.comfortableGustKph) +
    0.3 * clamp((adverseGustKph - p.comfortableGustKph) / 40);
  return {
    comfort: 1 - clamp(head + cross + gust),
    adverseGustKph,
    // Only sustained assistance earns a benefit. Subtract lateral wind before
    // ramping from a light breeze (5 km/h) to useful assistance (13 km/h,
    // about 8 mph). The interviewed 8–11 mph range is a plateau, so stronger
    // afternoon winds cannot keep buying back lost sunshine or higher rain risk.
    assistance: clamp((-headwindKph - crosswindKph - 5) / 8),
  };
};

export const windComfort = (
  headwindKph: number,
  crosswindKph: number,
  gustKph: number,
  p: RecommendationInput['preferences']['wind'],
) => windExposure(headwindKph, crosswindKph, gustKph, p).comfort;

/** At most 10% of the wind weight. Use strength-weighted coverage rather than
 * a count of sections over a threshold: a tiny change in a weak breeze must not
 * suddenly unlock a full-route bonus. Substantial opposing exposure still wins. */
export const windAssistanceBenefit = (meanAssistance: number) =>
  0.1 * meanAssistance * clamp(2 * meanAssistance - 1);
