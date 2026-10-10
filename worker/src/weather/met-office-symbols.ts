import { skyConditions as sky } from './conditions.ts';

/** Verified against DataHub significant-weather definitions; unmapped codes stay unknown. */
export const metOfficeSkyCondition = (code: number): number | null => {
  if (!Number.isInteger(code)) return null;
  if (code === -1) return sky.precipitation;
  if (code === 0) return sky.clearNight;
  if (code === 1) return sky.sunny;
  if (code === 2) return sky.partlyCloudyNight;
  if (code === 3) return sky.sunnyIntervals;
  if (code === 5 || code === 6) return sky.obscured;
  if (code === 7) return sky.cloudy;
  if (code === 8) return sky.overcast;
  if (code >= 9 && code <= 30) return sky.precipitation;
  return null;
};
