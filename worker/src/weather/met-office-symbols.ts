import { skyConditions as sky } from './conditions.ts';
import { precipitationTypes as precipitation } from './precipitation.ts';

/** DataHub weather codes; trace rain is kept wet even below the rate threshold. */
export const metOfficePrecipitationType = (code: number): number | null => {
  if (!Number.isInteger(code)) return null;
  if (code === -1 || code === 12) return precipitation.light_rain;
  if (code === 9 || code === 10) return precipitation.light_showers;
  if (code === 11) return precipitation.drizzle;
  if (code === 13 || code === 14) return precipitation.heavy_showers;
  if (code === 15) return precipitation.heavy_rain;
  if (code >= 16 && code <= 18) return precipitation.sleet;
  if (code >= 19 && code <= 21) return precipitation.hail;
  if (code >= 22 && code <= 27) return precipitation.snow;
  if (code >= 28 && code <= 30) return precipitation.thunder;
  return null;
};

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
