import {
  orderDepartures,
  standardsStatusFor,
} from '../recommendations/engine.ts';
import type { RecommendationInput } from '../recommendations/input.ts';
import { localDate } from '../recommendations/planning.ts';
import type {
  DailyResult,
  RouteResult,
} from '../recommendations/presentation.ts';
import type { Route } from '../routes/model.ts';
import type { Candidate, RouteBest, Snapshot } from './model.ts';
import type { TrackingRow } from './store.ts';

export const exactDepartureInput = (
  input: RecommendationInput,
  departureAt: string,
): RecommendationInput => ({
  ...input,
  date: localDate(new Date(departureAt), input.timeZone).toString(),
  riding: { ...input.riding, window: 'daylight' },
});

/** Both the tile and monitoring compare the route's best scoped slot to the pin. */
export const betterDeparture = <T extends RouteBest['candidate']>(
  pinned: RouteBest['candidate'] | null,
  best: T | null,
  at: string,
) =>
  pinned &&
  best &&
  best.departureAt !== pinned.departureAt &&
  best.departureAt > at &&
  ['meets', 'not_configured'].includes(best.standards.status) &&
  (best.score - pinned.score >= 5 || pinned.standards.status === 'below')
    ? best
    : null;

export type TrackedDeparture = {
  trackedRideId: string;
  departureAt: string;
  finishAt: string;
  status: 'assessed' | 'unavailable';
  reasonCode:
    | 'forecast_unavailable'
    | 'pinned_departure_no_longer_fits'
    | 'route_unavailable'
    | 'missing_elevation'
    | null;
};
type FixedRoute = RouteResult & {
  trackedDeparture?: TrackedDeparture;
  betterDeparture?: Candidate | null;
};
export type FixedEvaluation = Omit<DailyResult, 'rankings' | 'unranked'> & {
  rankings: (FixedRoute & { rank: number })[];
  unranked: FixedRoute[];
};
const missingRoute = (row: TrackingRow): RouteResult => {
  const baseline = JSON.parse(row.baseline_json) as Snapshot;
  const facts = baseline.context.routes.find((r) => r.id === row.route_id);
  return {
    routeId: row.route_id,
    routeName: facts?.name ?? 'Your ride',
    sourceHash: facts?.sourceHash ?? '',
    distanceM: facts?.distanceM ?? 0,
    distanceKm: (facts?.distanceM ?? 0) / 1000,
    distanceFit: null,
    ascentM: facts?.ascentM ?? null,
    ascentMPerKm: null,
    outline: null,
    estimatedDurationMinutes:
      (Date.parse(row.finish_at) - Date.parse(row.departure_at)) / 60_000,
    daylight: null,
    effectiveWindow: null,
    status: 'unassessable',
    departuresTested: 1,
    departuresAssessed: 0,
    departuresUnknown: 1,
    departuresWeatherAssessed: 0,
    departuresStandardsUnknown: 0,
    assessedDepartures: [],
    partialAssessment: null,
    best: null,
    alternatives: [],
    issues: ['route-unavailable'],
    warnings: [],
  };
};

export const pinDeparture = (
  result: DailyResult,
  pinned: DailyResult | null,
  row: TrackingRow | null,
  route: Route | undefined,
  input: RecommendationInput,
  at: string,
): FixedEvaluation => {
  if (!row) return result;
  const scoped = [...result.rankings, ...result.unranked];
  const original = scoped.find((r) => r.routeId === row.route_id);
  const exact = pinned?.rankings[0] ?? pinned?.unranked[0] ?? missingRoute(row);
  const finishAt =
    exact.best?.finishAt ??
    (route
      ? new Date(
          Date.parse(row.departure_at) +
            (route.distanceM / (input.riding.averageSpeedKph / 3.6)) * 1000,
        ).toISOString()
      : row.finish_at);
  const fixed: FixedRoute = {
    ...exact,
    // These remain the request's normal alternatives; only the top-level best is fixed.
    alternatives: original?.alternatives ?? [],
    trackedDeparture: {
      trackedRideId: row.id,
      departureAt: row.departure_at,
      finishAt,
      status: exact.best ? 'assessed' : 'unavailable',
      reasonCode: exact.best
        ? null
        : !route
          ? 'route_unavailable'
          : exact.status === 'no_feasible_departure'
            ? 'pinned_departure_no_longer_fits'
            : exact.issues.includes('missing-elevation')
              ? 'missing_elevation'
              : 'forecast_unavailable',
    },
    betterDeparture: betterDeparture(exact.best, original?.best ?? null, at),
  };
  const evaluated: FixedRoute[] = [
    ...scoped.filter((r) => r.routeId !== row.route_id),
    fixed,
  ];
  const ranked = evaluated
    .filter((r) => r.best)
    .sort((a, b) =>
      a.best && b.best
        ? orderDepartures(a.best, b.best) || a.routeId.localeCompare(b.routeId)
        : 0,
    );
  const minimumStandardsStatus = standardsStatusFor(
    evaluated,
    Object.keys(input.preferences.minimumStandards).length > 0,
  );
  return {
    ...result,
    minimumStandardsStatus,
    recommendedRouteId: ranked[0]?.routeId ?? null,
    message:
      minimumStandardsStatus === 'none_meet'
        ? 'No evaluated route and departure meets your minimum standards. The recommendation is the best available, with its drawbacks.'
        : minimumStandardsStatus === 'unknown'
          ? 'No confirmed match for your minimum standards. Some departures or standards could not be assessed.'
          : ranked.length
            ? 'Routes ranked by their assessed departures, with minimum conditions taking priority.'
            : 'No ride could be recommended for these departures.',
    rankings: ranked.map((r, i) => ({ ...r, rank: i + 1 })),
    unranked: evaluated.filter((r) => !r.best),
  };
};
