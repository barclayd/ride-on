import { Temporal } from '@js-temporal/polyfill';
import { AppError } from '../errors.ts';
import { prepareHistory } from '../rides/overlap.ts';
import { readHistory } from '../rides/store.ts';
import type { Route } from '../routes/model.ts';
import type { Env } from '../types.ts';
import {
  FORECAST_RETENTION_SECONDS,
  type ForecastCache,
  forecastStaleAt,
  isFreshForecast,
  withForecastCache,
} from '../weather/cache.ts';
import {
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
import { getForecastForPolicy } from '../weather/source-policy.ts';
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
  dependencies: {
    scoreBaselines?: ScoreBaselineStore;
    cache?: ForecastCache;
    providers?: Readonly<Record<string, ForecastProvider>>;
  };
};
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
  }: ComparisonContext,
) => {
  const refreshAfterSeconds = forecastRefreshSeconds(
    refreshDates,
    startedAt,
    input.timeZone,
  );
  const requestedQuality = {
    ...quality,
    maxAgeSeconds:
      input.forecast.freshnessBasis === 'retrieval-time'
        ? refreshAfterSeconds
        : quality.maxAgeSeconds,
  };
  const plans = inputs.flatMap((dayInput) =>
    routes.map((route) => ({
      route,
      plan: planDepartures(route, dayInput, startedAt.getTime()),
    })),
  );
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
  const request: ForecastRequest | null = range
    ? {
        locations,
        range,
        required: requiredWeatherFor(input),
        ...requestedQuality,
        freshnessBasis: input.forecast.freshnessBasis,
      }
    : null;
  const selected = request
    ? await getForecastForPolicy(
        providers,
        input.weather,
        request,
        AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
      )
    : null;
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
              freshnessBasis: input.forecast.freshnessBasis,
            },
            refreshAfterSeconds,
          ),
    ),
  );
  const refreshAt = Number.isFinite(staleAt)
    ? new Date(staleAt).toISOString()
    : null;
  const comparisons = inputs.map((dayInput) => {
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
        { ...requestedQuality, freshnessBasis: input.forecast.freshnessBasis },
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
      requestedProviderId: weatherProviderIdForPolicy(input.weather),
      selectedProvider: weatherProviderForSource(selected?.source.providerId),
      selectedSource: selected?.source ?? null,
      attempts: selected?.attempts ?? [],
      quality: {
        ...requestedQuality,
        freshnessBasis: input.forecast.freshnessBasis,
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
