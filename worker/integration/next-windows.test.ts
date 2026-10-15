import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exportPKCS8, generateKeyPair } from 'jose';
import { HttpResponse, http } from 'msw/http';
import { z } from 'zod';
import { conditionsSchema } from '../src/recommendations/conditions.ts';
import { ridingWindowSchema } from '../src/recommendations/planning.ts';
import { appleWeatherFixture } from '../test/fixtures/apple-weather.ts';
import { first, upload } from './client.ts';
import { hourlyForecast, metOffice } from './fixtures.ts';
import { BOB_TOKEN, createHarness, type Harness } from './harness.ts';

const keys = await generateKeyPair('ES256', { extractable: true });
const config = JSON.stringify({
  teamId: 'TESTTEAM01',
  keyId: 'TESTKEY001',
  serviceId: 'cc.ride-on.test',
  privateKey: await exportPKCS8(keys.privateKey),
});
type Fixture = ReturnType<typeof appleWeatherFixture>;
const apple = (
  change?: (data: Fixture) => void,
  now = '2026-10-09T12:00:00Z',
) =>
  http.get(
    'https://weatherkit.apple.com/api/v1/weather/en/:latitude/:longitude',
    ({ params, request }) => {
      const url = new URL(request.url);
      const data = appleWeatherFixture({
        latitude: Number(params.latitude),
        longitude: Number(params.longitude),
        start: url.searchParams.get('hourlyStart') ?? undefined,
        hours: 240,
        now,
      });
      change?.(data);
      return HttpResponse.json(data);
    },
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
const best = z.object({
  routeId: z.string(),
  date: z.string(),
  departureAt: z.string(),
  finishAt: z.string(),
  score: z.number(),
  windAssistance: z.object({
    usefulDistanceFraction: z.number(),
    potentialPoints: z.number(),
    appliedPoints: z.number(),
  }),
  conditions: conditionsSchema,
  recentRides: z.object({ penaltyPoints: z.number(), status: z.string() }),
  standards: z.object({ status: z.string() }),
});
const day = z.object({
  date: z.string(),
  availability: z.string(),
  availabilityReason: z.string(),
});
const resultSchema = z.object({
  timeZone: z.string(),
  recommendedKind: z.string().nullable(),
  windows: z.array(
    z.object({
      kind: z.string(),
      date: z.string(),
      window: ridingWindowSchema,
      searchRange: z.object({ start: z.string(), end: z.string() }),
      effectiveWindow: z.object({ start: z.string(), end: z.string() }),
      minimumStandardsStatus: z.string(),
      recommendationKind: z.string(),
      best,
      days: z.array(day),
      coverage: z.object({ assessedFraction: z.number().nullable() }),
      verdict: z.object({ status: z.string() }),
    }),
  ),
  omitted: z.array(
    z.object({
      kind: z.string(),
      reasonCode: z.string(),
      days: z.array(day),
      unranked: z.array(z.object({ verdict: z.object({ code: z.string() }) })),
    }),
  ),
  history: z.object({ revision: z.number().nullable(), status: z.string() }),
  weather: z.object({
    selectedSource: z.object({ providerId: z.string() }).nullable(),
    cache: z.object({ hits: z.number(), misses: z.number() }),
    attribution: z.array(z.object({ text: z.string(), url: z.string() })),
  }),
  resolvedPreferences: z.object({
    wind: z.object({ preferTailwind: z.boolean() }),
    distance: z.object({ minKm: z.number(), maxKm: z.number() }).nullable(),
  }),
});
const inputFor = (routeIds: string[], extra: Record<string, unknown> = {}) => ({
  routeIds,
  after: { date: '2026-10-09', window: { start: '09:00', end: '13:00' } },
  ...extra,
});
const suggest = async (
  h: Harness,
  routeIds: string[],
  extra: Record<string, unknown> = {},
) => {
  const r = await h.send('/recommendations/next-windows', {
    body: JSON.stringify(inputFor(routeIds, extra)),
  });
  assert.equal(r.status, 200, await r.clone().text());
  return resultSchema.parse(await r.json());
};

integration(
  'next windows apply saved tailwind intent and temporary opt-out without refetching',
  async (h) => {
    h.use(
      apple((data) => {
        for (const row of data.forecastHourly.hours) {
          row.temperature = 14;
          row.windSpeed = 18;
          row.windGust = 28;
          row.windDirection = 180;
        }
      }),
    );
    const route = await upload(h);
    assert.equal(
      (
        await h.send('/users', {
          body: JSON.stringify({
            displayName: 'Rider',
            settings: { preferences: { wind: { preferTailwind: true } } },
          }),
        })
      ).status,
      201,
    );
    const on = await suggest(h, [route.id]);
    assert.equal(on.resolvedPreferences.wind.preferTailwind, true);
    assert.ok(on.windows.length > 0);
    const calls = h.requests.length;
    const off = await suggest(h, [route.id], {
      preferences: { wind: { preferTailwind: false } },
    });
    assert.equal(off.resolvedPreferences.wind.preferTailwind, false);
    assert.equal(off.windows.length, on.windows.length);
    for (const assisted of on.windows) {
      const other = first(off.windows.filter((w) => w.kind === assisted.kind));
      assert.equal(assisted.best.windAssistance.potentialPoints, 2);
      assert.equal(assisted.best.score - other.best.score, 2);
      assert.equal(other.best.windAssistance.appliedPoints, 0);
      assert.equal(other.best.windAssistance.potentialPoints, 0);
      assert.deepEqual(assisted.best.conditions, other.best.conditions);
    }
    assert.equal(
      (await suggest(h, [route.id])).resolvedPreferences.wind.preferTailwind,
      true,
    );
    assert.equal(h.requests.length, calls);
  },
);

integration(
  'next windows use one shared weather snapshot, agree with normal rankings and carry attribution and preferences',
  async (h) => {
    h.use(
      apple((data) => {
        for (const row of data.forecastHourly.hours)
          row.temperature = row.forecastStart.startsWith('2026-10-12')
            ? 20
            : 14;
      }),
    );
    const route = await upload(h);
    assert.equal(
      (
        await h.send('/users', {
          body: JSON.stringify({
            displayName: 'Rider',
            settings: { preferences: { distance: { minKm: 10, maxKm: 50 } } },
          }),
        })
      ).status,
      201,
    );
    const r = await suggest(h, [route.id]);
    assert.deepEqual(
      r.windows.map((w) => [w.kind, w.date]),
      [
        ['tomorrow', '2026-10-10'],
        ['same_weekday', '2026-10-16'],
        ['best_next_days', '2026-10-12'],
      ],
    );
    assert.equal(r.recommendedKind, 'best_next_days');
    assert.deepEqual(r.resolvedPreferences.distance, { minKm: 10, maxKm: 50 });
    assert.equal(r.weather.attribution.length, 1);
    assert.equal(r.weather.selectedSource?.providerId, 'apple-weather');
    const calls = h.requests.length;
    assert.ok(calls > 0);
    assert.equal(
      new Set(h.requests.map((q) => new URL(q.url).pathname)).size,
      calls,
    );
    const normalSchema = z.object({
      rankings: z.array(
        z.object({
          routeId: z.string(),
          best: best.omit({ routeId: true }),
          effectiveWindow: z.object({ start: z.string(), end: z.string() }),
        }),
      ),
    });
    for (const w of r.windows) {
      const normal = await h.send('/recommendations', {
        body: JSON.stringify({
          routeIds: [route.id],
          date: w.date,
          riding: { window: w.window },
        }),
      });
      assert.equal(normal.status, 200);
      const ranked = first(normalSchema.parse(await normal.json()).rankings);
      assert.deepEqual(w.best, { routeId: ranked.routeId, ...ranked.best });
      assert.deepEqual(w.effectiveWindow, ranked.effectiveWindow);
    }
    assert.equal(h.requests.length, calls);
  },
);

integration(
  'highlighting takes minimum standards before score and keeps best-available suggestions honest',
  async (h) => {
    h.use(
      apple((data) => {
        for (const row of data.forecastHourly.hours) {
          const tomorrow = row.forecastStart.startsWith('2026-10-10');
          row.temperature = tomorrow ? 24 : 10;
          row.precipitationChance = tomorrow ? 0.4 : 0;
        }
      }),
    );
    const route = await upload(h);
    const preferences = {
      weights: {
        temperature: 1,
        wind: 0,
        dryness: 0,
        sunshine: 0,
        clearSkies: 0,
      },
      minimumStandards: { maximumPrecipitationProbability: 0.1 },
    };
    const r = await suggest(h, [route.id], { preferences });
    const tomorrow = first(r.windows);
    const selected = r.windows.find((w) => w.kind === r.recommendedKind);
    assert.equal(tomorrow.recommendationKind, 'best_available');
    assert.equal(tomorrow.verdict.status, 'below_minimums');
    assert.equal(selected?.verdict.status, 'meets');
    assert.ok(tomorrow.best.score > (selected?.best.score ?? 100));
    const allBelow = await suggest(h, [route.id], {
      preferences: {
        minimumStandards: { minimumTemperature: { kind: 'fixed', valueC: 30 } },
      },
    });
    assert.ok(allBelow.windows.length > 0);
    assert.ok(
      allBelow.windows.every(
        (w) =>
          w.recommendationKind === 'best_available' &&
          w.minimumStandardsStatus === 'none_meet',
      ),
    );
    assert.ok(allBelow.recommendedKind);
  },
);

integration(
  'partial forecasts retain fully assessable rides, missing horizons are explicit, and duplicate suggestions disappear',
  async (h) => {
    h.use(
      apple((data) => {
        data.forecastHourly.hours = data.forecastHourly.hours.filter(
          (row) =>
            Date.parse(row.forecastStart) <= Date.parse('2026-10-10T11:00:00Z'),
        );
      }),
    );
    const route = await upload(h);
    const r = await suggest(h, [route.id]);
    const tomorrow = first(r.windows);
    assert.equal(tomorrow.kind, 'tomorrow');
    assert.equal(first(tomorrow.days).availability, 'partial');
    assert.ok((tomorrow.coverage.assessedFraction ?? 1) < 1);
    const weekday = r.omitted.find((w) => w.kind === 'same_weekday');
    assert.equal(
      first(weekday?.days ?? []).availabilityReason,
      'outside_forecast_horizon',
    );
    const calls = h.requests.length;
    const daylight = await suggest(h, [route.id], {
      after: { date: '2026-10-09', window: 'daylight' },
    });
    assert.equal(daylight.windows.length, 1);
    assert.equal(
      daylight.omitted.find((w) => w.kind === 'best_next_days')?.reasonCode,
      'duplicate',
    );
    assert.equal(h.requests.length, calls);
  },
);

integration(
  'upstream failure, missing elevation and clock windows that do not fit are distinguished',
  async (h) => {
    h.use(
      http.get(
        'https://weatherkit.apple.com/api/v1/weather/en/:lat/:lon',
        () => new HttpResponse(null, { status: 503 }),
      ),
    );
    const route = await upload(h);
    const failed = await suggest(h, [route.id]);
    assert.equal(failed.windows.length, 0);
    assert.equal(failed.recommendedKind, null);
    assert.ok(
      failed.omitted.every((w) =>
        w.days.every((d) => d.availabilityReason === 'provider_unavailable'),
      ),
    );
    h.use(apple());
    const missing = await suggest(h, [route.id], {
      preferences: { climbing: { preference: 'flatter' } },
    });
    assert.equal(missing.windows.length, 0);
    assert.ok(
      missing.omitted.every((w) =>
        w.unranked.every((r) => r.verdict.code === 'missing_elevation'),
      ),
    );
    const short = await suggest(h, [route.id], {
      after: { date: '2026-10-09', window: { start: '09:00', end: '09:01' } },
    });
    assert.deepEqual(
      short.windows.map((w) => w.kind),
      ['best_next_days'],
    );
    assert.ok(
      short.omitted.every(
        (w) => first(w.days).availabilityReason === 'no_feasible_departure',
      ),
    );
  },
);

integration(
  'next windows authenticate, enforce ownership and reject invalid settings before any provider calls',
  async (h) => {
    const route = await upload(h);
    const body = JSON.stringify(inputFor([route.id]));
    assert.equal(
      (await h.send('/recommendations/next-windows', { body, token: null }))
        .status,
      401,
    );
    assert.equal(
      (
        await h.send('/recommendations/next-windows', {
          body,
          token: BOB_TOKEN,
        })
      ).status,
      404,
    );
    for (const extra of [
      { after: { date: '2026-10-10', window: 'daylight' } },
      { after: { date: '2026-02-30', window: 'daylight' } },
      {
        after: { date: '2026-10-09', window: { start: '14:00', end: '09:00' } },
      },
      { date: '2026-10-10' },
      { preferences: { recentRidePenalty: { days: 28 } } },
      {
        preferenceLevels: { rain: 'avoid' },
        preferences: { weights: { dryness: 0.1 } },
      },
      { riding: { averageSpeedKph: 0 } },
      { riding: { window: 'daylight' } },
    ])
      assert.equal(
        (
          await h.send('/recommendations/next-windows', {
            body: JSON.stringify(inputFor([route.id], extra)),
          })
        ).status,
        400,
      );
    assert.equal(h.requests.length, 0);
  },
);

integration(
  'generated DST clock ambiguity omits that window without discarding daylight alternatives',
  async (h) => {
    const now = '2026-10-24T12:00:00Z';
    await h.restart({ TEST_NOW: now });
    h.use(apple(undefined, now));
    const route = await upload(h);
    const r = await suggest(h, [route.id], {
      after: { date: '2026-10-24', window: { start: '01:30', end: '13:00' } },
    });
    const tomorrow = r.omitted.find((w) => w.kind === 'tomorrow');
    assert.equal(
      first(tomorrow?.days ?? []).availabilityReason,
      'invalid_window_time',
    );
    assert.ok(r.windows.some((w) => w.kind === 'best_next_days'));
  },
);

integration(
  'saved Met Office policy and recent-ride adjustment also apply to suggestions with no provider substitution',
  async (h) => {
    h.use(
      metOffice(({ request }) => HttpResponse.json(hourlyForecast(request))),
    );
    const route = await upload(h);
    assert.equal(
      (
        await h.send('/users', {
          body: JSON.stringify({
            displayName: 'Rider',
            settings: {
              weather: { mode: 'strict', providerId: 'met-office' },
              forecast: {
                representation: 'deterministic',
                freshnessBasis: 'model-run',
              },
              preferences: { recentRides: { mode: 'prefer-variety' } },
            },
          }),
        })
      ).status,
      201,
    );
    const baseline = await suggest(h, [route.id]);
    assert.equal(baseline.history.status, 'no_recent_history');
    assert.equal(first(baseline.windows).best.recentRides.penaltyPoints, 0);
    const logged = await h.send('/rides', {
      headers: { 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({
        routeId: route.id,
        expectedRouteVersion: 1,
        riddenOn: '2026-10-09',
        timeZone: 'Europe/London',
      }),
    });
    assert.equal(logged.status, 201);
    const changed = await suggest(h, [route.id]);
    assert.equal(changed.weather.selectedSource?.providerId, 'met-office');
    assert.ok(first(changed.windows).best.recentRides.penaltyPoints > 9);
    assert.equal(
      changed.history.revision,
      (baseline.history.revision ?? 0) + 1,
    );
    assert.ok(
      h.requests.every((q) => new URL(q.url).hostname.includes('metoffice')),
    );
  },
);
