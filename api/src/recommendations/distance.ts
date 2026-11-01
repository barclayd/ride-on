import type { Preferences } from './input.ts';

export const DISTANCE_SHARE = 0.1;

/** Versioned soft preference: flat inside the range, tapering outside each bound. */
export const assessDistance = (
  distanceM: number,
  range: Preferences['distance'],
) => {
  if (range === null) return { comfort: null, fit: null };
  const km = distanceM / 1000;
  if (km < range.minKm)
    return {
      comfort: km / range.minKm,
      fit: { status: 'below_range' as const, deviationKm: range.minKm - km },
    };
  if (km > range.maxKm)
    return {
      comfort: Math.max(0, 1 - (km - range.maxKm) / range.maxKm),
      fit: { status: 'above_range' as const, deviationKm: km - range.maxKm },
    };
  return {
    comfort: 1,
    fit: { status: 'within_range' as const, deviationKm: 0 },
  };
};
