import { expect, test } from 'bun:test';
import { unauthorized } from '../src/identity/access.ts';
import { createApp } from '../src/index.ts';
import { ALGORITHM_VERSION } from '../src/recommendations/engine.ts';
import type { Route } from '../src/routes/model.ts';
import { type RouteStore, storedRouteSummary } from '../src/routes/store.ts';
import type { Env } from '../src/types.ts';
import type { ForecastProvider } from '../src/weather/contracts.ts';
import { forecastsFor, now, simpleGpx } from './fixtures/rides.ts';

const aliceToken = 'a'.repeat(40);
const bobToken = 'b'.repeat(40);
const env = {} as Env;
test('health identifies the deployed build without authentication or weather calls', async () => {
  const app = createApp({ log: false });
  for (const tag of [undefined, '', 'synthetic-commit-sha']) {
    const response = await app.request('/health', {}, {
      ...(tag === undefined
        ? {}
        : {
            CF_VERSION_METADATA: {
              id: 'synthetic-worker-version',
              tag,
              timestamp: '2026-10-11T00:00:00.000Z',
            },
          }),
    } as Env);
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect((await response.json()) as Record<string, unknown>).toEqual({
      ok: true,
      version: '0.32.0',
      algorithmVersion: ALGORITHM_VERSION,
      revision: tag || null,
    });
  }
});
const setup = () => {
  const routes = new Map<string, Route>();
  const cache = new Map<string, string>();
  let calls = 0;
  const store: RouteStore = {
    save: async (owner, route) => {
      routes.set(`${owner}:${route.id}`, route);
    },
    getMany: async (owner, ids) =>
      ids.flatMap((id) => {
        const route = routes.get(`${owner}:${id}`);
        return route ? [route] : [];
      }),
    list: async (owner) => ({
      routes: [...routes.entries()]
        .filter(([key]) => key.startsWith(`${owner}:`))
        .map(([, route]) =>
          storedRouteSummary({
            route,
            version: 1,
            source: null,
            updatedAt: route.createdAt,
          }),
        ),
      nextCursor: null,
    }),
    get: async (owner, id) => {
      const route = routes.get(`${owner}:${id}`);
      return route
        ? { route, version: 1, source: null, updatedAt: route.createdAt }
        : null;
    },
    findSource: async () => null,
    createImported: async () => {
      throw new Error('Use the D1 integration harness for imports.');
    },
    replaceImported: async () => {
      throw new Error('Use the D1 integration harness for imports.');
    },
  };
  const provider: ForecastProvider = {
    source: { providerId: 'fixture', productId: 'hourly', adapterVersion: '1' },
    getCapabilities: async () => ({
      available: [],
      maxLocationsPerUpstreamRequest: 1,
    }),
    getForecast: async (request) => {
      calls++;
      const all = forecastsFor([...routes.values()]);
      return request.locations.map((location) => {
        const found = all.find(
          (result) =>
            result.status !== 'unavailable' &&
            result.location.requested.id === location.id,
        );
        if (!found) throw new Error('Missing fixture');
        return found;
      });
    },
  };
  const app = createApp({
    // Unit tests isolate HTTP orchestration; real session verification and
    // owner persistence are covered against D1 in the integration suite.
    resolveAccess: async (request) => {
      const token = request.headers.get('Authorization');
      const ownerId =
        token === `Bearer ${aliceToken}`
          ? 'alice'
          : token === `Bearer ${bobToken}`
            ? 'bob'
            : null;
      if (!ownerId) throw unauthorized();
      return { ownerId, headers: new Headers() };
    },
    routeStore: store,
    userStore: {
      get: async () => null,
      create: async () => false,
      update: async () => false,
    },
    providers: { fixture: provider },
    scoreBaselines: async () => new Map(),
    cache: {
      get: async (key) => cache.get(key) ?? null,
      put: async (key, value) => {
        cache.set(key, value);
      },
    },
    now: () => now,
    log: false,
  });
  const send = (
    path: string,
    token = aliceToken,
    data?: unknown,
    contentType = 'application/json',
  ) =>
    app.request(
      path,
      {
        method: data === undefined ? 'GET' : 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': contentType,
        },
        ...(data === undefined
          ? {}
          : { body: typeof data === 'string' ? data : JSON.stringify(data) }),
      },
      env,
    );
  const upload = async () => {
    const response = await send(
      '/routes',
      aliceToken,
      simpleGpx,
      'application/gpx+xml',
    );
    expect(response.status).toBe(201);
    return (await response.json()) as { route: { id: string } };
  };
  return { app, send, upload, calls: () => calls };
};
test('upload, list and recommendation endpoints work with a replaceable provider and cached preferences', async () => {
  const { send, upload, calls } = setup();
  const { route } = await upload();
  const listed = await send('/routes');
  expect(((await listed.json()) as { routes: unknown[] }).routes).toHaveLength(
    1,
  );
  const body = {
    routeIds: [route.id],
    date: '2026-10-10',
    weather: { mode: 'strict', providerId: 'fixture' },
  };
  const first = await send('/recommendations', aliceToken, body);
  expect(first.status).toBe(200);
  const result = (await first.json()) as {
    recommendedRouteId: string;
    riding: { averageSpeedKph: number };
    weather: { cache: { misses: number }; refreshAt: string | null };
  };
  expect(result.recommendedRouteId).toBe(route.id);
  expect(result.riding.averageSpeedKph).toBe(20);
  expect(result.weather.cache.misses).toBe(2);
  // Tomorrow's forecast, retrieved and run at noon: fresh for six hours.
  expect(result.weather.refreshAt).toBe('2026-10-09T18:00:00.000Z');
  const second = await send('/recommendations', aliceToken, {
    ...body,
    preferences: { temperature: { comfortMinC: 12 } },
  });
  expect(second.status).toBe(200);
  expect(calls()).toBe(1);
  expect(
    ((await second.json()) as { weather: { cache: { hits: number } } }).weather
      .cache.hits,
  ).toBe(2);
});
test('authentication and route ownership apply to all private endpoints', async () => {
  const { app, send, upload, calls } = setup();
  const { route } = await upload();
  expect((await app.request('/health', {}, env)).status).toBe(200);
  for (const path of ['/routes', '/recommendations'])
    expect(
      (await send(path, 'x'.repeat(40), path === '/routes' ? undefined : {}))
        .status,
    ).toBe(401);
  expect((await send('/routes', bobToken)).status).toBe(200);
  expect(
    ((await (await send('/routes', bobToken)).json()) as { routes: unknown[] })
      .routes,
  ).toHaveLength(0);
  expect(
    (
      await send('/recommendations', bobToken, {
        routeIds: [route.id],
        date: '2026-10-10',
      })
    ).status,
  ).toBe(404);
  expect(calls()).toBe(0);
});
test('route geometry is owner-scoped and the app association is public', async () => {
  const { app, send, upload } = setup();
  const { route } = await upload();
  const response = await send(`/routes/${route.id}/geometry`);
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    routeId: string;
    version: number;
    geometry: { encoding: string; pointCount: number } | null;
  };
  expect(body.routeId).toBe(route.id);
  expect(body.version).toBe(1);
  expect(body.geometry?.encoding).toBe('polyline6');
  expect((await send(`/routes/${route.id}/geometry`, bobToken)).status).toBe(
    404,
  );
  const association = await app.request(
    '/.well-known/apple-app-site-association',
    {},
    env,
  );
  expect(association.status).toBe(200);
  expect(association.headers.get('Content-Type')).toContain('application/json');
  expect((await association.json()) as unknown).toEqual({
    webcredentials: { apps: ['R2GGK3VN2C.com.danbarclay.rideon'] },
  });
});
test('invalid dates, unknown preference fields, invalid pace and oversized requests fail before upstream use', async () => {
  const { send, upload, calls } = setup();
  const { route } = await upload();
  const body = { routeIds: [route.id], date: '2026-10-10' };
  for (const changes of [
    { date: '2026-02-30' },
    { timeZone: 'Invalid/Place' },
    { riding: { averageSpeedKph: 0 } },
    { preferences: { minimumStandards: { minimumTemprature: 10 } } },
  ])
    expect(
      (await send('/recommendations', aliceToken, { ...body, ...changes }))
        .status,
    ).toBe(400);
  expect(
    (await send('/recommendations', aliceToken, 'x'.repeat(65_000))).status,
  ).toBe(413);
  expect(
    (await send('/routes', aliceToken, '<broken>', 'application/gpx+xml'))
      .status,
  ).toBe(422);
  expect(calls()).toBe(0);
});
test('multipart uploads and past-day no-feasible responses work without weather calls', async () => {
  const { app, send, calls } = setup();
  const form = new FormData();
  form.set('file', new File([simpleGpx], 'ride.gpx'));
  form.set('name', 'My route');
  const uploaded = await app.request(
    '/routes',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${aliceToken}` },
      body: form,
    },
    env,
  );
  expect(uploaded.status).toBe(201);
  const data = (await uploaded.json()) as {
    route: { id: string; name: string };
  };
  expect(data.route.name).toBe('My route');
  const result = await send('/recommendations', aliceToken, {
    routeIds: [data.route.id],
    date: '2026-10-01',
  });
  expect(
    ((await result.json()) as { recommendedRouteId: string | null })
      .recommendedRouteId,
  ).toBeNull();
  expect(calls()).toBe(0);
});
