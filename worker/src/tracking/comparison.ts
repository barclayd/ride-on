import { orderDepartures } from '../recommendations/engine.ts';
import type { Snapshot } from './model.ts';

const equal = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
export const compareTracking = (baseline: Snapshot, latest: Snapshot) => {
  const before = baseline.pick.candidate;
  const after = latest.pick.candidate;
  const delta = Math.round((after.score - before.score) * 1000) / 1000;
  const original = baseline.context.best;
  const searched = latest.context.best;
  const best =
    searched &&
    (orderDepartures(searched.candidate, after) ||
      searched.routeId.localeCompare(latest.pick.routeId)) < 0
      ? searched
      : latest.pick;
  const complete = latest.context.coverageComplete;
  const differentRoute = best.routeId !== latest.pick.routeId;
  const differentDeparture =
    differentRoute || best.candidate.departureAt !== after.departureAt;
  const routeStillRecommended = differentRoute ? false : complete ? true : null;
  const departureStillRecommended = differentDeparture
    ? false
    : complete
      ? true
      : null;
  const originallyRecommendedRoute =
    original?.routeId === baseline.pick.routeId;
  const contextChanges: string[] = [];
  const oldInput = baseline.context.inputs[0];
  const newInput = latest.context.inputs[0];
  if (
    !equal(oldInput?.preferences, newInput?.preferences) ||
    !equal(oldInput?.riding, newInput?.riding) ||
    !equal(oldInput?.weather, newInput?.weather) ||
    !equal(oldInput?.forecast, newInput?.forecast)
  )
    contextChanges.push('settings');
  if (!equal(baseline.context.routes, latest.context.routes))
    contextChanges.push('routes');
  if (baseline.context.algorithmVersion !== latest.context.algorithmVersion)
    contextChanges.push('algorithm');
  if (!equal(baseline.context.history, latest.context.history))
    contextChanges.push('history');
  if (
    !equal(
      baseline.context.weather.selectedSource,
      latest.context.weather.selectedSource,
    )
  )
    contextChanges.push('weather_source');
  if (
    !equal(baseline.context.weather.locations, latest.context.weather.locations)
  )
    contextChanges.push('forecast_evidence');
  if (baseline.context.eligibleDepartures !== latest.context.eligibleDepartures)
    contextChanges.push('comparison_options');
  const units: Record<string, string> = {
    minimumTemperatureC: 'C',
    maximumTemperatureC: 'C',
    maximumGustKph: 'km/h',
    maximumPrecipitationProbability: 'fraction',
    maximumPrecipitationRateMmH: 'mm/h',
  };
  const failures = after.standards.failures.map((f) => ({
    ...f,
    unit: units[f.standard] ?? null,
  }));
  return {
    scoreDeltaFromBaseline: delta,
    significantScoreChange: Math.abs(delta) >= 5,
    standards: {
      status: after.standards.status,
      failures,
      newlyFailing: failures.filter(
        (f) =>
          !before.standards.failures.some((old) => old.standard === f.standard),
      ),
    },
    bestPick: {
      coverage: complete ? 'complete' : 'incomplete',
      originallyRecommendedRoute,
      routeStillRecommended,
      departureStillRecommended,
      lostOriginalBestPick: originallyRecommendedRoute
        ? routeStillRecommended === null
          ? null
          : !routeStillRecommended
        : false,
      bestKnown: {
        routeId: best.routeId,
        departureAt: best.candidate.departureAt,
        score: best.candidate.score,
        recommendationPriority: best.candidate.recommendationPriority,
      },
    },
    contextChanges,
  };
};
