import { haversineKm } from '../geo.ts';
import type { Route } from '../routes/model.ts';
import type {
  ForecastDescriptor,
  LocationForecastResult,
} from '../weather/contracts.ts';
import { forecastIntervals, intersectIntervals } from '../weather/coverage.ts';
import { planDepartures } from './daylight.ts';
import {
  ALGORITHM_VERSION,
  orderDepartures,
  standardsStatusFor,
} from './engine.ts';
import type { RecommendationInput } from './input.ts';
import type { DailyResult, RouteResult } from './presentation.ts';

export const mergeDays = (
  daily: readonly DailyResult[],
  configured: boolean,
) => {
  const grouped = new Map<string, RouteResult[]>();
  for (const day of daily)
    for (const route of [...day.rankings, ...day.unranked]) {
      const list = grouped.get(route.routeId) ?? [];
      list.push(route);
      grouped.set(route.routeId, list);
    }
  const evaluated = [...grouped.values()].flatMap((variants) => {
    const candidates = variants
      .flatMap((r) => (r.best ? [r.best, ...r.alternatives] : []))
      .sort(orderDepartures);
    const best = candidates[0] ?? null;
    const representative =
      variants.find((r) => best && r.best?.departureAt === best.departureAt) ??
      [...variants]
        .filter((r) => r.partialAssessment)
        .sort(
          (a, b) =>
            (b.partialAssessment?.weatherScore ?? 0) -
              (a.partialAssessment?.weatherScore ?? 0) ||
            (a.partialAssessment?.departureAt ?? '').localeCompare(
              b.partialAssessment?.departureAt ?? '',
            ),
        )[0] ??
      variants.find((r) => r.status === 'unassessable') ??
      variants[0];
    if (!representative) return [];
    const sum = (
      field:
        | 'departuresTested'
        | 'departuresAssessed'
        | 'departuresUnknown'
        | 'departuresStandardsUnknown'
        | 'departuresWeatherAssessed',
    ) => variants.reduce((n, r) => n + r[field], 0);
    return [
      {
        ...representative,
        best,
        alternatives: candidates.slice(1, 4),
        departuresTested: sum('departuresTested'),
        departuresAssessed: sum('departuresAssessed'),
        departuresUnknown: sum('departuresUnknown'),
        departuresStandardsUnknown: sum('departuresStandardsUnknown'),
        departuresWeatherAssessed: sum('departuresWeatherAssessed'),
        assessedDepartures: variants.flatMap((r) => r.assessedDepartures),
        issues: [...new Set(variants.flatMap((r) => r.issues))],
        warnings: [...new Set(variants.flatMap((r) => r.warnings))],
      },
    ];
  });
  const ranked = evaluated
    .filter((r) => r.best !== null)
    .sort((a, b) =>
      a.best && b.best
        ? orderDepartures(a.best, b.best) || a.routeId.localeCompare(b.routeId)
        : 0,
    );
  const status = standardsStatusFor(evaluated, configured);
  return {
    algorithmVersion: ALGORITHM_VERSION,
    minimumStandardsStatus: status,
    recommendedRouteId: ranked[0]?.routeId ?? null,
    message:
      status === 'none_meet'
        ? 'No evaluated route and departure meets your minimum standards. The recommendation is the best available, with its drawbacks.'
        : status === 'unknown'
          ? 'No confirmed match for your minimum standards. Some departures or standards could not be assessed.'
          : ranked.length
            ? 'Routes ranked across the selected dates, with minimum conditions taking priority.'
            : 'No ride could be recommended for the selected dates.',
    rankings: ranked.map((route, index) => ({ ...route, rank: index + 1 })),
    unranked: evaluated.filter((r) => !r.best),
  };
};

/** Coverage concerns all required evidence throughout each route's effective window,
 * independent of the score, route length and whether climbing is known. */
