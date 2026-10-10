import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exportPKCS8, generateKeyPair, jwtVerify } from 'jose';
import { HttpResponse, http } from 'msw/http';
import { z } from 'zod';
import profile from '../../evaluation/sunshine-profile-v4.json' with {
  type: 'json',
};
import { userSchema } from '../src/users/model.ts';
import {
  APPLE_NOW,
  appleWeatherFixture,
} from '../test/fixtures/apple-weather.ts';
import { first, recommend, upload } from './client.ts';
import { metOffice } from './fixtures.ts';
import { BOB_TOKEN, createHarness, type Harness } from './harness.ts';

const keys = await generateKeyPair('ES256', { extractable: true });
const privateKey = await exportPKCS8(keys.privateKey);
const config = JSON.stringify({
  teamId: 'TESTTEAM01',
  keyId: 'TESTKEY001',
  serviceId: 'cc.ride-on.synthetic-weather',
  privateKey,
});
type Fixture = ReturnType<typeof appleWeatherFixture>;
const apple = (change?: (data: Fixture) => void, now = APPLE_NOW) =>
  http.get(
    'https://weatherkit.apple.com/api/v1/weather/en/:latitude/:longitude',
    async ({ request, params }) => {
      assert.equal(
        new URL(request.url).searchParams.get('dataSets'),
        'forecastHourly',
      );
      const token = request.headers.get('Authorization')?.slice(7);
      assert.ok(token);
      const verified = await jwtVerify(token, keys.publicKey, {
        issuer: 'TESTTEAM01',
        subject: 'cc.ride-on.synthetic-weather',
        currentDate: new Date(now),
        algorithms: ['ES256'],
      });
      assert.equal(
        verified.protectedHeader.id,
        'TESTTEAM01.cc.ride-on.synthetic-weather',
      );
      assert.equal(verified.protectedHeader.kid, 'TESTKEY001');
      const data = appleWeatherFixture({
        latitude: Number(params.latitude),
        longitude: Number(params.longitude),
        now,
      });
      change?.(data);
      return HttpResponse.json(data);
    },
  );
