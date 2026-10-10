import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { authenticate } from './auth.ts';
import { readBoundedBody } from './body.ts';
import { AppError } from './errors.ts';
import { planDepartures } from './recommendations/daylight.ts';
import {
  recommendRides,
  requiredWeatherFor,
} from './recommendations/engine.ts';
import {
  recommendationSchema,
  resolveMinimumTemperature,
} from './recommendations/input.ts';
import { readJsonBody } from './request.ts';
import { importGpx } from './routes/gpx.ts';
import {
  createD1RouteStore,
  type RouteStore,
  routeSummary,
} from './routes/model.ts';
import type { Bindings, Env } from './types.ts';
import { type ForecastCache, withForecastCache } from './weather/cache.ts';
import type { ForecastProvider, ForecastRequest } from './weather/contracts.ts';
import { createMetOfficeBpf } from './weather/met-office-bpf.ts';
import { createMetOfficeGlobalSpot } from './weather/met-office-global-spot.ts';
import { getForecastForPolicy } from './weather/source-policy.ts';

const HOUR = 3_600_000;
const quality = {
  maxTimeStepSeconds: 3600,
  maxLocationDistanceM: 10_000,
  maxAgeSeconds: 6 * 3600,
};
export const createApp = (
  dependencies: {
    routeStore?: RouteStore;
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
  app.use('*', async (c, next) => {
    const start = Date.now();
    c.header('Cache-Control', 'no-store');
    await next();
    if (dependencies.log !== false)
      console.log(
        `${c.req.method} ${new URL(c.req.url).pathname} ${c.res.status} ${Date.now() - start}ms`,
      );
  });
  app.get('/health', (c) => c.json({ ok: true, version: '0.2.0' }));
  for (const path of ['/routes', '/recommendations'])
    app.use(path, async (c, next) => {
      c.set(
        'ownerId',
        await authenticate(c.req.header('Authorization'), c.env.API_KEYS_JSON),
      );
      await next();
    });
  app.get('/routes', async (c) =>
    c.json({ routes: await store(c.env).list(c.get('ownerId')), limit: 100 }),
  );
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
    return c.json({ route: routeSummary(route) }, 201);
  });
  app.post('/recommendations', async (c) => {
    const input = await readJsonBody(c, recommendationSchema);
    const routes = await store(c.env).getMany(c.get('ownerId'), input.routeIds);
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
    const feasible = plans.filter(({ plan }) => plan.departures.length > 0);
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
    const configured = dependencies.providers ?? {
      'met-office-bpf': createMetOfficeBpf({
        apiKey: c.env.MET_OFFICE_BPF_API_KEY ?? '',
        now,
        cache,
      }),
      'met-office': createMetOfficeGlobalSpot({
        apiKey: c.env.MET_OFFICE_API_KEY ?? '',
        now,
      }),
    };
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
      resolvedPreferences: input.preferences,
      resolvedMinimumTemperature: resolveMinimumTemperature(input),
      riding: input.riding,
      forecast: input.forecast,
      assumptions: [
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
        'Conditions are evaluated at the midpoint of each route section of up to 500 metres, using weather locations at most 10 km apart.',
        'Instant forecasts and short wind means use the nearest hourly validity, up to 30 minutes away. Gusts and precipitation probabilities retain their native period bounds.',
        'Comfort weights are provisional. Score combines 75% distance-weighted mean comfort and 25% worst sampled comfort; it is not a probability.',
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
