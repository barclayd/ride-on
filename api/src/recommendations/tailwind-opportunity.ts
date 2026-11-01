import type { Route } from '../routes/model.ts';
import type { Preferences } from './input.ts';

const clamp = (n: number) => Math.max(0, Math.min(1, n));
const round = (n: number) => Math.round(n * 100) / 100;

/** Net progress from the same distance-weighted bearings used for wind exposure.
 * Closed loops / out-and-backs cancel; a winding one-way route need not be straight.
 * The 0.2 dead band tolerates residuals from simplified route legs. */
export const routeDirectionality = (route: Route) => {
  let north = 0;
  let east = 0;
  for (const leg of route.legs) {
    const distance = leg.toM - leg.fromM;
    const radians = (leg.bearingDegrees * Math.PI) / 180;
    north += distance * Math.cos(radians);
    east += distance * Math.sin(radians);
  }
  return clamp((Math.hypot(north, east) / route.distanceM - 0.2) / 0.3);
};

type Exposure = {
  distanceM: number;
  headwindKph: number;
  assistance: number;
};

/** A personal opportunity preference, never weather comfort or historical rarity.
 * Smooth strength-weighted shares avoid granting a large bonus when a weak breeze
 * crosses a binary threshold. Sustained winds earn credit; gust peaks never do. */
export const assessTailwindOpportunity = (
  directionality: number,
  rows: readonly Exposure[],
  wind: Preferences['wind'],
) => {
  const distance = rows.reduce((sum, row) => sum + row.distanceM, 0);
  const mean = (value: (row: Exposure) => number) =>
    distance > 0
      ? rows.reduce((sum, row) => sum + row.distanceM * value(row), 0) /
        distance
      : 0;
  // Useful forward wind ramps from 5 to 8 km/h. A majority must benefit;
  // the consistency multiplier grows smoothly from 50% to 60% effective coverage.
  const alignment = mean((row) => clamp((row.assistance * 8) / 3));
  const opposition = mean((row) => clamp((row.headwindKph - 5) / 8));
  const consistency = clamp((alignment - 0.5) / 0.1);
  // Tolerate a brief opposing section, then taper away by 30% strong headwind.
  const opposingLimit = clamp((0.3 - opposition) / 0.2);
  const enabled = wind.preferTailwind && wind.prioritiseTailwindOpportunities;
  const points = enabled
    ? round(5 * directionality * alignment * consistency * opposingLimit)
    : 0;
  return {
    enabled,
    maximumPoints: 5,
    priorityPoints: points,
    basis: 'route-leg-bearings-and-sustained-wind' as const,
    routeDirectionality: round(directionality),
    alignment: round(alignment),
    opposingExposure: round(opposition),
    reason: points > 0 ? 'Favourable tailwind opportunity.' : null,
  };
};
