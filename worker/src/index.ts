import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';
import { readBoundedBody } from './body.ts';
import { AppError } from './errors.ts';
import { assessGround, assessmentWindowError } from './ground/assessment.ts';
import { createGroundCache } from './ground/cache.ts';
import {
  assessmentRequestSchema,
  requestSchema as groundRequestSchema,
} from './ground/contracts.ts';
import { openMeteoGroundProvider } from './ground/open-meteo.ts';
import { collectGroundEvidence } from './ground/service.ts';
import { resolveAccess } from './identity/access.ts';
import { authConfig } from './identity/config.ts';
import { copySessionHeaders, identityRoutes } from './identity/routes.ts';
import { browserNotificationRoutes } from './monitoring/browser-page.ts';
import { notificationRoutes } from './monitoring/routes.ts';
import { consumeMonitoring, dispatchMonitoring } from './monitoring/service.ts';
import { ALGORITHM_VERSION } from './recommendations/engine.ts';
import {
  defaultSettings,
  mergeSettings,
  recommendationApiRequestSchema,
  recommendationWithSettings,
  resolvedRecommendationSchema,
  resolveMinimumTemperature,
  settingsSchema,
} from './recommendations/input.ts';
import { preferenceLevels } from './recommendations/levels.ts';
import { mergeDays } from './recommendations/multi-day.ts';
import {
  nextWindowsSchema,
  recommendNextWindows,
} from './recommendations/next-windows.ts';
import {
  datesBetween,
  localDate,
  resolvePlanningDays,
} from './recommendations/planning.ts';
import { presentRoute } from './recommendations/presentation.ts';
import type { ScoreBaselineStore } from './recommendations/score-baselines.ts';
import {
  createScoreChangeStore,
  rememberScoreChanges,
  type ScoreChangeStore,
} from './recommendations/score-changes.ts';
import { evaluateComparisons } from './recommendations/service.ts';
import { readJsonBody, validateInput } from './request.ts';
import { rideRoutes } from './rides/routes.ts';
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
import { surfaceSummary } from './routes/surface.ts';
import { stravaHistoryRoutes } from './strava/history-routes.ts';
import {
  consumeStravaMessage,
  dispatchImports,
} from './strava/import-service.ts';
import {
  cleanStravaFlows,
  stravaPublicRoutes,
  stravaRoutes,
} from './strava/routes.ts';
import { contextFor } from './tracking/model.ts';
import { issueReferences, withReference } from './tracking/references.ts';
import { trackingRoutes } from './tracking/routes.ts';
import type { Bindings, Env } from './types.ts';
import {
  createD1UserStore,
  createUserSchema,
  type User,
  type UserStore,
  updateUserSchema,
} from './users/model.ts';
import {
  activePause,
  deletePause,
  pauseInputSchema,
  putPause,
  readPause,
} from './users/pause.ts';
import type { ForecastCache } from './weather/cache.ts';
import { weatherProviderIdForPolicy } from './weather/choices.ts';
import type { ForecastProvider } from './weather/contracts.ts';
import { describeWeatherProviders } from './weather/providers.ts';

