import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exportPKCS8, generateKeyPair } from 'jose';
import { HttpResponse, http } from 'msw/http';
import { z } from 'zod';
import { conditionsSchema } from '../src/recommendations/conditions.ts';
import { userSchema } from '../src/users/model.ts';
import { appleWeatherFixture } from '../test/fixtures/apple-weather.ts';
import { first, upload } from './client.ts';
import { blendedForecast, metOffice } from './fixtures.ts';
import { BOB_TOKEN, createHarness, type Harness } from './harness.ts';

const keys = await generateKeyPair('ES256', { extractable: true });
const config = JSON.stringify({
  teamId: 'TESTTEAM01',
  keyId: 'TESTKEY001',
  serviceId: 'cc.ride-on.test',
  privateKey: await exportPKCS8(keys.privateKey),
});
const apple = () =>
  http.get(
    'https://weatherkit.apple.com/api/v1/weather/en/:latitude/:longitude',
    ({ params }) =>
      HttpResponse.json(
        appleWeatherFixture({
          latitude: Number(params.latitude),
          longitude: Number(params.longitude),
        }),
      ),
  );
const integration = (name: string, run: (h: Harness) => Promise<void>) =>
  test(name, { timeout: 30_000 }, async () => {
    const h = await createHarness();
    try {
      await h.restart({ APPLE_WEATHER_CONFIG_JSON: config });
      await run(h);
    } finally {
      await h.dispose();
      assert.deepEqual(h.unexpected, []);
      assert.deepEqual(h.handlerErrors, []);
    }
  });
const user = userSchema
  .extend({ weatherProviderId: z.string().nullable() })
  .strip();
const readUser = async (r: { json(): Promise<unknown> }) =>
  z.object({ user }).parse(await r.json()).user;
const weather = z.object({
  requestedProviderId: z.string().nullable(),
  selectedProvider: z.object({ id: z.string(), name: z.string() }).nullable(),
  selectedSource: z
    .object({ providerId: z.string(), productId: z.string() })
    .nullable(),
  attempts: z.array(
    z.object({
      source: z.object({ providerId: z.string() }),
      status: z.string(),
    }),
  ),
  fallback: z
    .object({ reason: z.string(), retryAt: z.string().nullable() })
    .nullable(),
});
const result = z.object({
  recommendedRouteId: z.string().nullable(),
  weather,
  forecast: userSchema.shape.settings.shape.forecast,
  rankings: z.array(
    z.object({
      best: z.object({ score: z.number(), conditions: conditionsSchema }),
    }),
  ),
});
const recommend = async (
  h: Harness,
  routeId: string,
  extra: Record<string, unknown> = {},
) => {
  const r = await h.send('/recommendations', {
    body: JSON.stringify({ routeIds: [routeId], date: '2026-10-10', ...extra }),
  });
  assert.equal(r.status, 200, await r.clone().text());
  return result.parse(await r.json());
};

integration(
  'simple Met Office selection persists a compatible forecast preset and powers both recommendation endpoints without changing scores',
  async (h) => {
    h.use(blendedForecast());
    const created = await h.send('/users', {
      body: JSON.stringify({
        displayName: 'Rider',
        settings: {
          weatherProviderId: 'met-office',
          preferences: { distance: { minKm: 20, maxKm: 60 } },
        },
      }),
    });
    assert.equal(created.status, 201);
    const saved = await readUser(created);
    assert.equal(saved.weatherProviderId, 'met-office');
    assert.deepEqual(saved.settings.weather, {
      mode: 'strict',
      providerId: 'met-office-bpf',
    });
    assert.deepEqual(saved.settings.forecast, {
      representation: 'ensemble-summary',
      freshnessBasis: 'retrieval-time',
    });
    assert.deepEqual(saved.settings.preferences.distance, {
      minKm: 20,
      maxKm: 60,
    });
    const route = await upload(h);
    const rec = await recommend(h, route.id);
    assert.equal(rec.recommendedRouteId, route.id);
    assert.deepEqual(rec.weather.selectedProvider, {
      id: 'met-office',
      name: 'Met Office',
    });
    assert.equal(rec.weather.selectedSource?.providerId, 'met-office-bpf');
    assert.equal(rec.weather.requestedProviderId, 'met-office');
    const calls = h.requests.length;
    await h.restart();
    assert.deepEqual(await readUser(await h.send('/users/me')), saved);
    const advanced = await recommend(h, route.id, {
      weather: saved.settings.weather,
      forecast: saved.settings.forecast,
    });
    assert.deepEqual(advanced.rankings, rec.rankings);
    const next = await h.send('/recommendations/next-windows', {
      body: JSON.stringify({
        routeIds: [route.id],
        after: { date: '2026-10-09', window: 'daylight' },
        weatherProviderId: 'met-office',
      }),
    });
    assert.equal(next.status, 200);
    const nextResult = z
      .object({
        windows: z.array(z.object({ best: z.object({ routeId: z.string() }) })),
        weather,
      })
      .parse(await next.json());
    assert.equal(first(nextResult.windows).best.routeId, route.id);
    assert.equal(nextResult.weather.selectedProvider?.id, 'met-office');
    assert.equal(h.requests.length, calls);
    assert.ok(
      h.requests.every((r) => r.url.includes('mo-blended-prob-forecast')),
    );
  },
);

