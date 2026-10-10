import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';
import { readBoundedBody } from './body.ts';
import { AppError } from './errors.ts';
import { resolveAccess } from './identity/access.ts';
import { authConfig } from './identity/config.ts';
import { copySessionHeaders, identityRoutes } from './identity/routes.ts';
import { assessClimbing } from './recommendations/climbing.ts';
import { planDepartures } from './recommendations/daylight.ts';
import {
  recommendRides,
  requiredWeatherFor,
} from './recommendations/engine.ts';
import {
  defaultSettings,
  mergeSettings,
  recommendationRequestSchema,
  recommendationWithSettings,
  resolvedRecommendationSchema,
  resolveMinimumTemperature,
  settingsSchema,
} from './recommendations/input.ts';
import { readJsonBody, validateInput } from './request.ts';
import { importGpx } from './routes/gpx.ts';
import { importSourceRoute } from './routes/import.ts';
import {
  createD1RouteSelectionStore,
  type RouteSelectionStore,
  updateSelectionSchema,
} from './routes/selection.ts';
import {
  importRouteSchema,
  type RouteSourceProvider,
  routeSourceProviders,
} from './routes/sources.ts';
import {
  createD1RouteStore,
  listRoutesSchema,
  type RouteStore,
  storedRouteSummary,
} from './routes/store.ts';
import type { Bindings, Env } from './types.ts';
import {
  createD1UserStore,
  createUserSchema,
  type User,
  type UserStore,
  updateUserSchema,
} from './users/model.ts';
import { type ForecastCache, withForecastCache } from './weather/cache.ts';
import type { ForecastProvider, ForecastRequest } from './weather/contracts.ts';
import {
  createWeatherProviders,
  describeWeatherProviders,
} from './weather/providers.ts';
import { getForecastForPolicy } from './weather/source-policy.ts';

