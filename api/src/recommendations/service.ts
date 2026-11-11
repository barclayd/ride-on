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
import { taiwanRoutes } from '../weather/taiwan-region.ts';
import { planDepartures } from './daylight.ts';
import { recommendRides, requiredWeatherFor } from './engine.ts';
import { forecastRefreshSeconds } from './freshness.ts';
import type { RecommendationInput } from './input.ts';
import { daySummary, mergeDays } from './multi-day.ts';
import { createScoreReplay } from './replay.ts';
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
  includeReplay?: boolean;
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
/** One history snapshot and geographically selected providers for a bounded set
 * of comparisons. Callers supply identical settings apart from dates and windows. */
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
    includeReplay = false,
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
  const qualityFor = (
    forecast: RecommendationInput['forecast'],
    weather = input.weather,
  ) => ({
    ...quality,
    maxTimeStepSeconds:
      weather.mode === 'strict' && weather.providerId === 'taiwan-weather'
        ? 10800
        : quality.maxTimeStepSeconds,
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
  // One deadline covers both regions and any non-Taiwan quota fallback.
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(30_000)]);
  const requestedProviderId = weatherProviderIdForPolicy(input.weather);
  const groups = new Map<
    string,
    { routes: Route[]; settings: ForecastSettings }
  >();
  for (const route of routes) {
    // Geography overrides every saved/requested choice, including advanced policies.
    const settings: ForecastSettings = taiwanRoutes([route])
      ? weatherProviderChoices['taiwan-weather'].settings
      : input.weather.mode === 'strict' &&
          input.weather.providerId === 'automatic'
        ? {
            weather: weatherProviderChoices['apple-weather'].settings.weather,
            forecast: input.forecast,
          }
        : { weather: input.weather, forecast: input.forecast };
    const key = JSON.stringify(settings);
    const group = groups.get(key) ?? { routes: [], settings };
    group.routes.push(route);
    groups.set(key, group);
  }
  const forecasts = await Promise.all(
    [...groups.values()].map(async (group) => {
      const ids = new Set(
        group.routes.flatMap((route) =>
          route.weatherLocations.map((l) => l.id),
        ),
      );
      const groupLocations = locations.filter((location) =>
        ids.has(location.id),
      );
      const fetchForecast = async (settings: ForecastSettings) => {
        const request: ForecastRequest | null =
          range && groupLocations.length
            ? {
                locations: groupLocations,
                ...(settings.weather.mode === 'strict' &&
                settings.weather.providerId === 'taiwan-weather'
                  ? {
                      coverageCoordinates: Object.fromEntries(
                        groupLocations.map((location) => [
                          location.id,
                          group.routes.flatMap((route) =>
                            route.legs
                              .filter(
                                (leg) => leg.weatherLocationId === location.id,
                              )
                              .map((leg) => leg.coordinate),
                          ),
                        ]),
                      ),
                    }
                  : {}),
                range,
                required: requiredWeatherFor({ ...input, ...settings }),
                ...qualityFor(settings.forecast, settings.weather),
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
      let forecast = await fetchForecast(group.settings);
      // Quota fallback applies only within this group. Taiwan always keeps its
      // CWA-first product and never retries an Apple supplement quota failure.
      const quota =
        requestedProviderId &&
        group.settings.weather.mode === 'strict' &&
        group.settings.weather.providerId !== quotaFallbackProviderId &&
        group.settings.weather.providerId !== 'taiwan-weather'
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
      return {
        ...forecast,
        routes: group.routes,
        fallback,
        quality: {
          ...qualityFor(forecast.settings.forecast, forecast.settings.weather),
          freshnessBasis: forecast.settings.forecast.freshnessBasis,
        },
      };
    }),
  );
  const uniform = forecasts.length === 1 ? forecasts[0] : undefined;
  // Only provider settings may override a day's input. Spreading the entire
  // first input here would replace every mixed-region date with its preview date.
  const settings: ForecastSettings = uniform?.settings ?? {
    weather: input.weather,
    forecast: input.forecast,
  };
  const selected = uniform?.selected ?? null;
  const results = forecasts.flatMap(
    (forecast) => forecast.selected?.results ?? [],
  );
  const byLocation = new Map(
    forecasts.flatMap((forecast) =>
      forecast.routes.flatMap((route) =>
        route.weatherLocations.map(
          (location) => [location.id, forecast] as const,
        ),
      ),
    ),
  );
  const requiredByLocation = new Map(
    [...byLocation].map(
      ([id, forecast]) =>
        [id, requiredWeatherFor({ ...input, ...forecast.settings })] as const,
    ),
  );
  const qualityOf = (result: (typeof results)[number]) =>
    byLocation.get(
      result.status === 'unavailable'
        ? result.requested.id
        : result.location.requested.id,
    )?.quality ?? { ...quality, freshnessBasis: input.forecast.freshnessBasis };
  const routeSources = forecasts
    .flatMap((forecast) =>
      forecast.routes.map((route) => ({
        routeId: route.id,
        selectedSource: forecast.selected?.source ?? null,
        selectedProvider: weatherProviderForSource(
          forecast.selected?.source.providerId,
        ),
        forecast: forecast.settings.forecast,
        quality: { ...forecast.quality, refreshAfterSeconds },
        fallback: forecast.fallback,
      })),
    )
    .sort((a, b) => a.routeId.localeCompare(b.routeId));
  const forecastCheckedAt = now().getTime();
  // Until then the same request reuses this evidence, so clients can keep the ranking. Null: ask again.
  const staleAt = Math.min(
    ...results.map((result) =>
      result.status === 'unavailable'
        ? NaN
        : forecastStaleAt(result, qualityOf(result), refreshAfterSeconds),
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
      isFreshForecast(result, qualityOf(result), forecastCheckedAt, dayTtl)
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
    const regional = forecasts.map((forecast) => {
      const regionalInput = { ...requested, ...forecast.settings };
      return {
        input: regionalInput,
        ...(includeReplay
          ? {
              replay: createScoreReplay(
                forecast.routes,
                regionalInput,
                dayResults,
                startedAt.getTime(),
                quality.maxLocationDistanceM,
                3,
                history,
              ),
            }
          : {}),
        result: recommendRides(
          forecast.routes,
          regionalInput,
          dayResults,
          startedAt.getTime(),
          quality.maxLocationDistanceM,
          3,
          history,
          undefined,
          outlines,
        ),
        forecast,
      };
    });
    const result =
      regional.length === 1 && regional[0]
        ? regional[0].result
        : mergeDays(
            regional.map((part) => part.result),
            Object.keys(input.preferences.minimumStandards).length > 0,
          );
    return {
      input: dayInput,
      result,
      regional,
      summary: daySummary(
        routes,
        dayInput,
        result,
        dayResults,
        requiredByLocation,
        startedAt.getTime(),
        quality.maxLocationDistanceM,
      ),
    };
  });
  await Promise.all(
    forecasts.map((forecast) =>
      attachPreviousScores(
        comparisons.flatMap((comparison) =>
          comparison.regional.filter((part) => part.forecast === forecast),
        ),
        forecast.routes,
        ownerId,
        startedAt,
        forecast.selected?.source ?? null,
        {
          revision: history.revision,
          status: history.status,
          matcherVersion: history.matcherVersion,
          affectedRouteIds: [...history.affectedRouteIds].sort(),
          affectedRideIds: [...history.affectedRideIds].sort(),
        },
        dependencies.scoreBaselines ?? createScoreBaselineStore(env.ROUTES_DB),
      ),
    ),
  );
  const pinnedForecast = forecasts.find((forecast) =>
    forecast.routes.some((route) => route.id === pinned?.routeId),
  );
  const commonForecast = forecasts[0]?.settings.forecast ?? input.forecast;
  return {
    ...(includeReplay
      ? {
          replay: comparisons.flatMap((comparison) =>
            comparison.regional.flatMap((region) => region.replay ?? []),
          ),
        }
      : {}),
    comparisons: comparisons.map(
      ({ regional: _regional, ...comparison }) => comparison,
    ),
    // Mixed comparisons retain each route's exact statistics in routeSources.
    forecast: {
      representation: forecasts.every(
        (forecast) =>
          forecast.settings.forecast.representation ===
          commonForecast.representation,
      )
        ? commonForecast.representation
        : ('mixed' as const),
      freshnessBasis: forecasts.every(
        (forecast) =>
          forecast.settings.forecast.freshnessBasis ===
          commonForecast.freshnessBasis,
      )
        ? commonForecast.freshnessBasis
        : ('mixed' as const),
    },
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
                  : forecastStaleAt(r, qualityOf(r), refreshAfterSeconds),
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
            { ...pinned.input, ...(pinnedForecast?.settings ?? settings) },
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
      attempts: forecasts.flatMap(
        (forecast) => forecast.selected?.attempts ?? [],
      ),
      fallback: uniform?.fallback ?? null,
      routeSources,
      quality: uniform ? { ...uniform.quality, refreshAfterSeconds } : null,
      refreshAt,
      descriptors: [
        ...new Map(
          forecasts.flatMap((forecast) =>
            (forecast.request?.required ?? []).map(
              (descriptor) => [JSON.stringify(descriptor), descriptor] as const,
            ),
          ),
        ).values(),
      ],
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
              fieldEvidence: result.series.flatMap((s) =>
                s.evidence
                  ? [{ descriptor: s.descriptor, sources: s.evidence }]
                  : [],
              ),
              issues: result.issues,
            },
      ),
    },
  };
};