integration(
  'legacy Met Office products display one provider without rewriting preferences or silently upgrading their source',
  async (h) => {
    h.use(metOffice());
    const settings = {
      weather: { mode: 'strict', providerId: 'met-office' },
      forecast: {
        representation: 'deterministic',
        freshnessBasis: 'model-run',
      },
    };
    const saved = await readUser(
      await h.send('/users', {
        body: JSON.stringify({ displayName: 'Existing rider', settings }),
      }),
    );
    assert.equal(saved.weatherProviderId, 'met-office');
    await h.restart();
    const renamed = await h.send('/users/me', {
      method: 'PATCH',
      body: JSON.stringify({ expectedVersion: 1, displayName: 'Renamed' }),
    });
    assert.equal(renamed.status, 200);
    assert.deepEqual((await readUser(renamed)).settings, saved.settings);
    const route = await upload(h);
    const rec = await recommend(h, route.id);
    assert.equal(rec.weather.selectedProvider?.name, 'Met Office');
    assert.equal(rec.weather.selectedSource?.providerId, 'met-office');
    assert.deepEqual(rec.forecast, settings.forecast);
    assert.ok(h.requests.every((r) => r.url.includes('/sitespecific/')));
    const other = await readUser(
      await h.send('/users', {
        token: BOB_TOKEN,
        body: JSON.stringify({ displayName: 'New rider' }),
      }),
    );
    assert.equal(other.weatherProviderId, 'apple-weather');
  },
);

integration(
  'simple switches reset incompatible technical settings while temporary overrides never overwrite a saved choice',
  async (h) => {
    h.use(blendedForecast(), apple());
    const saved = await readUser(
      await h.send('/users', {
        body: JSON.stringify({
          displayName: 'Rider',
          settings: { weatherProviderId: 'met-office' },
        }),
      }),
    );
    const route = await upload(h);
    const temporary = await recommend(h, route.id, {
      weatherProviderId: 'apple-weather',
    });
    assert.equal(temporary.recommendedRouteId, route.id);
    assert.deepEqual(temporary.forecast, {
      representation: 'deterministic',
      freshnessBasis: 'retrieval-time',
    });
    assert.equal(temporary.weather.selectedProvider?.id, 'apple-weather');
    assert.deepEqual(await readUser(await h.send('/users/me')), saved);
    const changed = await h.send('/users/me', {
      method: 'PATCH',
      body: JSON.stringify({
        expectedVersion: saved.version,
        settings: { weatherProviderId: 'apple-weather' },
      }),
    });
    assert.equal(changed.status, 200);
    const updated = await readUser(changed);
    assert.equal(updated.weatherProviderId, 'apple-weather');
    assert.deepEqual(updated.settings.preferences, saved.settings.preferences);
    assert.deepEqual(updated.settings.forecast, temporary.forecast);
    const conflict = await h.send('/users/me', {
      method: 'PATCH',
      body: JSON.stringify({
        expectedVersion: saved.version,
        settings: { weatherProviderId: 'met-office' },
      }),
    });
    assert.equal(conflict.status, 409);
    assert.deepEqual(await readUser(await h.send('/users/me')), updated);
  },
);

integration(
  'missing BPF configuration or upstream failure is explicit and never silently uses a different weather product',
  async (h) => {
    await h.restart({ MET_OFFICE_BPF_API_KEY: '' });
    const catalogue = z
      .object({
        defaultProviderId: z.string(),
        providers: z.array(
          z.object({
            id: z.string(),
            name: z.string(),
            configured: z.boolean(),
          }),
        ),
      })
      .parse(await (await h.send('/weather-providers')).json());
    assert.deepEqual(
      catalogue.providers.map((p) => [p.id, p.name]),
      [
        ['apple-weather', 'Apple Weather'],
        ['met-office', 'Met Office'],
      ],
    );
    assert.equal(catalogue.defaultProviderId, 'apple-weather');
    assert.equal(
      catalogue.providers.find((p) => p.id === 'met-office')?.configured,
      false,
    );
    const route = await upload(h);
    assert.equal(
      (await recommend(h, route.id, { weatherProviderId: 'met-office' }))
        .recommendedRouteId,
      null,
    );
    assert.equal(h.requests.length, 0);
    await h.restart({
      MET_OFFICE_BPF_API_KEY: 'integration-bpf-key-not-a-real-secret',
    });
    h.use(
      http.get(
        'https://data.hub.api.metoffice.gov.uk/mo-blended-prob-forecast-feature-svc/2.0.0/collections/*',
        () => new HttpResponse(null, { status: 503 }),
      ),
    );
    const failure = await recommend(h, route.id, {
      weatherProviderId: 'met-office',
    });
    assert.equal(failure.recommendedRouteId, null);
    assert.equal(failure.weather.selectedProvider?.id, 'met-office');
    assert.ok(h.requests.length > 0);
    assert.ok(
      h.requests.every((r) => r.url.includes('mo-blended-prob-forecast')),
    );
  },
);

