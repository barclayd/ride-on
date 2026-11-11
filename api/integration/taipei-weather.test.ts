import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exportPKCS8, generateKeyPair } from 'jose';
import { HttpResponse, http } from 'msw/http';
import { z } from 'zod';
import { appleWeatherFixture } from '../test/fixtures/apple-weather.ts';
import { taipeiGpx, taipeiRoutes } from '../test/fixtures/taipei.ts';
import { first, recommend } from './client.ts';
import { createHarness, type Harness } from './harness.ts';

const keys = await generateKeyPair('ES256', { extractable: true });
const config = JSON.stringify({
  teamId: 'TESTTEAM01',
  keyId: 'TESTKEY001',
  serviceId: 'cc.ride-on.synthetic-taipei',
  privateKey: await exportPKCS8(keys.privateKey),
});
const settings = {
  weatherProviderId: 'apple-weather',
  timeZone: 'Asia/Taipei',
  riding: { window: { start: '06:30', end: '14:00' } },
};
type Hour = ReturnType<
  typeof appleWeatherFixture
>['forecastHourly']['hours'][number];
const apple = (change: (row: Hour) => void = () => {}) =>
  http.get(
    'https://weatherkit.apple.com/api/v1/weather/en/:latitude/:longitude',
    ({ params }) => {
      const latitude = Number(params.latitude);
      const longitude = Number(params.longitude);
      assert.ok(latitude > 25 && latitude < 25.2);
      assert.ok(longitude > 121.4 && longitude < 121.7);
      const data = appleWeatherFixture({
        latitude,
        longitude,
        // Taipei's early morning is the previous UTC day.
        start: '2026-10-09T12:00:00Z',
        hours: 48,
      });
      for (const row of data.forecastHourly.hours) {
        Object.assign(row, {
          temperature: 22,
          temperatureApparent: 22,
          windSpeed: 0,
          windGust: 0,
          precipitationChance: 0,
        });
        change(row);
      }
      return HttpResponse.json(data);
    },
  );
const uploadRoutes = async (h: Harness) => {
  const ids = [];
  for (const route of taipeiRoutes) {
    const response = await h.send('/routes', {
      contentType: 'application/gpx+xml',
      body: taipeiGpx(route),
    });
    assert.equal(response.status, 201);
    ids.push(
      z
        .object({ route: z.object({ id: z.uuid() }) })
        .parse(await response.json()).route.id,
    );
  }
  return ids;
};
const integration = (
  name: string,
  run: (h: Harness, ids: string[]) => Promise<void>,
) =>
  test(name, { timeout: 30_000 }, async () => {
    const h = await createHarness();
    try {
      await h.restart({ APPLE_WEATHER_CONFIG_JSON: config });
      await run(h, await uploadRoutes(h));
    } finally {
      await h.dispose();
      assert.deepEqual(h.unexpected, []);
      assert.deepEqual(h.handlerErrors, []);
    }
  });

integration(
  'Taipei calm, dry routes score 100 with local daylight and survive cache restart',
  async (h, ids) => {
    h.use(apple());
    const result = await recommend(h, ids, settings);
    assert.equal(result.timeZone, 'Asia/Taipei');
    assert.equal(result.weather.selectedSource?.providerId, 'taiwan-weather');
    assert.equal(result.rankings.length, 2);
    assert.deepEqual(result.unranked, []);
    for (const route of result.rankings) {
      assert.equal(route.best.score, 100);
      assert.equal(route.best.weatherScore, 100);
      assert.equal(route.departuresUnknown, 0);
      assert.ok(route.departuresAssessed >= 14);
      assert.equal(route.best.departureAt, '2026-10-09T22:30:00.000Z');
      assert.equal(route.effectiveWindow.end, '2026-10-10T06:00:00.000Z');
      assert.ok(
        Date.parse(route.best.departureAt) >= Date.parse(route.daylight.start),
      );
      assert.ok(
        Date.parse(route.best.finishAt) <= Date.parse(route.daylight.end),
      );
      const minutes =
        (Date.parse(route.best.finishAt) - Date.parse(route.best.departureAt)) /
        60_000;
      assert.ok(Math.abs(minutes - (route.distanceM / 1000 / 20) * 60) < 0.001);
    }
    const calls = h.requests.length;
    await h.restart();
    const cached = await recommend(h, ids, settings);
    assert.equal(h.requests.length, calls);
    assert.deepEqual(cached.rankings, result.rankings);
    assert.equal(cached.weather.cache.misses, 0);
  },
);

