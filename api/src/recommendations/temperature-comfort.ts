import type { Preferences } from './input.ts';

const clamp = (value: number) => Math.max(0, Math.min(1, value));

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
  const hotLoss = clamp((valueC - preferences.comfortMaxC) / 10);
  const high = preferences.coldSensitivity === 'high';
  const proportionalLoss = clamp(deficitC / 10);
  const coldPenalty = high
    ? proportionalLoss + 0.8 * (1 - Math.exp(-deficitC / 1.2))
    : 0;
  const coldLoss = high ? coldPenalty / 1.8 : proportionalLoss;
  return {
    comfort: 1 - Math.max(coldLoss, hotLoss),
    // High sensitivity uses proportional cold exposure, separately from the
    // existing worst-section blend. Never count the same cold loss twice.
    blendComfort: 1 - (high ? hotLoss : Math.max(coldLoss, hotLoss)),
    coldPenalty,
    effectiveMinimumC,
    adjustmentC,
  };
};