export const daySummary = (
  routes: readonly Route[],
  input: RecommendationInput,
  result: DailyResult,
  forecasts: readonly LocationForecastResult[],
  required: readonly ForecastDescriptor[],
  nowMs: number,
  maxLocationDistanceM = 10_000,
) => {
  const byId = new Map(
    forecasts.map((r) => [
      r.status === 'unavailable' ? r.requested.id : r.location.requested.id,
      r,
    ]),
  );
  const evidence = new Map(
    [...byId].map(([id, r]) => [id, forecastIntervals(r, required)]),
  );
  const windows = routes.map((route) => {
    const plan = planDepartures(route, input, nowMs);
    let intervals = plan.effectiveWindow ? [plan.effectiveWindow] : [];
    for (const location of route.weatherLocations)
      intervals = intersectIntervals(
        intervals,
        evidence.get(location.id) ?? [],
      );
    if (
      route.legs.some((leg) => {
        const forecast = byId.get(leg.weatherLocationId);
        return (
          !forecast ||
          forecast.status === 'unavailable' ||
          haversineKm(
            [leg.coordinate.latitude, leg.coordinate.longitude],
            [
              forecast.location.coordinate.latitude,
              forecast.location.coordinate.longitude,
            ],
          ) *
            1000 >
            maxLocationDistanceM
        );
      })
    )
      intervals = [];
    const duration = plan.effectiveWindow
      ? plan.effectiveWindow.end - plan.effectiveWindow.start
      : 0;
    const covered = intervals.reduce((n, i) => n + i.end - i.start, 0);
    return {
      routeId: route.id,
      ...plan,
      intervals,
      full: duration > 0 && covered === duration,
    };
  });
  const relevant = windows.filter(
    (w) => w.effectiveWindow && w.departures.length > 0,
  );
  const any = relevant.some((w) => w.intervals.length);
  const full = relevant.length > 0 && relevant.every((w) => w.full);
  const lastEvidence = Math.max(
    -Infinity,
    ...[...evidence.values()].flat().map((i) => i.end),
  );
  const firstNeeded = Math.min(
    Infinity,
    ...relevant.map((w) => w.effectiveWindow?.start ?? Infinity),
  );
  const best = result.rankings[0]?.best ?? null;
  const daylightStart = Math.max(
    -Infinity,
    ...windows.map((w) => w.daylight?.start ?? Infinity),
  );
  const daylightEnd = Math.min(
    Infinity,
    ...windows.map((w) => w.daylight?.end ?? -Infinity),
  );
  const reason = full
    ? 'available'
    : any
      ? 'partial_coverage'
      : !relevant.length
        ? windows.some((w) => w.effectiveWindow)
          ? 'no_feasible_departure'
          : 'no_remaining_window'
        : !forecasts.length
          ? 'not_evaluated'
          : forecasts.every((r) => r.status === 'unavailable')
            ? 'provider_unavailable'
            : Number.isFinite(lastEvidence) && lastEvidence <= firstNeeded
              ? 'outside_forecast_horizon'
              : 'missing_data';
  // A cutoff is meaningful only for a contiguous covered prefix for every route.
  const prefixes = relevant.filter(
    (w) =>
      w.intervals.length === 1 &&
      w.intervals[0]?.start === w.effectiveWindow?.start,
  );
  const until =
    !full && any && prefixes.length === relevant.length
      ? new Date(
          Math.min(...prefixes.map((w) => w.intervals[0]?.end ?? Infinity)),
        ).toISOString()
      : null;
  return {
    date: input.date,
    availability: full ? 'full' : any ? 'partial' : 'none',
    availabilityReason: reason,
    availabilityBasis: 'required_windows_for_feasible_routes',
    until,
    daylight:
      daylightStart < daylightEnd
        ? {
            sunrise: new Date(daylightStart).toISOString(),
            sunset: new Date(daylightEnd).toISOString(),
          }
        : null,
    temperatureMaxC: best?.conditions.temperatureC.maximum ?? null,
    quality: best?.score ?? null,
    recommendedRouteId: result.recommendedRouteId,
    minimumStandardsStatus: result.minimumStandardsStatus,
    coverage: windows.map((w) => ({
      routeId: w.routeId,
      intervals: w.intervals.map((i) => ({
        start: new Date(i.start).toISOString(),
        end: new Date(i.end).toISOString(),
      })),
    })),
  };
};