export const createApp = (
  dependencies: {
    resolveAccess?: typeof resolveAccess;
    routeStore?: RouteStore;
    routeSelectionStore?: RouteSelectionStore;
    routeSources?: ReadonlyMap<string, RouteSourceProvider>;
    userStore?: UserStore;
    providers?: Readonly<Record<string, ForecastProvider>>;
    scoreBaselines?: ScoreBaselineStore;
    scoreChanges?: ScoreChangeStore;
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
  const requireUser = async (env: Env, owner: string) => {
    const user = await users(env).get(owner);
    if (!user)
      throw new AppError(
        404,
        'USER_NOT_FOUND',
        'Create your user profile with POST /users.',
      );
    return user;
  };
  const publicUser = async (env: Env, user: User) => ({
    ...user,
    pause: activePause(
      await readPause(env.ROUTES_DB, user.id, user.settings.timeZone),
      now(),
    ),
    weatherProviderId: weatherProviderIdForPolicy(user.settings.weather),
    preferenceLevels: preferenceLevels(user.settings.preferences),
  });
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
    // Safari extensions send bearer tokens, never cookies, so they get CORS without credentials.
    const extension = !!origin?.startsWith('safari-web-extension://');
    if (origin && (extension || c.env.AUTH_CONFIG_JSON)) {
      const config = extension ? undefined : authConfig(c.env);
      if (
        !config ||
        [config.baseUrl, ...config.trustedOrigins].includes(origin)
      ) {
        c.header('Access-Control-Allow-Origin', origin);
        if (config) c.header('Access-Control-Allow-Credentials', 'true');
        c.header(
          'Access-Control-Allow-Headers',
          'Content-Type, Authorization, Idempotency-Key',
        );
        c.header(
          'Access-Control-Allow-Methods',
          'GET, POST, PATCH, PUT, DELETE, OPTIONS',
        );
        c.header('Access-Control-Expose-Headers', 'set-auth-token');
        c.header('Vary', 'Origin');
        if (c.req.method === 'OPTIONS') return c.body(null, 204);
      }
    }
    if (c.req.method === 'OPTIONS') return c.body(null, 403);
    await next();
  });
  app.get('/health', (c) =>
    c.json({
      ok: true,
      version: '0.38.0',
      algorithmVersion: ALGORITHM_VERSION,
      revision: c.env.CF_VERSION_METADATA?.tag || null,
    }),
  );
  // The Ride On app finishes browser sign-in at /auth/browser/done: an https
  // ASWebAuthenticationSession callback needs this host as an associated domain.
  app.get('/.well-known/apple-app-site-association', (c) =>
    c.json({ webcredentials: { apps: ['R2GGK3VN2C.com.danbarclay.rideon'] } }),
  );
  app.route('/', identityRoutes());
  app.route('/', browserNotificationRoutes());
  app.route('/', stravaPublicRoutes());
  for (const path of [
    '/history/*',
    '/connections/strava',
    '/connections/strava/*',
    '/push-devices',
    '/push-devices/*',
    '/tracked-rides',
    '/tracked-rides/*',
    '/rides',
    '/rides/*',
    '/routes',
    '/routes/*',
    '/route-sources',
    '/route-imports',
    '/route-selection',
    '/recommendations',
    '/recommendations/*',
    '/weather-providers',
    '/ground-evidence',
    '/ground-assessment',
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
  app.route('/', notificationRoutes(now));
  app.route('/', rideRoutes(now));
  app.route('/', stravaHistoryRoutes(now));
  app.route('/', stravaRoutes());
  app.route('/', trackingRoutes(now, store, users, dependencies));
  app.post('/ground-assessment', async (c) => {
    const input = await readJsonBody(c, assessmentRequestSchema);
    const routes = await store(c.env).getMany(c.get('ownerId'), input.routeIds);
    if (routes.length !== input.routeIds.length)
      throw new AppError(
        404,
        'ROUTE_NOT_FOUND',
        'One or more routes were not found.',
      );
    if (c.env.GROUND_EVIDENCE_MODE !== 'non-commercial')
      throw new AppError(
        503,
        'GROUND_EVIDENCE_DISABLED',
        'Ground evidence is not enabled.',
      );
    const user = await users(c.env).get(c.get('ownerId'));
    const speed =
      input.averageSpeedKph ??
      user?.settings.riding.averageSpeedKph ??
      defaultSettings.riding.averageSpeedKph;
    const issuedAt = now();
    const departure = Date.parse(input.departureAt);
    const error = assessmentWindowError(
      routes,
      departure,
      speed,
      issuedAt.getTime(),
    );
    if (error) throw new AppError(400, 'BAD_REQUEST', error);
    const evidence = await collectGroundEvidence(
      routes,
      createGroundCache(c.env.ROUTES_DB),
      openMeteoGroundProvider,
      issuedAt,
    );
    return c.json(
      assessGround(routes, evidence, departure, speed, issuedAt.getTime()),
    );
  });
  app.post('/ground-evidence', async (c) => {
    const input = await readJsonBody(c, groundRequestSchema);
    const routes = await store(c.env).getMany(c.get('ownerId'), input.routeIds);
    if (routes.length !== input.routeIds.length)
      throw new AppError(
        404,
        'ROUTE_NOT_FOUND',
        'One or more routes were not found.',
      );
    if (c.env.GROUND_EVIDENCE_MODE !== 'non-commercial')
      throw new AppError(
        503,
        'GROUND_EVIDENCE_DISABLED',
        'Ground evidence is not enabled.',
      );
    return c.json(
      await collectGroundEvidence(
        routes,
        createGroundCache(c.env.ROUTES_DB),
        openMeteoGroundProvider,
        now(),
      ),
    );
  });
  app.get('/weather-providers', (c) =>
    c.json({
      defaultPolicy: defaultSettings.weather,
      defaultProviderId: weatherProviderIdForPolicy(defaultSettings.weather),
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
    return c.json({ user: await publicUser(c.env, user) }, 201);
  });
  app.get('/users/me', async (c) => {
    const user = await requireUser(c.env, c.get('ownerId'));
    return c.json({ user: await publicUser(c.env, user) });
  });
  app.put('/users/me/pause', async (c) => {
    const input = await readJsonBody(c, pauseInputSchema);
    const user = await requireUser(c.env, c.get('ownerId'));
    await putPause(c.env.ROUTES_DB, user, input.until, now());
    return c.json({
      user: await publicUser(c.env, await requireUser(c.env, user.id)),
    });
  });
  app.delete('/users/me/pause', async (c) => {
    const user = await requireUser(c.env, c.get('ownerId'));
    await deletePause(c.env.ROUTES_DB, user.id, now());
    return c.json({
      user: await publicUser(c.env, await requireUser(c.env, user.id)),
    });
  });
  app.patch('/users/me', async (c) => {
    const input = await readJsonBody(c, updateUserSchema);
    const current = await requireUser(c.env, c.get('ownerId'));
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
    return c.json({ user: await publicUser(c.env, user) });
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
  app.get('/routes/:id/surface', async (c) => {
    const id = validateInput(z.uuid(), c.req.param('id'));
    const record = await store(c.env).get(c.get('ownerId'), id);
    if (!record)
      throw new AppError(404, 'ROUTE_NOT_FOUND', 'The route was not found.');
    return c.json({
      routeId: id,
      version: record.version,
      surface:
        record.route.surface?.sourceHash === record.route.sourceHash
          ? record.route.surface
          : null,
      summary: surfaceSummary(record.route),
    });
  });
  app.get('/routes/:id/geometry', async (c) => {
    const id = validateInput(z.uuid(), c.req.param('id'));
    const record = await store(c.env).get(c.get('ownerId'), id);
    if (!record)
      throw new AppError(404, 'ROUTE_NOT_FOUND', 'The route was not found.');
    return c.json({
      routeId: id,
      version: record.version,
      geometry: record.route.geometry ?? null,
    });
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
  app.put('/routes/:id/geometry', async (c) => {
    const id = validateInput(z.uuid(), c.req.param('id'));
    const input = await readJsonBody(
      c,
      z.strictObject({
        expectedVersion: z.number().int().positive(),
        gpx: z.string().min(1),
      }),
      6_000_000,
    );
    const current = await store(c.env).get(c.get('ownerId'), id);
    if (!current)
      throw new AppError(404, 'ROUTE_NOT_FOUND', 'The route was not found.');
    if (current.version !== input.expectedVersion)
      throw new AppError(
        409,
        'ROUTE_VERSION_CONFLICT',
        'Read the current route version before enriching geometry.',
      );
    const parsed = await importGpx(input.gpx);
    if (parsed.sourceHash !== current.route.sourceHash)
      throw new AppError(
        409,
        'ROUTE_CONTENT_MISMATCH',
        'Upload the exact original GPX for this route version.',
      );
    if (!parsed.geometry)
      throw new AppError(
        422,
        'GEOMETRY_UNAVAILABLE',
        'This GPX is too sparse or large for overlap assessment.',
      );
    if (current.route.geometry)
      return c.json({
        outcome: 'unchanged',
        route: storedRouteSummary(current),
      });
    const record = {
      ...current,
      route: { ...current.route, geometry: parsed.geometry },
      version: current.version + 1,
      updatedAt: now().toISOString(),
    };
    if (
      !(await store(c.env).replaceImported(
        c.get('ownerId'),
        record,
        input.expectedVersion,
      ))
    )
      throw new AppError(
        409,
        'ROUTE_VERSION_CONFLICT',
        'The route changed during enrichment.',
      );
    return c.json({ outcome: 'updated', route: storedRouteSummary(record) });
  });
  app.post('/recommendations/next-windows', async (c) => {
    const raw = await readJsonBody(c, nextWindowsSchema);
    const [user, loaded] = await Promise.all([
      users(c.env).get(c.get('ownerId')),
      Promise.all(
        raw.routeIds.map((id) => store(c.env).get(c.get('ownerId'), id)),
      ),
    ]);
    const records = loaded.filter((r) => r !== null);
    const routes = records.map((r) => r.route);
    const settings = validateInput(
      settingsSchema,
      mergeSettings(raw, user?.settings),
    );
    const result = await recommendNextWindows(
      raw,
      settings,
      routes,
      {
        env: c.env,
        ownerId: c.get('ownerId'),
        signal: c.req.raw.signal,
        now,
        startedAt: now(),
        dependencies,
      },
      records,
    );
    return c.json({
      ...result,
      savedUser: user ? { id: user.id, version: user.version } : null,
    });
  });
  app.post('/recommendations', async (c) => {
    const raw = await readJsonBody(c, recommendationApiRequestSchema);
    const [user, loaded] = await Promise.all([
      users(c.env).get(c.get('ownerId')),
      Promise.all(
        raw.routeIds.map((id) => store(c.env).get(c.get('ownerId'), id)),
      ),
    ]);
    const records = loaded.filter((r) => r !== null);
    const routes = records.map((r) => r.route);
    const startedAt = now();
    const { window, ...riding } = raw.riding ?? {};
    const settings = validateInput(
      settingsSchema,
      mergeSettings({ ...raw, riding }, user?.settings),
    );
    const today = localDate(startedAt, settings.timeZone);
    const selection = raw.days
      ? resolvePlanningDays(raw.days, settings.timeZone, startedAt)
      : {
          dates: raw.date ? [raw.date] : [],
          expired: false,
          range: raw.date
            ? {
                start: raw.date,
                end: raw.date,
                dates: [raw.date],
                preset: null,
                fallback: false,
              }
            : null,
        };
    const previewDates =
      raw.previewDays && !selection.expired
        ? datesBetween(
            today.toString(),
            today.add({ days: raw.previewDays - 1 }).toString(),
          )
        : [];
    const dates = [...new Set([...selection.dates, ...previewDates])].sort();
    const makeInput = (date: string, evaluate = true) =>
      validateInput(
        resolvedRecommendationSchema,
        recommendationWithSettings(
          {
            ...raw,
            date,
            riding: {
              ...riding,
              window: evaluate
                ? (window ?? (raw.days ? settings.planning.window : 'daylight'))
                : 'daylight',
            },
          },
          settings,
        ),
      );
    const inputs = dates.map((date) => makeInput(date));
    const input = inputs[0] ?? makeInput(today.toString(), false);
    if (routes.length !== raw.routeIds.length)
      throw new AppError(
        404,
        'ROUTE_NOT_FOUND',
        'One or more routes were not found.',
      );
    const comparison = await evaluateComparisons(routes, inputs, input, {
      env: c.env,
      ownerId: c.get('ownerId'),
      signal: c.req.raw.signal,
      now,
      startedAt,
      refreshDates: selection.dates,
      dependencies,
    });
    const daily = new Map(
      comparison.comparisons.map((item) => [item.input.date, item.result]),
    );
    const summaries = comparison.comparisons.map((item) => item.summary);
    const recent = input.preferences.recentRides;
    const selectedDates = selection.dates.filter(
      (date) =>
        !raw.days ||
        summaries.find((d) => d.date === date)?.availabilityReason !==
          'outside_forecast_horizon',
    );
    const resolvedRange = raw.days
      ? selectedDates.length
        ? {
            ...selection.range,
            start: selectedDates[0],
            end: selectedDates.at(-1),
            dates: selectedDates,
          }
        : null
      : selection.range;
    const evaluated = mergeDays(
      selectedDates.flatMap((date) => {
        const day = daily.get(date);
        return day ? [day] : [];
      }),
      Object.keys(input.preferences.minimumStandards).length > 0,
    );
    const evaluation = raw.date
      ? (daily.get(raw.date) ?? evaluated)
      : evaluated;
    const scoreChanges = await rememberScoreChanges(
      evaluation,
      routes,
      raw.days ?? { kind: 'dates', dates: [input.date] },
      input,
      comparison.weather.selectedSource,
      {
        ...comparison.history,
        affectedRouteIds: [...comparison.history.affectedRouteIds].sort(),
        affectedRideIds: [...comparison.history.affectedRideIds].sort(),
      },
      c.get('ownerId'),
      startedAt,
      dependencies.scoreChanges ?? createScoreChangeStore(c.env.ROUTES_DB),
    );
    const refs = await issueReferences(
      c.env.ROUTES_DB,
      c.get('ownerId'),
      contextFor(
        comparison,
        inputs.filter((i) => selection.dates.includes(i.date)),
        records,
        startedAt.toISOString(),
        evaluation,
      ),
      evaluation.rankings.flatMap((r) =>
        r.best
          ? [r.best, ...r.alternatives].map((candidate) => ({
              routeId: r.routeId,
              candidate,
            }))
          : [],
      ),
    );
    const dayRefs = new Map<string, Map<string, string>>();
    for (const item of comparison.comparisons) {
      const best = item.result.rankings[0];
      dayRefs.set(
        item.input.date,
        await issueReferences(
          c.env.ROUTES_DB,
          c.get('ownerId'),
          contextFor(
            comparison,
            [item.input],
            records,
            startedAt.toISOString(),
            item.result,
          ),
          best?.best ? [{ routeId: best.routeId, candidate: best.best }] : [],
        ),
      );
    }
    return c.json({
      ...evaluation,
      rankings: evaluation.rankings.map((r) => ({
        ...presentRoute(r, input.riding.departureStepMinutes),
        best: r.best
          ? {
              ...withReference(r.best, r.routeId, refs),
              scoreChange: scoreChanges.get(r.routeId) ?? null,
            }
          : null,
        alternatives: r.alternatives.map((a) =>
          withReference(a, r.routeId, refs),
        ),
        rank: r.rank,
      })),
      unranked: evaluation.unranked.map((r) => ({
        ...presentRoute(r, input.riding.departureStepMinutes),
        best: r.best
          ? { ...r.best, scoreChange: scoreChanges.get(r.routeId) ?? null }
          : null,
      })),
      recommendation: evaluation.recommendedRouteId
        ? {
            routeId: evaluation.recommendedRouteId,
            kind:
              evaluation.minimumStandardsStatus === 'match_found' ||
              evaluation.minimumStandardsStatus === 'not_configured'
                ? 'best_pick'
                : 'best_available',
          }
        : null,
      range: resolvedRange,
      expired: selection.expired,
      ...(selection.expired
        ? { message: 'These dates have passed. Choose available dates.' }
        : raw.days && !selectedDates.length
          ? {
              message:
                'Forecasts for the selected dates are not available yet.',
            }
          : {}),
      previewRange: previewDates.length
        ? { start: previewDates[0], end: previewDates.at(-1) }
        : null,
      days: summaries.map((d) => ({
        ...d,
        best:
          d.best && d.recommendedRouteId
            ? withReference(
                d.best,
                d.recommendedRouteId,
                dayRefs.get(d.date) ?? new Map(),
              )
            : null,
        selected: selectedDates.includes(d.date),
      })),
      history: comparison.history,
      generatedAt: startedAt.toISOString(),
      date: raw.date ?? null,
      timeZone: input.timeZone,
      savedUser: user ? { id: user.id, version: user.version } : null,
      resolvedPreferences: input.preferences,
      preferenceLevels: preferenceLevels(input.preferences),
      resolvedMinimumTemperatures: Object.fromEntries(
        inputs.map((i) => [i.date, resolveMinimumTemperature(i)]),
      ),
      resolvedMinimumTemperature: resolveMinimumTemperature(input),
      riding: input.riding,
      forecast: input.forecast,
      assumptions: [
        ...(recent.mode === 'prefer-variety'
          ? [
              'Recent rides assume the saved route was followed. Shared paths in either direction reduce the combined score by up to 10 points, fading over the configured period. Missing overlap evidence disables this adjustment for the whole comparison.',
            ]
          : []),
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
              'Sunshine comfort uses forecast weather symbols: sunny, sunny intervals or other conditions. Category shares describe route sections, not sunshine duration or probability. Unknown symbols remain missing and contribute neutral comfort (0.5) only in the combined score; sunshineAssessment reports the unknown distance fraction. They do not block otherwise usable forecast coverage.',
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
        'Temperature is interpolated between adjacent hourly readings; its reported range and personal limits include departure, finish and intervening forecast times. Missing readings are not bridged. Other instant forecasts and short wind means use the nearest hourly validity, up to 30 minutes away. Full-hour means, gusts and precipitation probabilities retain their native period bounds. An hourly precipitation amount is converted to an hourly average rate when supplied by the provider.',
        'Comfort weights are provisional. Weather score combines 75% distance-weighted mean comfort and 25% worst sampled comfort; it is not a probability.',
        'Precipitation includes rain, snow and other forms. The highest local hourly probability is not the probability of precipitation anywhere on the whole ride.',
      ],
      weather: comparison.weather,
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
const app = createApp();
export default {
  fetch: app.fetch,
  scheduled: async (_controller: ScheduledController, env: Env) => {
    await Promise.all([
      dispatchMonitoring(env),
      cleanStravaFlows(env.ROUTES_DB),
      dispatchImports(env),
    ]);
  },
  queue: async (batch: MessageBatch<unknown>, env: Env) => {
    for (const message of batch.messages) {
      try {
        if (await consumeStravaMessage(message.body, env)) message.ack();
        else await consumeMonitoring({ ...batch, messages: [message] }, env);
      } catch {
        message.retry({ delaySeconds: 900 });
      }
    }
  },
} satisfies ExportedHandler<Env>;