const HOUR = 3_600_000;
const quality = {
  maxTimeStepSeconds: 3600,
  maxLocationDistanceM: 10_000,
  maxAgeSeconds: 6 * 3600,
};
export const createApp = (
  dependencies: {
    resolveAccess?: typeof resolveAccess;
    routeStore?: RouteStore;
    routeSelectionStore?: RouteSelectionStore;
    routeSources?: ReadonlyMap<string, RouteSourceProvider>;
    userStore?: UserStore;
    providers?: Readonly<Record<string, ForecastProvider>>;
    cache?: ForecastCache;
    now?: () => Date;
    log?: boolean;
  } = {},
) => {
  const app = new Hono<Bindings>();
  const now = dependencies.now ?? (() => new Date());
  const store = (env: Env) =>
    dependencies.routeStore ?? createD1RouteStore(env.ROUTES_DB);
  const users = (env: Env) =>
    dependencies.userStore ?? createD1UserStore(env.ROUTES_DB);
  const selections = (env: Env) =>
    dependencies.routeSelectionStore ??
    createD1RouteSelectionStore(env.ROUTES_DB);
  const sources = dependencies.routeSources ?? routeSourceProviders;
  app.use('*', async (c, next) => {
    const start = Date.now();
    c.header('Cache-Control', 'no-store');
    await next();
    if (dependencies.log !== false)
      console.log(
        `${c.req.method} ${new URL(c.req.url).pathname} ${c.res.status} ${Date.now() - start}ms`,
      );
  });
  app.use('*', async (c, next) => {
    const origin = c.req.header('Origin');
    if (origin && c.env.AUTH_CONFIG_JSON) {
      const config = authConfig(c.env);
      if ([config.baseUrl, ...config.trustedOrigins].includes(origin)) {
        c.header('Access-Control-Allow-Origin', origin);
        c.header('Access-Control-Allow-Credentials', 'true');
        c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        c.header(
          'Access-Control-Allow-Methods',
          'GET, POST, PATCH, PUT, OPTIONS',
        );
        c.header('Access-Control-Expose-Headers', 'set-auth-token');
        c.header('Vary', 'Origin');
        if (c.req.method === 'OPTIONS') return c.body(null, 204);
      }
    }
    if (c.req.method === 'OPTIONS') return c.body(null, 403);
    await next();
  });
  app.get('/health', (c) => c.json({ ok: true, version: '0.9.0' }));
  app.route('/', identityRoutes());
  for (const path of [
    '/routes',
    '/routes/*',
    '/route-sources',
    '/route-imports',
    '/route-selection',
    '/recommendations',
    '/weather-providers',
    '/users',
    '/users/*',
  ])
    app.use(path, async (c, next) => {
      const access = await (dependencies.resolveAccess ?? resolveAccess)(
        c.req.raw,
        c.env,
      );
      c.set('ownerId', access.ownerId);
      copySessionHeaders(access.headers, c.res.headers);
      await next();
    });
  app.get('/weather-providers', (c) =>
    c.json({
      defaultPolicy: defaultSettings.weather,
      providers: describeWeatherProviders(c.env),
    }),
  );
  app.post('/users', async (c) => {
    const input = await readJsonBody(c, createUserSchema);
    const timestamp = now().toISOString();
    const user: User = {
      schemaVersion: 1,
      id: c.get('ownerId'),
      version: 1,
      displayName: input.displayName,
      createdAt: timestamp,
      updatedAt: timestamp,
      settings: validateInput(
        settingsSchema,
        mergeSettings(input.settings ?? {}),
      ),
    };
    if (!(await users(c.env).create(user)))
      throw new AppError(
        409,
        'USER_ALREADY_EXISTS',
        'Your user profile already exists. Use PATCH /users/me to update it.',
      );
    c.header('Location', '/users/me');
    return c.json({ user }, 201);
  });
  app.get('/users/me', async (c) => {
    const user = await users(c.env).get(c.get('ownerId'));
    if (!user)
      throw new AppError(
        404,
        'USER_NOT_FOUND',
        'Create your user profile with POST /users.',
      );
    return c.json({ user });
  });
  app.patch('/users/me', async (c) => {
    const input = await readJsonBody(c, updateUserSchema);
    const current = await users(c.env).get(c.get('ownerId'));
    if (!current)
      throw new AppError(
        404,
        'USER_NOT_FOUND',
        'Create your user profile with POST /users.',
      );
    const conflict = () =>
      new AppError(
        409,
        'USER_VERSION_CONFLICT',
        'Your profile has changed. Read GET /users/me and retry with its version.',
      );
    if (current.version !== input.expectedVersion) throw conflict();
    const user: User = {
      ...current,
      version: current.version + 1,
      updatedAt: now().toISOString(),
      displayName: input.displayName ?? current.displayName,
      settings: validateInput(
        settingsSchema,
        mergeSettings(input.settings ?? {}, current.settings),
      ),
    };
    if (!(await users(c.env).update(user, input.expectedVersion)))
      throw conflict();
    return c.json({ user });
  });
  app.get('/route-sources', (c) =>
    c.json({
      sources: [...sources.values()].map((provider) => provider.descriptor),
    }),
  );
  app.post('/route-imports', async (c) => {
    const input = await readJsonBody(c, importRouteSchema, 6_000_000);
    const provider = sources.get(input.source.providerId);
    if (!provider)
      throw new AppError(
        422,
        'UNSUPPORTED_ROUTE_SOURCE',
        'Use a provider from GET /route-sources.',
      );
    const result = await importSourceRoute(
      { ...input, ownerId: c.get('ownerId'), importedAt: now().toISOString() },
      provider,
      store(c.env),
    );
    c.header('Location', `/routes/${result.record.route.id}`);
    return c.json(
      { outcome: result.outcome, route: storedRouteSummary(result.record) },
      result.outcome === 'created' ? 201 : 200,
    );
  });
  app.get('/route-selection', async (c) =>
    c.json({ selection: await selections(c.env).get(c.get('ownerId')) }),
  );
  app.put('/route-selection', async (c) => {
    const input = await readJsonBody(c, updateSelectionSchema);
    const routes = await store(c.env).getMany(c.get('ownerId'), input.routeIds);
    if (routes.length !== input.routeIds.length)
      throw new AppError(
        404,
        'ROUTE_NOT_FOUND',
        'One or more routes were not found.',
      );
    const selection = {
      routeIds: input.routeIds,
      version: input.expectedVersion + 1,
      updatedAt: now().toISOString(),
    };
    if (
      !(await selections(c.env).update(
        c.get('ownerId'),
        selection,
        input.expectedVersion,
      ))
    )
      throw new AppError(
        409,
        'SELECTION_VERSION_CONFLICT',
        'Your selection has changed. Read GET /route-selection and reconcile before retrying.',
      );
    return c.json({ selection });
  });
  app.get('/routes', async (c) => {
    const query = validateInput(listRoutesSchema, c.req.query());
    if (
      query.cursor &&
      !(await store(c.env).get(c.get('ownerId'), query.cursor))
    )
      throw new AppError(
        400,
        'INVALID_CURSOR',
        'Use a nextCursor from your route library.',
      );
    return c.json({
      ...(await store(c.env).list(c.get('ownerId'), query)),
      limit: query.limit,
    });
  });
  app.get('/routes/:id', async (c) => {
    const id = validateInput(z.uuid(), c.req.param('id'));
    const record = await store(c.env).get(c.get('ownerId'), id);
    if (!record)
      throw new AppError(404, 'ROUTE_NOT_FOUND', 'The route was not found.');
    return c.json({ route: storedRouteSummary(record) });
  });
  app.post('/routes', async (c) => {
    const contentType = c.req.header('Content-Type') ?? '';
    let bytes: Uint8Array;
    let name: string | undefined;
    if (contentType.startsWith('multipart/form-data')) {
      const body = await readBoundedBody(c.req.raw, 5_100_000);
      let form: FormData;
      try {
        form = await new Response(body, {
          headers: { 'Content-Type': contentType },
        }).formData();
      } catch {
        throw new AppError(
          400,
          'BAD_MULTIPART',
          'Upload a GPX file in the file field.',
        );
      }
      const file = form.get('file');
      const suppliedName = form.get('name');
      if (!file || typeof file === 'string' || form.getAll('file').length !== 1)
        throw new AppError(
          400,
          'MISSING_FILE',
          'Supply exactly one GPX file in the file field.',
        );
      bytes = new Uint8Array(await file.arrayBuffer());
      if (typeof suppliedName === 'string') name = suppliedName;
    } else if (
      ['application/gpx+xml', 'application/xml', 'text/xml'].includes(
        contentType.split(';')[0]?.trim() ?? '',
      )
    ) {
      bytes = await readBoundedBody(c.req.raw, 5_000_000);
    } else
      throw new AppError(
        415,
        'UNSUPPORTED_MEDIA_TYPE',
        'Use application/gpx+xml or multipart/form-data with a file field.',
      );
    let xml: string;
    try {
      xml = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(
        bytes,
      );
    } catch {
      throw new AppError(422, 'INVALID_GPX', 'GPX must be UTF-8 encoded.');
    }
    const route = await importGpx(xml, name, now().toISOString());
    await store(c.env).save(c.get('ownerId'), route);
    c.header('Location', `/routes/${route.id}`);
    return c.json(
      {
        route: storedRouteSummary({
          route,
          version: 1,
          updatedAt: route.createdAt,
          source: null,
        }),
      },
      201,
    );
  });
  app.post('/recommendations', async (c) => {
    const raw = await readJsonBody(c, recommendationRequestSchema);
    const [user, routes] = await Promise.all([
      users(c.env).get(c.get('ownerId')),
      store(c.env).getMany(c.get('ownerId'), raw.routeIds),
    ]);
    const input = validateInput(
      resolvedRecommendationSchema,
      recommendationWithSettings(raw, user?.settings),
    );
    if (routes.length !== input.routeIds.length)
      throw new AppError(
        404,
        'ROUTE_NOT_FOUND',
        'One or more routes were not found.',
      );
    const startedAt = now();
    const plans = routes.map((route) => ({
      route,
      plan: planDepartures(route, input, startedAt.getTime()),
    }));
    const feasible = plans.filter(
      ({ route, plan }) =>
        plan.departures.length > 0 &&
        assessClimbing(route, input.preferences.climbing.preference).status !==
          'unknown',
    );
    const locations = feasible.flatMap(({ route }) => route.weatherLocations);
    if (locations.length > 256)
      throw new AppError(
        422,
        'TOO_MANY_WEATHER_LOCATIONS',
        'Compare fewer routes; a request supports up to 256 weather locations.',
      );
    const cacheReads = { hits: 0, misses: 0 };
    const cache = dependencies.cache ?? {
      get: (key: string) => c.env.WEATHER_CACHE.get(key),
      put: async (key: string, value: string, ttlSeconds: number) =>
        c.env.WEATHER_CACHE.put(key, value, { expirationTtl: ttlSeconds }),
    };
    const configured =
      dependencies.providers ?? createWeatherProviders(c.env, cache, now);
    const providers = Object.fromEntries(
      Object.entries(configured).map(([id, provider]) => [
        id,
        withForecastCache(provider, cache, {
          now,
          onRead: (hit) => {
            if (hit) cacheReads.hits++;
            else cacheReads.misses++;
          },
        }),
      ]),
    );
    // Canonical day range keeps preference / speed experiments on the same cached snapshot.
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
          ...quality,
          freshnessBasis: input.forecast.freshnessBasis,
        }
      : null;
    const selected = request
      ? await getForecastForPolicy(
          providers,
          input.weather,
          request,
          AbortSignal.any([c.req.raw.signal, AbortSignal.timeout(30_000)]),
        )
      : null;
    const results = selected?.results ?? [];
    return c.json({
      ...recommendRides(
        routes,
        input,
        results,
        startedAt.getTime(),
        quality.maxLocationDistanceM,
      ),
      generatedAt: startedAt.toISOString(),
      date: input.date,
      timeZone: input.timeZone,
      savedUser: user ? { id: user.id, version: user.version } : null,
      resolvedPreferences: input.preferences,
      resolvedMinimumTemperature: resolveMinimumTemperature(input),
      riding: input.riding,
      forecast: input.forecast,
      assumptions: [
        ...(input.preferences.climbing.preference !== 'neutral'
          ? [
              'Climbing preference uses estimated ascent per kilometre, not slope steepness or total effort. It contributes 10% of the score; minimum conditions still take priority. Routes without complete elevation are unranked.',
            ]
          : []),
        ...(input.preferences.distance !== null
          ? [
              'Preferred distance contributes 10% of the score. Every distance inside the inclusive range fits equally; scores decrease gradually outside it without excluding routes. Weather retains 90% of the score, or 80% when climbing is also active. Minimum conditions and whole-ride time windows still take priority.',
            ]
          : []),
        ...(input.preferences.weights.sunshine > 0
          ? [
              'Sunshine comfort uses forecast weather symbols: sunny, sunny intervals or other conditions. Category shares describe route sections, not sunshine duration or probability. Unknown symbols remain missing.',
            ]
          : []),
        ...(input.forecast.representation === 'ensemble-summary'
          ? [
              'Weather uses marginal 50th-percentile values and ensemble-mean wind direction, not a joint scenario. Hourly precipitation probability is for more than 0 mm in its native interval.',
            ]
          : []),
        ...(input.forecast.freshnessBasis === 'retrieval-time'
          ? [
              'Freshness is measured since retrieval only; the age of the underlying forecast model may be unknown.',
            ]
          : []),
        'Assisted distance requires a tailwind component of at least 3 km/h that exceeds the crosswind component. Calm circular rides do not need tailwinds to score well.',
        'Duration uses constant moving speed; stops, climbing and wind do not yet change the estimate.',
        'The full ride must fit within the common sunrise-to-sunset window across sampled route locations.',
        ...(input.riding.window === 'daylight'
          ? []
          : [
              'The full ride must also fit inside your requested local-time window. Departure slots are anchored at its start.',
            ]),
        'Conditions are evaluated at the midpoint of each route section of up to 500 metres, using weather locations at most 10 km apart.',
        'Instant forecasts and short wind means use the nearest hourly validity, up to 30 minutes away. Full-hour means, gusts and precipitation probabilities retain their native period bounds. An hourly precipitation amount is converted to an hourly average rate when supplied by the provider.',
        'Comfort weights are provisional. Weather score combines 75% distance-weighted mean comfort and 25% worst sampled comfort; it is not a probability.',
        'Precipitation includes rain, snow and other forms. The highest local hourly probability is not the probability of precipitation anywhere on the whole ride.',
      ],
      weather: {
        requestedPolicy: input.weather,
        selectedSource: selected?.source ?? null,
        attempts: selected?.attempts ?? [],
        quality: { ...quality, freshnessBasis: input.forecast.freshnessBasis },
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
    });
  });
  app.notFound((c) =>
    c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404),
  );
  app.onError((error, c) => {
    if (error instanceof AppError)
      return c.json(
        { error: { code: error.code, message: error.message } },
        error.status as ContentfulStatusCode,
        error.headers,
      );
    console.error('Unhandled API error');
    return c.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      500,
    );
  });
  return app;
};
export default createApp();