const integration = (name: string, run: (h: Harness) => Promise<void>) =>
  test(name, { timeout: 20000 }, async () => {
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
const readUser = async (r: { json: () => Promise<unknown> }) =>
  z.object({ user: userSchema.strip() }).parse(await r.json()).user;
const createUser = async (
  h: Harness,
  settings: Record<string, unknown> = {},
  token?: string,
) => {
  const r = await h.send('/users', {
    token,
    body: JSON.stringify({ displayName: 'Rider', settings }),
  });
  assert.equal(r.status, 201);
  return readUser(r);
};

integration(
  'Apple is the default before profile creation and for new users; GPX recommendations and branding survive cache restart',
  async (h) => {
    h.use(apple());
    const uploaded = await h.send('/routes', {
      contentType: 'application/gpx+xml',
      body: `<gpx version="1.1"><trk><trkseg>${Array.from({ length: 13 }, (_, i) => `<trkpt lat="${51.2 + i * 0.03}" lon="-1"><ele>50</ele></trkpt>`).join('')}</trkseg></trk></gpx>`,
    });
    assert.equal(uploaded.status, 201);
    const { route } = z
      .object({ route: z.object({ id: z.string() }) })
      .parse(await uploaded.json());
    const initial = await recommend(h, [route.id]);
    assert.equal(initial.savedUser, null);
    assert.equal(initial.weather.selectedSource?.providerId, 'apple-weather');
    assert.equal(first(initial.rankings).departuresUnknown, 0);
    assert.equal(
      first(initial.rankings).best.conditions.averageWindSpeedKph,
      7.2,
    );
    assert.equal(first(initial.rankings).best.conditions.maximumGustKph, 14.4);
    assert.equal(
      first(initial.rankings).best.conditions.maximumPrecipitationProbability,
      0.08,
    );
    const user = await createUser(h, {
      preferences: {
        distance: { minKm: 30, maxKm: 60 },
        climbing: { preference: 'flatter' },
      },
    });
    assert.deepEqual(user.settings.weather, {
      mode: 'strict',
      providerId: 'apple-weather',
    });
    assert.deepEqual(user.settings.forecast, {
      representation: 'deterministic',
      freshnessBasis: 'retrieval-time',
    });
    const calls = h.requests.length;
    assert.ok(calls > 0);
    await h.restart();
    const saved = await recommend(h, [route.id]);
    assert.equal(saved.weather.cache.misses, 0);
    assert.equal(h.requests.length, calls);
    const attribution = first(
      first(saved.weather.locations).provenance?.attribution ?? [],
    );
    assert.equal(attribution.text, 'Apple Weather');
    assert.match(
      attribution.logo?.lightUrl ?? '',
      /^https:\/\/weatherkit\.apple\.com\//,
    );
    assert.ok(attribution.notice?.includes('derived'));
    assert.equal(first(saved.rankings).best.factors.distance, 100);
    assert.equal(first(saved.rankings).best.factors.climbing !== null, true);
  },
);

integration(
  'the existing Met Office profile stays intact while another new user defaults to Apple; overrides do not save',
  async (h) => {
    h.use(apple());
    const saved = await createUser(h, {
      preferences: profile.request.preferences,
      weather: profile.request.weather,
      forecast: profile.request.forecast,
    });
    assert.equal(saved.settings.weather.mode, 'strict');
    assert.deepEqual(saved.settings.weather, {
      mode: 'strict',
      providerId: 'met-office-bpf',
    });
    const other = await createUser(h, {}, BOB_TOKEN);
    assert.deepEqual(other.settings.weather, {
      mode: 'strict',
      providerId: 'apple-weather',
    });
    await h.restart();
    const rename = await h.send('/users/me', {
      method: 'PATCH',
      body: JSON.stringify({ expectedVersion: 1, displayName: 'Renamed' }),
    });
    const renamed = await readUser(rename);
    assert.deepEqual(renamed.settings, saved.settings);
    const route = await upload(h);
    const result = await recommend(h, [route.id], {
      weather: { mode: 'strict', providerId: 'apple-weather' },
      forecast: {
        representation: 'deterministic',
        freshnessBasis: 'retrieval-time',
      },
    });
    assert.equal(result.weather.selectedSource?.providerId, 'apple-weather');
    assert.equal(result.recommendedRouteId, route.id);
    assert.deepEqual(result.resolvedPreferences, saved.settings.preferences);
    assert.deepEqual(await readUser(await h.send('/users/me')), renamed);
  },
);

integration(
  'provider discovery offers compatible presets and selecting one swaps the real weather adapter',
  async (h) => {
    h.use(apple(), metOffice());
    assert.equal(
      (await h.send('/weather-providers', { token: null })).status,
      401,
    );
    const r = await h.send('/weather-providers');
    assert.equal(r.status, 200);
    const body = await r.text();
    assert.ok(!body.includes('PRIVATE KEY') && !body.includes('TESTKEY001'));
    const catalogue = z
      .object({
        defaultPolicy: z.object({ providerId: z.string() }),
        providers: z.array(
          z.object({
            id: z.string(),
            name: z.string(),
            configured: z.boolean(),
            recommendedSettings: z.object({
              weather: z.object({
                mode: z.literal('strict'),
                providerId: z.string(),
              }),
              forecast: z.object({
                representation: z.string(),
                freshnessBasis: z.string(),
              }),
            }),
          }),
        ),
      })
      .parse(JSON.parse(body));
    assert.equal(catalogue.defaultPolicy.providerId, 'apple-weather');
    assert.deepEqual(
      catalogue.providers.map((p) => p.id),
      ['apple-weather', 'met-office', 'met-office-bpf'],
    );
    assert.ok(catalogue.providers.every((p) => p.configured));
    await createUser(h);
    const route = await upload(h);
    await recommend(h, [route.id]);
    const chosen = first(
      catalogue.providers.filter((p) => p.id === 'met-office'),
    );
    const patch = await h.send('/users/me', {
      method: 'PATCH',
      body: JSON.stringify({
        expectedVersion: 1,
        settings: chosen.recommendedSettings,
      }),
    });
    assert.equal(patch.status, 200);
    await h.restart();
    const result = await recommend(h, [route.id]);
    assert.equal(result.weather.selectedSource?.providerId, 'met-office');
    assert.equal(result.recommendedRouteId, route.id);
    assert.ok(
      h.requests.some(
        (r) => new URL(r.url).hostname === 'weatherkit.apple.com',
      ),
    );
    assert.ok(
      h.requests.some(
        (r) => new URL(r.url).hostname === 'data.hub.api.metoffice.gov.uk',
      ),
    );
  },
);

integration(
  'strict Apple quota failure stays unknown; only an explicit fallback can use Met Office, and failure is not cached',
  async (h) => {
    const rejected = http.get(
      'https://weatherkit.apple.com/api/v1/weather/*',
      () =>
        new HttpResponse('private-upstream-error', {
          status: 429,
          headers: { 'Retry-After': '60' },
        }),
    );
    h.use(rejected, metOffice());
    const route = await upload(h);
    const preferences = { minimumStandards: { maximumGustKph: 40 } };
    const strict = await recommend(h, [route.id], { preferences });
    assert.equal(strict.recommendedRouteId, null);
    assert.equal(strict.minimumStandardsStatus, 'unknown');
    assert.equal(
      first(first(strict.weather.locations).issues).retryAfterSeconds,
      60,
    );
    assert.ok(
      h.requests.every(
        (r) => new URL(r.url).hostname === 'weatherkit.apple.com',
      ),
    );
    assert.ok(!JSON.stringify(strict).includes('private-upstream-error'));
    const fallback = await recommend(h, [route.id], {
      preferences,
      weather: {
        mode: 'ordered-fallback',
        providerIds: ['apple-weather', 'met-office'],
      },
    });
    assert.equal(fallback.weather.selectedSource?.providerId, 'met-office');
    assert.equal(fallback.weather.attempts.length, 2);
    h.use(apple(), metOffice());
    const recovered = await recommend(h, [route.id]);
    assert.equal(recovered.weather.selectedSource?.providerId, 'apple-weather');
    assert.equal(recovered.recommendedRouteId, route.id);
  },
);

integration(
  'missing Apple gusts or precipitation cannot produce calm or dry recommendations',
  async (h) => {
    h.use(
      apple((data) => {
        for (const row of data.forecastHourly.hours) {
          const missing: Record<string, unknown> = row;
          delete missing.windGust;
          delete missing.precipitationAmount;
        }
      }),
    );
    const route = await upload(h);
    const result = await recommend(h, [route.id], {
      preferences: { minimumStandards: { maximumGustKph: 40 } },
    });
    assert.equal(result.recommendedRouteId, null);
    assert.equal(result.minimumStandardsStatus, 'unknown');
    assert.equal(first(result.unranked).status, 'unassessable');
    assert.ok(
      result.weather.locations.every((l) =>
        l.issues.some((i) => i.code === 'missing-data'),
      ),
    );
  },
);

integration(
  'provider expiry refreshes cached forecasts after a Worker restart before the usual cache TTL',
  async (h) => {
    h.use(
      apple((data) => {
        data.forecastHourly.metadata.expireTime = '2026-10-09T12:10:00Z';
      }),
    );
    const route = await upload(h);
    await recommend(h, [route.id]);
    const calls = h.requests.length;
    await h.restart();
    await recommend(h, [route.id]);
    assert.equal(h.requests.length, calls);
    const later = '2026-10-09T12:11:00.000Z';
    await h.restart({ TEST_NOW: later });
    h.use(apple(undefined, later));
    const refreshed = await recommend(h, [route.id]);
    assert.equal(h.requests.length, calls * 2);
    assert.equal(refreshed.weather.cache.hits, 0);
    assert.equal(
      first(refreshed.weather.locations).provenance?.retrievedAt,
      later,
    );
  },
);

integration(
  'Apple forward-hour rain periods select a dry departure, while from-wind direction favours the tailwind route',
  async (h) => {
    h.use(
      apple((data) => {
        for (const row of data.forecastHourly.hours) {
          const wet =
            Date.parse(row.forecastStart) < Date.parse('2026-10-10T10:00:00Z');
          row.precipitationChance = wet ? 0.9 : 0;
          row.precipitationAmount = wet ? 2 : 0;
          row.windSpeed = 25;
        }
      }),
    );
    const north = await upload(h, 'Tailwind', -1);
    const south = await upload(h, 'Headwind', -1, true);
    const result = await recommend(h, [south.id, north.id], {
      riding: { window: { start: '09:00', end: '14:00' } },
    });
    assert.equal(result.recommendedRouteId, north.id);
    assert.equal(
      first(result.rankings).best.departureAt,
      '2026-10-10T10:00:00.000Z',
    );
    assert.equal(
      first(result.rankings).best.conditions.maximumPrecipitationProbability,
      0,
    );
    assert.equal(
      first(result.rankings).best.conditions.assistedDistanceFraction,
      1,
    );
    assert.equal(
      result.rankings[1]?.best.conditions.assistedDistanceFraction,
      0,
    );
  },
);

integration(
  'incompatible model-run or percentile requirements and unconfigured signing fail without upstream calls',
  async (h) => {
    const route = await upload(h);
    for (const forecast of [
      { freshnessBasis: 'model-run' },
      { representation: 'ensemble-summary' },
    ]) {
      const r = await recommend(h, [route.id], { forecast });
      assert.equal(r.recommendedRouteId, null);
    }
    await h.restart({ APPLE_WEATHER_CONFIG_JSON: '' });
    const missing = await recommend(h, [route.id]);
    assert.equal(
      first(first(missing.weather.locations).issues).code,
      'not-configured',
    );
    assert.equal(h.requests.length, 0);
  },
);

integration(
  'Apple redirects are not followed with the signing token',
  async (h) => {
    h.use(
      http.get(
        'https://weatherkit.apple.com/api/v1/weather/*',
        () =>
          new HttpResponse(null, {
            status: 302,
            headers: { Location: 'https://example.invalid/collect-token' },
          }),
      ),
    );
    const route = await upload(h);
    const result = await recommend(h, [route.id]);
    assert.equal(result.recommendedRouteId, null);
    assert.ok(
      h.requests.every(
        (r) => new URL(r.url).hostname === 'weatherkit.apple.com',
      ),
    );
    assert.equal(
      first(first(result.weather.locations).issues).code,
      'upstream-unavailable',
    );
  },
);
