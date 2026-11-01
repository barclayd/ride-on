import type { Snapshot } from '../tracking/model.ts';

export const RAIN_WARNING_PROBABILITY = 0.5;

// Reuse the ride's bounded, encounter-time evidence. Missing readings never
// establish a clear forecast or re-arm an alert.
export const alertConditions = (snapshot: Snapshot) => {
  const candidate = snapshot.pick.candidate;
  const hours = (candidate.rideHours ?? []).filter(
    (hour) =>
      hour.start < candidate.finishAt && hour.end > candidate.departureAt,
  );
  let rain: { probability: number; at: string } | null = null;
  for (const hour of hours) {
    const probability = hour.conditions?.maximumPrecipitationProbability;
    if (probability != null && (!rain || probability > rain.probability))
      rain = {
        probability,
        at:
          hour.start < candidate.departureAt
            ? candidate.departureAt
            : hour.start,
      };
  }
  const rainLikely =
    rain && rain.probability >= RAIN_WARNING_PROBABILITY
      ? true
      : hours.length &&
          hours.every(
            (hour) => hour.conditions?.maximumPrecipitationProbability != null,
          )
        ? false
        : null;
  const limitC = (snapshot.context.inputs[0] ?? snapshot.context.pinnedInput)
    ?.preferences.temperature?.comfortMinC;
  const points = candidate.temperatureAlongRide?.points;
  const readings = points?.length
    ? points
        .filter(
          ([minutes]) =>
            minutes >= 0 &&
            minutes <=
              (Date.parse(candidate.finishAt) -
                Date.parse(candidate.departureAt)) /
                60_000,
        )
        .map(([, air, feels]) => feels ?? air)
    : [candidate.conditions?.temperatureC.minimum ?? null];
  const known = readings.filter((value): value is number => value != null);
  const minimumC = known.length ? Math.min(...known) : null;
  const cold =
    limitC != null && minimumC !== null ? { minimumC, limitC } : null;
  const feelsCold =
    cold && cold.minimumC < cold.limitC
      ? true
      : cold && readings.length && readings.every((value) => value != null)
        ? false
        : null;
  return { rain, rainLikely, cold, feelsCold };
};