integration(
  'Met Office quota exhaustion moves the whole comparison to Apple Weather and says so',
  async (h) => {
    h.use(
      http.get(
        'https://data.hub.api.metoffice.gov.uk/mo-blended-prob-forecast-feature-svc/2.0.0/collections/*',
        () =>
          new HttpResponse(null, {
            status: 429,
            headers: { 'Retry-After': '600' },
          }),
      ),
      apple(),
    );
    const route = await upload(h);
    const rec = await recommend(h, route.id, {
      weatherProviderId: 'met-office',
    });
    assert.equal(rec.recommendedRouteId, route.id);
    assert.equal(rec.weather.requestedProviderId, 'met-office');
    assert.deepEqual(rec.weather.selectedProvider, {
      id: 'apple-weather',
      name: 'Apple Weather',
    });
    assert.deepEqual(rec.weather.fallback, {
      reason: 'rate-limited',
      retryAt: '2026-10-09T12:10:00.000Z',
    });
    // The Apple fixture covers one day, so its attempt can be partial.
    assert.deepEqual(
      rec.weather.attempts.map((a) => [
        a.source.providerId,
        a.status === 'unavailable',
      ]),
      [
        ['met-office-bpf', true],
        ['apple-weather', false],
      ],
    );
    assert.equal(rec.forecast.representation, 'deterministic');
    const windows = await h.send('/recommendations/next-windows', {
      body: JSON.stringify({
        routeIds: [route.id],
        after: { date: '2026-10-09', window: 'daylight' },
        weatherProviderId: 'met-office',
      }),
    });
    assert.equal(windows.status, 200, await windows.clone().text());
    const next = z
      .object({ weather, forecast: result.shape.forecast })
      .parse(await windows.json());
    assert.equal(next.weather.selectedProvider?.id, 'apple-weather');
    assert.equal(next.weather.fallback?.reason, 'rate-limited');
    assert.equal(next.forecast.representation, 'deterministic');
  },
);

integration(
  'unknown and ambiguous choices reject on create, patch and both recommendation endpoints before quota use',
  async (h) => {
    const saved = await readUser(
      await h.send('/users', {
        body: JSON.stringify({ displayName: 'Rider' }),
      }),
    );
    const route = await upload(h);
    for (const settings of [
      { weatherProviderId: 'met-office-bpf' },
      { weatherProviderId: 'unknown' },
      {
        weatherProviderId: 'met-office',
        weather: { mode: 'strict', providerId: 'apple-weather' },
      },
      { weatherProviderId: 'met-office', forecast: {} },
    ]) {
      const bodies = [
        ['/users', { displayName: 'Rider', settings }, 'POST'],
        ['/users/me', { expectedVersion: saved.version, settings }, 'PATCH'],
        [
          '/recommendations',
          { routeIds: [route.id], date: '2026-10-10', ...settings },
          'POST',
        ],
        [
          '/recommendations/next-windows',
          {
            routeIds: [route.id],
            after: { date: '2026-10-09', window: 'daylight' },
            ...settings,
          },
          'POST',
        ],
      ] as const;
      for (const [path, body, method] of bodies) {
        const response = await h.send(path, {
          method,
          body: JSON.stringify(body),
        });
        assert.equal(response.status, 400, await response.clone().text());
      }
    }
    assert.deepEqual(await readUser(await h.send('/users/me')), saved);
    assert.equal(h.requests.length, 0);
  },
);

integration(
  'advanced fallback policies keep a custom selection while exposing the provider actually selected',
  async (h) => {
    h.use(metOffice());
    const settings = {
      weather: {
        mode: 'ordered-fallback',
        providerIds: ['unconfigured', 'met-office'],
      },
      forecast: {
        representation: 'deterministic',
        freshnessBasis: 'retrieval-time',
      },
    };
    const saved = await readUser(
      await h.send('/users', {
        body: JSON.stringify({ displayName: 'Rider', settings }),
      }),
    );
    assert.equal(saved.weatherProviderId, null);
    const route = await upload(h);
    const rec = await recommend(h, route.id);
    assert.equal(rec.recommendedRouteId, route.id);
    assert.equal(rec.weather.requestedProviderId, null);
    assert.deepEqual(rec.weather.selectedProvider, {
      id: 'met-office',
      name: 'Met Office',
    });
    assert.equal(rec.weather.selectedSource?.providerId, 'met-office');
  },
);
