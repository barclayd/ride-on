import type { recommendRides } from './engine.ts';

export type DailyResult = ReturnType<typeof recommendRides>;
export type RouteResult = DailyResult['unranked'][number];
export const verdictFor = (route: RouteResult) => {
  const best = route.best;
  if (!best)
    return route.status === 'no_feasible_departure'
      ? {
          status: 'doesnt_fit',
          code: 'no_feasible_departure',
          reason:
            'No future departure fits the full ride inside daylight and your selected window.',
        }
      : route.issues.includes('missing-elevation')
        ? {
            status: 'incomplete',
            code: 'missing_elevation',
            reason:
              'Climbing could not be assessed because elevation data is incomplete.',
          }
        : {
            status: 'incomplete',
            code: 'missing_weather',
            reason:
              'The forecast does not cover every required part of this ride.',
          };
  if (best.standards.status === 'unknown')
    return {
      status: 'incomplete',
      code: 'unresolved_minimums',
      reason: 'Some of your minimum conditions could not be checked.',
    };
  if (best.standards.status === 'below')
    return {
      status: 'below_minimums',
      code: 'minimums_failed',
      reason:
        'This departure falls below one or more of your minimum conditions.',
    };
  return best.standards.status === 'not_configured'
    ? {
        status: 'meets',
        code: 'minimums_not_configured',
        reason:
          'This ride can be assessed; no minimum conditions are configured.',
      }
    : {
        status: 'meets',
        code: 'minimums_met',
        reason: 'This departure meets your configured minimum conditions.',
      };
};
export const presentRoute = (route: RouteResult, stepMinutes: number) => {
  const { assessedDepartures, ...rest } = route;
  const intervals: { firstDepartureAt: string; lastDepartureAt: string }[] = [];
  for (const candidate of [...assessedDepartures].sort((a, b) =>
    a.departureAt.localeCompare(b.departureAt),
  )) {
    const last = intervals.at(-1);
    if (
      last &&
      Date.parse(candidate.departureAt) - Date.parse(last.lastDepartureAt) ===
        stepMinutes * 60_000
    )
      last.lastDepartureAt = candidate.departureAt;
    else
      intervals.push({
        firstDepartureAt: candidate.departureAt,
        lastDepartureAt: candidate.departureAt,
      });
  }
  return {
    ...rest,
    verdict: verdictFor(route),
    coverage: {
      basis: 'feasible_departure_slots',
      assessedFraction: route.departuresTested
        ? route.departuresAssessed / route.departuresTested
        : null,
      tested: route.departuresTested,
      assessed: route.departuresAssessed,
      unknown: route.departuresUnknown,
      intervals,
    },
  };
};
