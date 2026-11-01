import type { RecommendationInput } from '../recommendations/input.ts';
import type { DailyResult } from '../recommendations/presentation.ts';
import type { evaluateComparisons } from '../recommendations/service.ts';
import type { RouteRecord } from '../routes/store.ts';
import { FINAL_FORECAST_LOCAL_TIME } from './alerts.ts';

export type Evaluation = Awaited<ReturnType<typeof evaluateComparisons>>;
export type Candidate = NonNullable<DailyResult['rankings'][number]['best']>;
export type RouteFacts = ReturnType<typeof routeFacts>;
export const routeFacts = ({ route, version, source }: RouteRecord) => ({
  id: route.id,
  name: route.name,
  version,
  sourceHash: route.sourceHash,
  distanceM: route.distanceM,
  ascentM: route.ascentM,
  source,
  geometryRef: route.geometry ? route.sourceHash : null,
});
export type Pick = { routeId: string; candidate: Candidate };
export type RouteBest = {
  routeId: string;
  candidate: {
    departureAt: string;
    score: number;
    standards: { status: Candidate['standards']['status'] };
  };
};
export type TrackingContext = {
  schemaVersion: 1;
  generatedAt: string;
  algorithmVersion: string;
  inputs: RecommendationInput[];
  /** Exact-departure input when the accepted slot is independent of the search window. */
  pinnedInput?: RecommendationInput;
  routes: RouteFacts[];
  history: Evaluation['history'];
  weather: Omit<Evaluation['weather'], 'cache' | 'attempts'>;
  best: Pick | null;
  /** Compact per-route winners keep better-time references independent of the overall winner. */
  routeBests?: RouteBest[];
  coverageComplete: boolean;
  eligibleDepartures: number;
  assessmentFreshUntil: string | null;
};
export type Snapshot = { context: TrackingContext; pick: Pick };
export const capabilities = {
  alertTriggers: true,
  fixedDeparture: true,
  alertEdits: true,
  finalForecastLocalTime: FINAL_FORECAST_LOCAL_TIME,
  maximumActiveRides: 1,
  manualRefresh: true,
  automaticChecks: false,
  notifications: false,
} as const;
export const digest = async (value: unknown) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(JSON.stringify(value)),
      ),
    ),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('');
export const boundedJson = (value: unknown, maximum = 250_000) => {
  const json = JSON.stringify(value);
  if (new TextEncoder().encode(json).byteLength > maximum)
    throw new Error('Tracking snapshot exceeds its storage bound.');
  return json;
};
export const contextFor = (
  shared: Evaluation,
  inputs: RecommendationInput[],
  records: readonly RouteRecord[],
  generatedAt: string,
  result: DailyResult,
): TrackingContext => {
  const { cache: _cache, attempts: _attempts, ...weather } = shared.weather;
  const first = result.rankings[0];
  return {
    schemaVersion: 1,
    generatedAt,
    algorithmVersion: result.algorithmVersion,
    inputs,
    routes: records.map(routeFacts),
    history: shared.history,
    weather,
    assessmentFreshUntil: weather.refreshAt,
    best: first?.best
      ? { routeId: first.routeId, candidate: { ...first.best, previous: null } }
      : null,
    routeBests: result.rankings.flatMap((r) =>
      r.best
        ? [
            {
              routeId: r.routeId,
              candidate: {
                departureAt: r.best.departureAt,
                score: r.best.score,
                standards: { status: r.best.standards.status },
              },
            },
          ]
        : [],
    ),
    eligibleDepartures: [...result.rankings, ...result.unranked].reduce(
      (n, r) => n + r.departuresTested,
      0,
    ),
    coverageComplete:
      inputs.every((input) => {
        const summary = shared.comparisons.find(
          (c) =>
            c.input.date === input.date &&
            JSON.stringify(c.input.riding.window) ===
              JSON.stringify(input.riding.window),
        )?.summary;
        return (
          summary?.availability === 'full' ||
          summary?.availabilityReason === 'no_remaining_window' ||
          summary?.availabilityReason === 'no_feasible_departure'
        );
      }) && !result.unranked.some((r) => r.status === 'unassessable'),
  };
};
