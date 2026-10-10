import type { Route } from '../routes/model.ts';
import type { Preferences } from './input.ts';

/** Versioned calibration choices, not a measure of gradient or rider effort. */
export const CLIMBING_SHARE = 0.1;
const HILLY_ASCENT_M_PER_KM = 20;

export const assessClimbing = (
  route: Pick<Route, 'ascentM' | 'distanceM'>,
  preference: Preferences['climbing']['preference'],
) => {
  const ascentMPerKm =
    route.ascentM === null ? null : route.ascentM / (route.distanceM / 1000);
  if (preference === 'neutral')
    return { status: 'not_applied' as const, ascentMPerKm, comfort: null };
  if (ascentMPerKm === null)
    return { status: 'unknown' as const, ascentMPerKm, comfort: null };
  const hilliness = Math.min(1, ascentMPerKm / HILLY_ASCENT_M_PER_KM);
  return {
    status: 'assessed' as const,
    ascentMPerKm,
    comfort: preference === 'hillier' ? hilliness : 1 - hilliness,
  };
};