integration(
  'Taipei rain penalties match the default weights and retain native rain units',
  async (h, ids) => {
    h.use(
      apple((row) => {
        row.precipitationChance = 0.8;
        row.precipitationAmount = 2;
      }),
    );
    const result = await recommend(h, ids, settings);
    assert.equal(result.rankings.length, 2);
    for (const route of result.rankings) {
      // 30 temperature + 20 wind + 50 * (1 - 0.8 * 0.8 - 0.2 * 1).
      assert.equal(route.best.score, 58);
      assert.equal(route.best.conditions.maximumPrecipitationProbability, 0.8);
      assert.equal(route.best.conditions.maximumPrecipitationRateMmH, 2);
      assert.equal(route.best.conditions.maximumPrecipitationAmountMm, 2);
      assert.equal(route.departuresUnknown, 0);
    }
  },
);

for (const direction of [90, 270])
  integration(
    `Taipei wind from ${direction} degrees ranks routes by their actual bearings`,
    async (h, ids) => {
      h.use(
        apple((row) => {
          row.windSpeed = 28;
          row.windGust = 38;
          row.windDirection = direction;
        }),
      );
      const result = await recommend(h, ids, settings);
      assert.equal(result.rankings.length, 2);
      assert.equal(result.recommendedRouteId, ids[direction === 90 ? 0 : 1]);
      const east = first(result.rankings.filter((r) => r.routeId === ids[1]));
      assert.equal(
        east.best.conditions.windDistanceFractions[
          direction === 90 ? 'headwind' : 'tailwind'
        ],
        1,
      );
      assert.equal(
        east.best.conditions.assistedDistanceFraction,
        direction === 90 ? 0 : 1,
      );
      for (const route of result.rankings) {
        assert.equal(route.best.conditions.averageWindSpeedKph, 28);
        assert.equal(route.best.conditions.maximumGustKph, 38);
        assert.equal(route.departuresUnknown, 0);
        assert.equal(route.best.windAssistance.appliedPoints, 0);
      }
      assert.ok(
        first(result.rankings).best.score >
          (result.rankings[1]?.best.score ?? 100),
      );
      const limited = await recommend(h, ids, {
        ...settings,
        preferences: { minimumStandards: { maximumGustKph: 35 } },
      });
      assert.equal(limited.minimumStandardsStatus, 'none_meet');
      assert.ok(
        limited.rankings.every((r) =>
          r.best.standards.failures.some(
            (f) => f.standard === 'maximumGustKph' && f.actual === 38,
          ),
        ),
      );
    },
  );

integration(
  'Taipei departure search waits until 10:00 local when morning rain clears',
  async (h, ids) => {
    h.use(
      apple((row) => {
        const wet =
          Date.parse(row.forecastStart) < Date.parse('2026-10-10T02:00:00Z');
        row.precipitationChance = wet ? 0.8 : 0;
        row.precipitationAmount = wet ? 2 : 0;
      }),
    );
    const result = await recommend(h, ids, settings);
    assert.equal(result.rankings.length, 2);
    for (const route of result.rankings) {
      assert.equal(route.best.departureAt, '2026-10-10T02:00:00.000Z');
      assert.equal(route.best.score, 100);
      assert.equal(route.best.conditions.maximumPrecipitationProbability, 0);
    }
  },
);

integration(
  'Taiwan geographic selection also overrides advanced policies and reuses only the composite cache',
  async (h, ids) => {
    h.use(apple());
    const baseline = await recommend(h, ids, settings);
    assert.equal(baseline.rankings.length, 2);
    const calls = h.requests.length;
    for (const weather of [
      { mode: 'strict', providerId: 'cwa' },
      {
        mode: 'ordered-fallback',
        providerIds: ['met-office', 'apple-weather'],
      },
    ]) {
      const result = await recommend(h, ids, {
        timeZone: settings.timeZone,
        riding: settings.riding,
        weather,
      });
      assert.equal(result.weather.selectedSource?.providerId, 'taiwan-weather');
      assert.deepEqual(result.rankings, baseline.rankings);
      assert.equal(h.requests.length, calls);
    }
  },
);
