import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exportPKCS8, generateKeyPair } from 'jose';
import { HttpResponse, http } from 'msw/http';
import { z } from 'zod';
import { userSchema } from '../src/users/model.ts';
import {
  APPLE_NOW,
  appleWeatherFixture,
} from '../test/fixtures/apple-weather.ts';
import { first, upload } from './client.ts';
import { hourlyForecast, metOffice } from './fixtures.ts';
import { createHarness, type Harness } from './harness.ts';

const keys = await generateKeyPair('ES256', { extractable: true });
const config = JSON.stringify({
  teamId: 'TESTTEAM01',
  keyId: 'TESTKEY001',
  serviceId: 'cc.ride-on.test',
  privateKey: await exportPKCS8(keys.privateKey),
});
type Fixture = ReturnType<typeof appleWeatherFixture>;
const apple = (change?: (data: Fixture, longitude: number) => void) =>
  http.get(
    'https://weatherkit.apple.com/api/v1/weather/en/:latitude/:longitude',
    ({ params, request }) => {
      const url = new URL(request.url);
      assert.equal(
        Date.parse(url.searchParams.get('hourlyEnd') ?? '') -
          Date.parse(url.searchParams.get('hourlyStart') ?? ''),
        240 * 3600000,
      );
      const data = appleWeatherFixture({
        latitude: Number(params.latitude),
        longitude: Number(params.longitude),
        start: '2026-10-09T11:00:00Z',
        hours: 240,
      });
      change?.(data, Number(params.longitude));
      return HttpResponse.json(data);
    },
  );
