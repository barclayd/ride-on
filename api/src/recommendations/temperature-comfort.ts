import type { Preferences } from './input.ts';

const clamp = (value: number) => Math.max(0, Math.min(1, value));

// Preserve the 10°C linear scale, then accelerate as the distance from the
// preferred midpoint grows beyond 10°C. Subtract the boundary's squared term
// so even wide and zero-width ranges join continuously at full comfort.
// These scales calibrate preference strength; they are not safety thresholds.
const outsideRangeLoss = (outsideC: number, halfRangeC: number) =>
  outsideC / 10 +
  (Math.max(0, halfRangeC + outsideC - 10) ** 2 -
    Math.max(0, halfRangeC - 10) ** 2) /
    20 ** 2;

/** Conservative product screening, not WBGT or a medical risk estimate.
 * Air temperature alone cannot establish safe conditions. See the evidence and
 * calibration decisions in docs/cycling-comfort-evidence.md. */
export const heatScoreCeiling = (maximumC: number) =>
  100 / (1 + (Math.max(0, maximumC - 35) / 5) ** 2);

/** Seasonal tolerance changes only the cold side. The saved ideal band and hard
 * minimum standards remain unchanged. Constants are preference calibration,
 * not a physiological model or a claim that daytime normals predict dawn. */
export const temperatureComfort = (
  valueC: number,
  preferences: Preferences['temperature'],
  normalMaximumC: number | null,
) => {
  const adjustmentC =
    preferences.seasonalTolerance === 'cooler-winters' &&
    normalMaximumC !== null
      ? Math.min(
          6,
          Math.max(0, (preferences.comfortMinC - normalMaximumC) * 0.5),
        )
      : 0;
  const effectiveMinimumC = preferences.comfortMinC - adjustmentC;
  const deficitC = Math.max(0, effectiveMinimumC - valueC);
  const midpointC = (preferences.comfortMinC + preferences.comfortMaxC) / 2;
  const halfRangeC = preferences.comfortMaxC - midpointC;
  const coldBaseLoss = outsideRangeLoss(deficitC, halfRangeC);
  const hotLoss = outsideRangeLoss(
    Math.max(0, valueC - preferences.comfortMaxC),
    halfRangeC,
  );
  const high = preferences.coldSensitivity === 'high';
  const coldPenalty = high
    ? coldBaseLoss + 0.8 * (1 - Math.exp(-deficitC / 1.2))
    : 0;
  const coldLoss = high ? coldPenalty / 1.8 : coldBaseLoss;
  return {
    comfort: clamp(1 - Math.max(coldLoss, hotLoss)),
    // High sensitivity uses proportional cold exposure, separately from the
    // existing worst-section blend. Only the displayed comfort is bounded:
    // a negative blend must keep reducing the overall score in extreme weather.
    blendComfort: 1 - (high ? hotLoss : Math.max(coldLoss, hotLoss)),
    coldPenalty,
    effectiveMinimumC,
    adjustmentC,
  };
};
