import { Temporal } from '@js-temporal/polyfill';
import { AppError } from '../errors.ts';
import { prepareHistory } from '../rides/overlap.ts';
import { readHistory } from '../rides/store.ts';
import type { Route } from '../routes/model.ts';
import { routeOutline } from '../routes/outline.ts';
import type { Env } from '../types.ts';
import {
  FORECAST_RETENTION_SECONDS,
  type ForecastCache,
  forecastStaleAt,
  isFreshForecast,
  withForecastCache,
} from '../weather/cache.ts';
import {
  quotaFallbackProviderId,
  weatherProviderChoices,
  weatherProviderForSource,
  weatherProviderIdForPolicy,
} from '../weather/choices.ts';
import type {
  ForecastProvider,
  ForecastRequest,
} from '../weather/contracts.ts';
import { summarizeProvenance } from '../weather/coverage.ts';
import {
  createWeatherProviders,
  forecastHorizonHours,
} from '../weather/providers.ts';
import { getForecastForPolicy, rateLimited } from '../weather/source-policy.ts';
import { planDepartures } from './daylight.ts';
import { recommendRides, requiredWeatherFor } from './engine.ts';
import { forecastRefreshSeconds } from './freshness.ts';
import type { RecommendationInput } from './input.ts';
import { daySummary } from './multi-day.ts';
import {
  attachPreviousScores,
  createScoreBaselineStore,
  type ScoreBaselineStore,
} from './score-baselines.ts';

const HOUR = 3_600_000;
const quality = {
  maxTimeStepSeconds: 3600,
  maxLocationDistanceM: 10_000,
  maxAgeSeconds: 6 * 3600,
};
export type ComparisonContext = {
  env: Env;
  ownerId: string;
  signal: AbortSignal;
  now: () => Date;
  startedAt: Date;
  /** Preview dates reuse evidence without forcing a refresh for an unselected day. */
  refreshDates?: readonly string[];
  pinned?: { routeId: string; departureAt: string; input: RecommendationInput };
  dependencies: {
    scoreBaselines?: ScoreBaselineStore;
    cache?: ForecastCache;
    providers?: Readonly<Record<string, ForecastProvider>>;
  };
};
type ForecastSettings = Pick<RecommendationInput, 'weather' | 'forecast'>;
/** One history snapshot and one provider selection for a bounded set of date/window
 * comparisons. Callers supply identical settings apart from their dates and windows. */