const integration = (name: string, run: (h: Harness) => Promise<void>) =>
  test(name, { timeout: 30000 }, async () => {
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
const bestSchema = z.object({
  date: z.string(),
  departureAt: z.string(),
  finishAt: z.string(),
  score: z.number(),
  weatherScore: z.number(),
  standards: z.object({
    status: z.string(),
    failures: z.array(
      z.object({
        at: z.iso.datetime(),
        date: z.iso.date(),
        timeZone: z.string(),
        positionKm: z.number().nonnegative(),
        actual: z.number(),
        limit: z.number(),
      }),
    ),
  }),
  conditions: z.object({ temperatureC: z.object({ maximum: z.number() }) }),
});
const ranked = z.object({
  routeId: z.string(),
  rank: z.number(),
  best: bestSchema,
  coverage: z.object({
    assessedFraction: z.number().nullable(),
    intervals: z.array(
      z.object({ firstDepartureAt: z.string(), lastDepartureAt: z.string() }),
    ),
  }),
  verdict: z.object({ status: z.string(), code: z.string() }),
});
const response = z.object({
  date: z.string().nullable(),
  expired: z.boolean(),
  range: z.object({ start: z.string(), end: z.string() }).nullable(),
  recommendation: z
    .object({ routeId: z.string(), kind: z.string() })
    .nullable(),
  rankings: z.array(ranked),
  unranked: z.array(
    z.object({
      routeId: z.string(),
      best: bestSchema.nullable(),
      partialAssessment: z
        .object({ score: z.null(), weatherScore: z.number() })
        .nullable(),
      verdict: z.object({ status: z.string(), code: z.string() }),
    }),
  ),
  days: z.array(
    z.object({
      date: z.string(),
      availability: z.string(),
      availabilityReason: z.string(),
      until: z.string().nullable(),
      quality: z.number().nullable(),
      temperatureMaxC: z.number().nullable(),
      recommendedRouteId: z.string().nullable(),
      coverage: z.array(
        z.object({
          intervals: z.array(z.object({ start: z.string(), end: z.string() })),
        }),
      ),
    }),
  ),
  weather: z.object({
    cache: z.object({ hits: z.number(), misses: z.number() }),
    retrieval: z.object({
      oldestAt: z.string().nullable(),
      latestAt: z.string().nullable(),
    }),
    attribution: z.array(
      z.object({
        text: z.string(),
        url: z.string(),
        notice: z.string().optional(),
      }),
    ),
  }),
  resolvedPreferences: z.object({
    weights: z.object({ sunshine: z.number(), dryness: z.number() }),
  }),
});
const recommend = async (
  h: Harness,
  routeIds: string[],
  options: Record<string, unknown> = {},
) => {
  const r = await h.send('/recommendations', {
    body: JSON.stringify({
      routeIds,
      days: { kind: 'preset', preset: 'next' },
      ...options,
    }),
  });
  assert.equal(r.status, 200, await r.clone().text());
  return response.parse(await r.json());
};
const readUser = async (r: { json: () => Promise<unknown> }) =>
  z
    .object({
      user: userSchema.extend({
        preferenceLevels: z.object({ sunshine: z.string(), rain: z.string() }),
      }),
    })
    .parse(await r.json()).user;

integration(
  'one multi-day call uses one horizon per location; previews cannot change selected ordering and later dates reuse cached evidence after restart',
  async (h) => {
    h.use(
      apple((data) => {
        for (const hour of data.forecastHourly.hours)
          hour.temperature = hour.forecastStart.startsWith('2026-10-11')
            ? 18
            : hour.forecastStart.startsWith('2026-10-15')
              ? 22
              : 8;
      }),
    );
    const route = await upload(h);
    const result = await recommend(h, [route.id], { previewDays: 7 });
    assert.equal(result.days.length, 7);
    assert.deepEqual(result.range, { start: '2026-10-09', end: '2026-10-13' });
    assert.equal(first(result.rankings).best.date, '2026-10-11');
    assert.equal(result.recommendation?.routeId, route.id);
    const requests = h.requests.length;
    assert.ok(requests > 0);
    assert.equal(
      new Set(h.requests.map((r) => new URL(r.url).pathname)).size,
      requests,
    );
    const tomorrow = await recommend(h, [route.id], {
      days: undefined,
      date: '2026-10-10',
    });
    assert.equal(tomorrow.days.length, 1);
    await h.restart();
    const later = await recommend(h, [route.id], {
      days: { kind: 'range', start: '2026-10-14', end: '2026-10-15' },
      riding: { window: { start: '09:00', end: '13:00' } },
      preferences: { distance: { minKm: 0, maxKm: 80 } },
    });
    assert.equal(first(later.rankings).best.date, '2026-10-15');
    assert.equal(h.requests.length, requests);
    assert.equal(later.weather.cache.misses, 0);
    assert.equal(later.weather.attribution.length, 1);
    assert.equal(later.weather.retrieval.oldestAt, APPLE_NOW);
    assert.equal(later.weather.retrieval.latestAt, APPLE_NOW);
  },
);
integration(
  'actual partial coverage includes a timestamp and distinguishes interior gaps from a forecast cutoff',
  async (h) => {
    h.use(
      apple((data) => {
        data.forecastHourly.hours = data.forecastHourly.hours.filter(
          (row) =>
            Date.parse(row.forecastStart) < Date.parse('2026-10-10T12:00:00Z'),
        );
      }),
    );
    const route = await upload(h);
    const r = await recommend(h, [route.id], {
      days: undefined,
      date: '2026-10-10',
      riding: { window: { start: '09:00', end: '15:00' } },
    });
    const day = first(r.days);
    assert.equal(day.availability, 'partial');
    assert.equal(day.availabilityReason, 'partial_coverage');
    assert.equal(day.until, '2026-10-10T11:30:00.000Z');
    const fraction = first(r.rankings).coverage.assessedFraction;
    assert.ok(fraction !== null && fraction > 0 && fraction < 1);
    await h.restart({ TEST_NOW: '2026-10-09T12:21:00.000Z' });
    h.use(
      apple((data) => {
        data.forecastHourly.hours = data.forecastHourly.hours.filter(
          (row) => row.forecastStart !== '2026-10-10T10:00:00.000Z',
        );
      }),
    );
    const gaps = await recommend(h, [route.id], {
      days: undefined,
      date: '2026-10-10',
      riding: { window: { start: '09:00', end: '15:00' } },
    });
    assert.equal(first(gaps.days).until, null);
    assert.ok(first(first(gaps.days).coverage).intervals.length > 1);
  },
);
integration(
  'provider failures are not labelled future coverage; expired selections do no work and missing horizons are explicit',
  async (h) => {
    const route = await upload(h);
    const expired = await recommend(h, [route.id], {
      days: { kind: 'range', start: '2026-10-01', end: '2026-10-03' },
      previewDays: 7,
    });
    assert.equal(expired.expired, true);
    assert.equal(expired.range, null);
    assert.deepEqual(expired.rankings, []);
    assert.deepEqual(expired.days, []);
    assert.equal(h.requests.length, 0);
    h.use(
      http.get(
        'https://weatherkit.apple.com/api/v1/weather/en/:lat/:lon',
        () => new HttpResponse(null, { status: 503 }),
      ),
    );
    const failed = await recommend(h, [route.id], {
      days: { kind: 'preset', preset: 'tomorrow' },
    });
    assert.equal(first(failed.days).availabilityReason, 'provider_unavailable');
    assert.equal(failed.recommendation, null);
    h.use(apple());
    const future = await recommend(h, [route.id], {
      days: { kind: 'range', start: '2026-10-25', end: '2026-10-26' },
    });
    assert.equal(future.range, null);
    assert.equal(future.expired, false);
    assert.deepEqual(future.rankings, []);
    assert.equal(
      first(future.days).availabilityReason,
      'outside_forecast_horizon',
    );
  },
);
integration(
  'planning, display and level patches persist atomically while temporary levels change actual scoring without saving',
  async (h) => {
    h.use(
      apple((data, lon) => {
        for (const row of data.forecastHourly.hours) {
          row.temperature = lon < -0.5 ? 14 : 17;
          row.conditionCode = lon < -0.5 ? 'Clear' : 'Cloudy';
        }
      }),
    );
    const sunny = await upload(h, 'Sunny', -1);
    const cloudy = await upload(h, 'Cloudy', 0);
    const create = await h.send('/users', {
      body: JSON.stringify({
        displayName: 'Rider',
        settings: {
          preferences: {
            weights: {
              temperature: 0.15,
              wind: 0.4,
              dryness: 0.2,
              clearSkies: 0,
              sunshine: 0.25,
            },
          },
          planning: {
            days: { kind: 'preset', preset: 'tomorrow' },
            window: { start: '09:00', end: '13:00' },
          },
          display: { unit: 'mi' },
        },
      }),
    });
    assert.equal(create.status, 201);
    const user = await readUser(create);
    assert.deepEqual(user.preferenceLevels, {
      sunshine: 'important',
      rain: 'light-ok',
    });
    const original = await recommend(h, [sunny.id, cloudy.id], {
      days: { kind: 'preset', preset: 'tomorrow' },
    });
    assert.equal(first(original.rankings).routeId, sunny.id);
    const changed = await recommend(h, [sunny.id, cloudy.id], {
      days: { kind: 'preset', preset: 'tomorrow' },
      preferenceLevels: { sunshine: 'dont-mind' },
    });
    assert.equal(first(changed.rankings).routeId, cloudy.id);
    assert.equal(
      (await readUser(await h.send('/users/me'))).preferenceLevels.sunshine,
      'important',
    );
    const patch = await h.send('/users/me', {
      method: 'PATCH',
      body: JSON.stringify({
        expectedVersion: user.version,
        settings: {
          preferenceLevels: { sunshine: 'nice' },
          planning: { days: { kind: 'preset', preset: 'weekend' } },
        },
      }),
    });
    assert.equal(patch.status, 200);
    await h.restart();
    const saved = await readUser(await h.send('/users/me'));
    assert.equal(saved.settings.display.unit, 'mi');
    assert.deepEqual(saved.settings.planning.window, {
      start: '09:00',
      end: '13:00',
    });
    assert.deepEqual(saved.preferenceLevels, {
      sunshine: 'nice',
      rain: 'light-ok',
    });
    const conflict = await h.send('/users/me', {
      method: 'PATCH',
      body: JSON.stringify({
        expectedVersion: user.version,
        settings: { display: { unit: 'km' } },
      }),
    });
    assert.equal(conflict.status, 409);
    const bad = await h.send('/users/me', {
      method: 'PATCH',
      body: JSON.stringify({
        expectedVersion: saved.version,
        settings: {
          preferenceLevels: { rain: 'avoid' },
          preferences: { weights: { dryness: 0.1 } },
        },
      }),
    });
    assert.equal(bad.status, 400);
    assert.equal(
      (await readUser(await h.send('/users/me'))).version,
      saved.version,
    );
  },
);
integration(
  'rain presets alter rankings and do not remove a hard rain limit; standard breaches retain a best-available result',
  async (h) => {
    h.use(
      apple((data, lon) => {
        for (const row of data.forecastHourly.hours) {
          row.temperature = lon < -0.5 ? 14 : 20;
          row.precipitationChance = lon < -0.5 ? 0 : 0.5;
        }
      }),
    );
    const dry = await upload(h, 'Dry', -1);
    const wet = await upload(h, 'Wet', 0);
    const options = {
      days: { kind: 'preset', preset: 'tomorrow' },
      preferences: {
        weights: { temperature: 0.3, wind: 0, clearSkies: 0, sunshine: 0 },
      },
    };
    const avoid = await recommend(h, [dry.id, wet.id], {
      ...options,
      preferenceLevels: { rain: 'avoid' },
    });
    const indifferent = await recommend(h, [dry.id, wet.id], {
      ...options,
      preferenceLevels: { rain: 'dont-mind' },
    });
    assert.equal(first(avoid.rankings).routeId, dry.id);
    assert.equal(first(indifferent.rankings).routeId, wet.id);
    const limited = await recommend(h, [wet.id], {
      ...options,
      preferenceLevels: { rain: 'dont-mind' },
      preferences: {
        ...options.preferences,
        minimumStandards: { maximumPrecipitationProbability: 0.1 },
      },
    });
    assert.equal(limited.recommendation?.kind, 'best_available');
    assert.equal(first(limited.rankings).verdict.status, 'below_minimums');
  },
);
integration(
  'missing elevation has a weather-only result; a too-long ride is a separate no-fit outcome without weather calls',
  async (h) => {
    h.use(apple());
    const route = await upload(h);
    const partial = await recommend(h, [route.id], {
      preferences: { climbing: { preference: 'flatter' } },
    });
    assert.equal(partial.recommendation, null);
    assert.equal(partial.rankings.length, 0);
    assert.equal(first(partial.unranked).verdict.code, 'missing_elevation');
    assert.equal(first(partial.unranked).partialAssessment?.score, null);
    assert.ok(
      (first(partial.unranked).partialAssessment?.weatherScore ?? 0) > 0,
    );
    const calls = h.requests.length;
    const nofit = await recommend(h, [route.id], {
      riding: { window: { start: '09:00', end: '09:01' } },
    });
    assert.equal(nofit.recommendation, null);
    assert.equal(first(nofit.unranked).verdict.status, 'doesnt_fit');
    assert.equal(h.requests.length, calls);
  },
);
integration(
  'invalid multi-day requests and DST gaps reject before forecasts; unknown provider horizons are never guessed',
  async (h) => {
    const route = await upload(h);
    for (const input of [
      {},
      { date: '2026-10-10', days: { kind: 'preset', preset: 'next' } },
      { date: '2026-10-10', previewDays: 8 },
      { days: { kind: 'range', start: '2026-10-10', end: '2026-10-17' } },
      {
        days: { kind: 'range', start: '2027-03-28', end: '2027-03-29' },
        riding: { window: { start: '01:30', end: '04:00' } },
      },
    ]) {
      const bad = await h.send('/recommendations', {
        body: JSON.stringify({ routeIds: [route.id], ...input }),
      });
      assert.equal(bad.status, 400);
    }
    assert.equal(h.requests.length, 0);
    const providers = z
      .object({
        providers: z.array(
          z.object({ id: z.string(), forecastHorizonHours: z.number() }),
        ),
      })
      .parse(await (await h.send('/weather-providers')).json());
    assert.deepEqual(
      Object.fromEntries(
        providers.providers.map((p) => [p.id, p.forecastHorizonHours]),
      ),
      { 'apple-weather': 240, 'met-office': 48, 'met-office-bpf': 120 },
    );
    const unknown = await recommend(h, [route.id], {
      weather: { mode: 'strict', providerId: 'unregistered' },
    });
    assert.equal(unknown.recommendation, null);
    assert.equal(
      first(unknown.days).availabilityReason,
      'provider_unavailable',
    );
  },
);

integration(
  'Met Office multi-day searches also reuse one snapshot and clip to actual hourly evidence',
  async (h) => {
    h.use(
      metOffice(({ request }) => {
        const data = hourlyForecast(request, { lastHour: 71 });
        for (const feature of data.features)
          feature.properties.timeSeries.forEach((row, hour) => {
            row.time = new Date(
              Date.parse('2026-10-10T00:00:00Z') + hour * 3600000,
            ).toISOString();
          });
        return HttpResponse.json(data);
      }),
    );
    const route = await upload(h);
    const policy = {
      weather: { mode: 'strict', providerId: 'met-office' },
      forecast: {
        representation: 'deterministic',
        freshnessBasis: 'model-run',
      },
    };
    const r = await recommend(h, [route.id], {
      ...policy,
      days: { kind: 'range', start: '2026-10-10', end: '2026-10-13' },
    });
    assert.equal(first(r.days).availability, 'full');
    assert.equal(r.days.at(-1)?.availabilityReason, 'outside_forecast_horizon');
    assert.equal(r.range?.end, '2026-10-11');
    const calls = h.requests.length;
    await recommend(h, [route.id], {
      ...policy,
      days: undefined,
      date: '2026-10-11',
    });
    assert.equal(h.requests.length, calls);
  },
);
integration(
  'mixed cached and freshly fetched locations expose oldest and latest retrieval times',
  async (h) => {
    h.use(apple());
    const a = await upload(h, 'First', -1);
    await recommend(h, [a.id], {
      days: { kind: 'preset', preset: 'tomorrow' },
    });
    await h.restart({ TEST_NOW: '2026-10-09T12:05:00.000Z' });
    const b = await upload(h, 'Second', 0);
    const r = await recommend(h, [a.id, b.id], {
      days: { kind: 'preset', preset: 'tomorrow' },
    });
    assert.ok(r.weather.cache.hits > 0 && r.weather.cache.misses > 0);
    assert.deepEqual(r.weather.retrieval, {
      oldestAt: APPLE_NOW,
      latestAt: '2026-10-09T12:05:00.000Z',
    });
    assert.equal(r.weather.attribution.length, 1);
  },
);