export const evaluateComparisons = async (
  routes: readonly Route[],
  inputs: readonly RecommendationInput[],
  input: RecommendationInput,
  {
    env,
    ownerId,
    signal,
    now,
    startedAt,
    refreshDates = inputs.map((i) => i.date),
    dependencies,
    pinned,
  }: ComparisonContext,
) => {
  const refreshAfterSeconds = forecastRefreshSeconds(
    pinned ? [...refreshDates, pinned.input.date] : refreshDates,
    startedAt,
    input.timeZone,
  );
  const qualityFor = (forecast: RecommendationInput['forecast']) => ({
    ...quality,
    maxAgeSeconds:
      forecast.freshnessBasis === 'retrieval-time'
        ? refreshAfterSeconds
        : quality.maxAgeSeconds,
  });
  const plans = inputs.flatMap((dayInput) =>
    routes.map((route) => ({
      route,
      plan: planDepartures(route, dayInput, startedAt.getTime()),
    })),
  );
  const pinnedRoute = routes.find((route) => route.id === pinned?.routeId);
  if (pinned && pinnedRoute)
    plans.push({
      route: pinnedRoute,
      plan: planDepartures(
        pinnedRoute,
        pinned.input,
        startedAt.getTime(),
        Date.parse(pinned.departureAt),
      ),
    });
  const feasible = plans.filter(({ plan }) => plan.departures.length > 0);
  const locations = [
    ...new Map(
      feasible
        .flatMap(({ route }) => route.weatherLocations)
        .map((l) => [l.id, l]),
    ).values(),
  ];
  if (locations.length > 256)
    throw new AppError(
      422,
      'TOO_MANY_WEATHER_LOCATIONS',
      'Compare fewer routes; a request supports up to 256 weather locations.',
    );
  const earliest = feasible.length
    ? Math.min(...feasible.flatMap((p) => p.plan.departures))
    : startedAt.getTime();
  const latest = feasible.length
    ? Math.max(...feasible.flatMap((p) => p.plan.departures))
    : startedAt.getTime();
  const recent = input.preferences.recentRides;
  const historySnapshot =
    recent.mode === 'prefer-variety' && feasible.length
      ? await readHistory(
          env.ROUTES_DB,
          ownerId,
          Temporal.Instant.fromEpochMilliseconds(earliest)
            .toZonedDateTimeISO('UTC')
            .toPlainDate()
            .subtract({ days: recent.lookbackDays + 2 })
            .toString(),
          Temporal.Instant.fromEpochMilliseconds(latest)
            .toZonedDateTimeISO('UTC')
            .toPlainDate()
            .add({ days: 2 })
            .toString(),
        )
      : null;
  const history = prepareHistory(
    [...new Map(feasible.map(({ route }) => [route.id, route])).values()],
    recent,
    historySnapshot,
    new Date(earliest).toISOString(),
    new Date(latest).toISOString(),
  );
  const cacheReads = { hits: 0, misses: 0 };
  const cache = dependencies.cache ?? {
    get: (key: string) => env.WEATHER_CACHE.get(key),
    put: async (key: string, value: string, ttlSeconds: number) =>
      env.WEATHER_CACHE.put(key, value, { expirationTtl: ttlSeconds }),
  };
  const configured =
    dependencies.providers ?? createWeatherProviders(env, cache, now);
  const providers = Object.fromEntries(
    Object.entries(configured).map(([id, provider]) => [
      id,
      withForecastCache(provider, cache, {
        now,
        ttlSeconds: refreshAfterSeconds,
        retentionSeconds: FORECAST_RETENTION_SECONDS,
        forecastHorizonHours: forecastHorizonHours(id),
        onRead: (hit) => {
          if (hit) cacheReads.hits++;
          else cacheReads.misses++;
        },
      }),
    ]),
  );
  // Requested comparison range; registered providers cache their independent full horizon.
  const range = feasible.length
    ? {
        start: new Date(
          Math.floor(
            Math.min(
              ...feasible.map(({ plan }) => plan.daylight?.start ?? Infinity),
            ) / HOUR,
          ) *
            HOUR -
            HOUR,
        ).toISOString(),
        end: new Date(
          Math.ceil(
            Math.max(
              ...feasible.map(({ plan }) => plan.daylight?.end ?? -Infinity),
            ) / HOUR,
          ) *
            HOUR +
            HOUR,
        ).toISOString(),
      }
    : null;
  // One deadline covers the rider's provider and any quota fallback.
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(30_000)]);
  const fetchForecast = async (settings: ForecastSettings) => {
    const request: ForecastRequest | null = range
      ? {
          locations,
          range,
          required: requiredWeatherFor({ ...input, ...settings }),
          ...qualityFor(settings.forecast),
          freshnessBasis: settings.forecast.freshnessBasis,
        }
      : null;
    const selected = request
      ? await getForecastForPolicy(
          providers,
          settings.weather,
          request,
          deadline,
        )
      : null;
    return { settings, request, selected };
  };
  const requestedProviderId = weatherProviderIdForPolicy(input.weather);
  let forecast = await fetchForecast({
    weather: input.weather,
    forecast: input.forecast,
  });
  // A provider out of quota can't finish this comparison, so the whole comparison
  // moves to Apple Weather: one source per comparison, never a mix of locations.
  // Advanced ordered-fallback policies (no provider choice) keep their own list.
  const quota =
    requestedProviderId && requestedProviderId !== quotaFallbackProviderId
      ? rateLimited(forecast.selected)
      : null;
  let fallback: { reason: 'rate-limited'; retryAt: string | null } | null =
    null;
  if (quota) {
    const next = await fetchForecast(
      weatherProviderChoices[quotaFallbackProviderId].settings,
    );
    const attempts = [
      ...(forecast.selected?.attempts ?? []),
      ...(next.selected?.attempts ?? []),
    ];
    const usable = next.selected?.attempts.some(
      (attempt) => attempt.status !== 'unavailable',
    );
    const kept = usable ? next : forecast;
    forecast = {
      ...kept,
      selected: kept.selected && { ...kept.selected, attempts },
    };
    if (usable)
      fallback = {
        reason: 'rate-limited',
        retryAt:
          quota.retryAfterSeconds === null
            ? null
            : new Date(
                now().getTime() + quota.retryAfterSeconds * 1000,
              ).toISOString(),
      };
  }
  const { settings, request, selected } = forecast;
  const requestedQuality = qualityFor(settings.forecast);
  const results = selected?.results ?? [];
  const forecastCheckedAt = now().getTime();
  // Until then the same request reuses this evidence, so clients can keep the ranking. Null: ask again.
  const staleAt = Math.min(
    ...results.map((result) =>
      result.status === 'unavailable'
        ? NaN
        : forecastStaleAt(
            result,
            {
              ...requestedQuality,
              freshnessBasis: settings.forecast.freshnessBasis,
            },
            refreshAfterSeconds,
          ),
    ),
  );
  const refreshAt = Number.isFinite(staleAt)
    ? new Date(staleAt).toISOString()
    : null;
  const outlines = new Map(
    routes.map((route) => [route.id, routeOutline(route)]),
  );
  const comparisons = inputs.map((requested) => {
    const dayInput = { ...requested, ...settings };
    const dayTtl = forecastRefreshSeconds(
      [dayInput.date],
      startedAt,
      dayInput.timeZone,
    );
    // An older snapshot may be fine for a distant selection but too old for a
    // same-day preview. Keep that preview unknown until the rider selects it.
    const dayResults = results.map((result) =>
      result.status === 'unavailable' ||
      isFreshForecast(
        result,
        {
          ...requestedQuality,
          freshnessBasis: settings.forecast.freshnessBasis,
        },
        forecastCheckedAt,
        dayTtl,
      )
        ? result
        : {
            ...result,
            status: 'partial' as const,
            issues: [
              ...result.issues,
              {
                code: 'stale-data' as const,
                message: 'The cached forecast is too old for this ride date.',
              },
            ],
          },
    );
    const result = recommendRides(
      routes,
      dayInput,
      dayResults,
      startedAt.getTime(),
      quality.maxLocationDistanceM,
      3,
      history,
      undefined,
      outlines,
    );
    return {
      input: dayInput,
      result,
      summary: daySummary(
        routes,
        dayInput,
        result,
        dayResults,
        requiredWeatherFor(dayInput),
        startedAt.getTime(),
        quality.maxLocationDistanceM,
      ),
    };
  });
  await attachPreviousScores(
    comparisons,
    routes,
    ownerId,
    startedAt,
    selected?.source ?? null,
    {
      revision: history.revision,
      status: history.status,
      matcherVersion: history.matcherVersion,
      affectedRouteIds: [...history.affectedRouteIds].sort(),
      affectedRideIds: [...history.affectedRideIds].sort(),
    },
    dependencies.scoreBaselines ?? createScoreBaselineStore(env.ROUTES_DB),
  );
  return {
    comparisons,
    /** The forecast settings actually used: Apple Weather's after a quota fallback. */
    forecast: settings.forecast,
    pinnedRefreshAt: pinnedRoute
      ? (() => {
          const ids = new Set(pinnedRoute.weatherLocations.map((l) => l.id));
          const expiry = Math.min(
            ...results
              .filter((r) =>
                ids.has(
                  r.status === 'unavailable'
                    ? r.requested.id
                    : r.location.requested.id,
                ),
              )
              .map((r) =>
                r.status === 'unavailable'
                  ? NaN
                  : forecastStaleAt(
                      r,
                      {
                        ...requestedQuality,
                        freshnessBasis: settings.forecast.freshnessBasis,
                      },
                      refreshAfterSeconds,
                    ),
              ),
          );
          return Number.isFinite(expiry)
            ? new Date(expiry).toISOString()
            : null;
        })()
      : null,
    pinned:
      pinned && pinnedRoute
        ? recommendRides(
            [pinnedRoute],
            { ...pinned.input, ...settings },
            results,
            startedAt.getTime(),
            quality.maxLocationDistanceM,
            0,
            history,
            new Map([[pinned.routeId, Date.parse(pinned.departureAt)]]),
            outlines,
          )
        : null,
    history: {
      revision: history.revision,
      status: feasible.length ? history.status : 'not_evaluated',
      matcherVersion: history.matcherVersion,
      reasonCode: feasible.length ? history.reasonCode : null,
      affectedRouteIds: history.affectedRouteIds,
      affectedRideIds: history.affectedRideIds,
    },
    weather: {
      ...summarizeProvenance(results),
      snapshotPolicy: 'provider-horizon',
      requestedPolicy: input.weather,
      requestedProviderId,
      selectedProvider: weatherProviderForSource(selected?.source.providerId),
      selectedSource: selected?.source ?? null,
      attempts: selected?.attempts ?? [],
      fallback,
      quality: {
        ...requestedQuality,
        freshnessBasis: settings.forecast.freshnessBasis,
        refreshAfterSeconds,
      },
      refreshAt,
      descriptors: request?.required ?? [],
      range,
      cache: cacheReads,
      locations: results.map((result) =>
        result.status === 'unavailable'
          ? {
              id: result.requested.id,
              status: result.status,
              issues: result.issues,
            }
          : {
              id: result.location.requested.id,
              status: result.status,
              distanceFromRequestedM: result.location.distanceFromRequestedM,
              provenance: result.provenance,
              issues: result.issues,
            },
      ),
    },
  };
};
