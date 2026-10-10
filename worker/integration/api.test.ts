import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HttpResponse } from 'msw/http';
import { z } from 'zod';
import { first, recommend, upload } from './client.ts';
import {
  hourlyForecast,
  MET_OFFICE_HOURLY,
  metOffice,
  routeGpx,
} from './fixtures.ts';
import {
  ALICE_TOKEN,
  BOB_TOKEN,
  createHarness,
  FIXED_NOW,
  type Harness,
  RIDE_DATE,
  WEATHER_KEY,
} from './harness.ts';

const integration = (name: string, run: (harness: Harness) => Promise<void>) =>
  test(name, { timeout: 15_000 }, async () => {
    const harness = await createHarness();
    try {
      await run(harness);
    } finally {
      await harness.dispose();
      // Adapter error handling cannot conceal a missing handler or failed assertion.
      assert.deepEqual(harness.unexpected, []);
      assert.deepEqual(harness.handlerErrors, []);
    }
  });

integration(
  'sunshine-aware ranking can favour a cooler sunny ride and reverses with personal weights',
  async (h) => {
    h.use(
      metOffice(({ request }) => {
        const sunny =
          Number(new URL(request.url).searchParams.get('longitude')) < 0;
        return HttpResponse.json(
          hourlyForecast(request, {
            values: () => ({
              screenTemperature: sunny ? 14 : 17,
              significantWeatherCode: sunny ? 3 : 8,
            }),
          }),
        );
      }),
    );
    const sunny = await upload(h, 'Cool sunny intervals', -1);
    const overcast = await upload(h, 'Warm overcast', 1);
    const ids = [sunny.id, overcast.id];
    const result = await recommend(h, ids, {
      preferences: {
        weights: { temperature: 0.15, wind: 0.2, dryness: 0.2, sunshine: 0.45 },
      },
    });
    assert.equal(result.recommendedRouteId, sunny.id);
    assert.equal(
      first(result.rankings).best.conditions.skyConditionDistanceFractions
        ?.sunnyIntervals,
      1,
    );
    const calls = h.requests.length;
    const warmer = await recommend(h, ids, {
      preferences: {
        weights: { temperature: 0.99, wind: 0, dryness: 0, sunshine: 0.01 },
      },
    });
    assert.equal(warmer.recommendedRouteId, overcast.id);
    assert.equal(h.requests.length, calls);
  },
);

integration(
  'an unknown weather symbol cannot turn into a sunny recommendation',
  async (h) => {
    h.use(
      metOffice(({ request }) =>
        HttpResponse.json(
          hourlyForecast(request, {
            values: () => ({ significantWeatherCode: 99 }),
          }),
        ),
      ),
    );
    const route = await upload(h);
    const result = await recommend(h, [route.id], {
      preferences: { weights: { sunshine: 0.45 } },
    });
    assert.equal(result.recommendedRouteId, null);
    assert.ok(
      first(result.unranked).issues.includes('missing-weather-at-arrival'),
    );
  },
);

integration(
  'GPX → migrated D1 → Met Office HTTP → recommendation survives a Worker restart',
  async (h) => {
    h.use(metOffice());
    const route = await upload(h, 'River &amp; Ridge');
    assert.equal(route.name, 'River & Ridge');
    assert.equal(route.ascentM, null);
    assert.ok(route.warnings.includes('MISSING_ELEVATION'));
    await h.restart();
    const listed = await h.send('/routes');
    assert.deepEqual(
      z
        .object({ routes: z.array(z.object({ id: z.uuid() })) })
        .parse(await listed.json())
        .routes.map((item) => item.id),
      [route.id],
    );
    const result = await recommend(h, [route.id]);
    const ride = first(result.rankings);
    assert.equal(result.recommendedRouteId, route.id);
    assert.deepEqual(result.riding, {
      averageSpeedKph: 20,
      window: 'daylight',
    });
    assert.equal(ride.best.score, 100);
    assert.equal(ride.departuresUnknown, 0);
    assert.ok(
      Date.parse(ride.best.departureAt) >= Date.parse(ride.daylight.start),
    );
    assert.ok(Date.parse(ride.best.finishAt) <= Date.parse(ride.daylight.end));
    assert.ok(
      Math.abs(
        Date.parse(ride.best.finishAt) -
          Date.parse(ride.best.departureAt) -
          (route.distanceM / 20) * 3600,
      ) <
        10 ** -0 / 2,
    );
    assert.equal(ride.best.rideHours.length, 3);
    assert.deepEqual(result.weather.selectedSource, {
      providerId: 'met-office',
      productId: 'global-spot-hourly',
    });
    const provenance = first(result.weather.locations).provenance;
    assert.ok(provenance);
    assert.equal(provenance.forecastRunAt, FIXED_NOW);
    assert.ok(
      provenance.attribution.some(
        (item) => item.text === 'Powered by Met Office data',
      ),
    );
    assert.equal(h.requests.length, 6);
    for (const request of h.requests) {
      const url = new URL(request.url);
      assert.equal(`${url.origin}${url.pathname}`, MET_OFFICE_HOURLY);
      assert.equal(request.method, 'GET');
      assert.equal(request.headers.get('apikey'), WEATHER_KEY);
      assert.equal(request.headers.has('Authorization'), false);
      assert.ok(!request.url.includes(WEATHER_KEY));
      assert.equal(url.searchParams.get('excludeParameterMetadata'), 'false');
    }
    const json = JSON.stringify(result);
    assert.ok(!json.includes(WEATHER_KEY));
    assert.ok(!json.includes(ALICE_TOKEN));
  },
);

integration(
  'changed rider preferences reverse the ranking without another weather fetch, including after restart',
  async (h) => {
    h.use(
      metOffice(({ request }) => {
        const dry =
          Number(new URL(request.url).searchParams.get('longitude')) < -0.5;
        return HttpResponse.json(
          hourlyForecast(request, {
            values: () => ({
              screenTemperature: dry ? 13 : 18,
              probOfPrecipitation: dry ? 0 : 60,
              precipitationRate: dry ? 0 : 0.8,
            }),
          }),
        );
      }),
    );
    const dry = await upload(h, 'Cool and dry', -1);
    const warm = await upload(h, 'Warm and wet', -0.1);
    const ids = [dry.id, warm.id];
    const original = await recommend(h, ids);
    assert.equal(original.recommendedRouteId, dry.id);
    const upstreamCalls = h.requests.length;
    assert.deepEqual(original.weather.cache, { hits: 0, misses: 12 });
    await h.restart();
    const differentRider = await recommend(h, ids, {
      preferences: { weights: { temperature: 1, wind: 0, dryness: 0 } },
    });
    assert.equal(differentRider.recommendedRouteId, warm.id);
    assert.deepEqual(differentRider.weather.cache, { hits: 12, misses: 0 });
    assert.equal(h.requests.length, upstreamCalls);
    // Personal minimums are separate from scoring weights.
    const minimum = await recommend(h, ids, {
      preferences: {
        minimumStandards: { minimumTemperature: { kind: 'fixed', valueC: 14 } },
      },
    });
    assert.equal(minimum.recommendedRouteId, warm.id);
    assert.equal(minimum.minimumStandardsStatus, 'match_found');
    assert.equal(h.requests.length, upstreamCalls);
  },
);

integration(
  'hourly weather changes the chosen departure and is matched to the full ride',
  async (h) => {
    h.use(
      metOffice(({ request }) =>
        HttpResponse.json(
          hourlyForecast(request, {
            values: (hour) => ({
              screenTemperature: hour < 12 ? 6 : 18,
              probOfPrecipitation: hour < 10 || hour >= 15 ? 80 : 0,
            }),
          }),
        ),
      ),
    );
    const route = await upload(h);
    const result = await recommend(h, [route.id]);
    const best = first(result.rankings).best;
    assert.equal(best.departureAt, '2026-10-10T11:30:00.000Z');
    assert.deepEqual(best.conditions.temperatureC, {
      minimum: 18,
      maximum: 18,
    });
    assert.equal(best.conditions.maximumPrecipitationProbability, 0);
    assert.equal(
      best.rideHours.every(
        (hour) =>
          !hour.conditions ||
          hour.conditions.maximumPrecipitationProbability === 0,
      ),
      true,
    );
    const faster = await recommend(h, [route.id], {
      riding: { averageSpeedKph: 25 },
    });
    assert.ok(
      Math.abs(
        first(faster.rankings).estimatedDurationMinutes -
          (route.distanceM / 25) * 0.06,
      ) <
        10 ** -1 / 2,
    );
    assert.deepEqual(faster.weather.cache, { hits: 6, misses: 0 });
  },
);

integration(
  'the same wind assists opposite route directions differently without refetching identical locations',
  async (h) => {
    h.use(
      metOffice(({ request }) =>
        HttpResponse.json(
          hourlyForecast(request, {
            values: () => ({
              windSpeed10m: 8,
              windDirectionFrom10m: 180,
              max10mWindGust: 8,
            }),
          }),
        ),
      ),
    );
    const north = await upload(h, 'Northbound');
    const south = await upload(h, 'Southbound', -1, true);
    const result = await recommend(h, [south.id, north.id]);
    assert.equal(result.recommendedRouteId, north.id);
    assert.equal(
      first(result.rankings).best.conditions.assistedDistanceFraction,
      1,
    );
    assert.equal(
      result.rankings[1]?.best.conditions.assistedDistanceFraction,
      0,
    );
    // Start/end coordinates overlap even though reversed intermediate samples differ.
    assert.ok(h.requests.length < result.weather.cache.misses);
  },
);

integration(
  'all routes below standards still return a best ride and concrete breach evidence',
  async (h) => {
    h.use(
      metOffice(({ request }) =>
        HttpResponse.json(
          hourlyForecast(request, {
            values: () => ({ screenTemperature: 13, probOfPrecipitation: 40 }),
          }),
        ),
      ),
    );
    const route = await upload(h);
    const result = await recommend(h, [route.id], {
      preferences: {
        minimumStandards: {
          minimumTemperature: { kind: 'fixed', valueC: 16 },
          maximumPrecipitationProbability: 0.2,
        },
      },
    });
    assert.equal(result.recommendedRouteId, route.id);
    assert.equal(result.minimumStandardsStatus, 'none_meet');
    assert.ok(
      result.message.includes('No evaluated route and departure meets'),
    );
    const failures = first(result.rankings).best.standards.failures;
    assert.deepEqual(
      failures.map((item) => item.standard),
      ['minimumTemperatureC', 'maximumPrecipitationProbability'],
    );
    assert.equal(first(failures).actual, 13);
    assert.ok(
      Math.abs(first(failures).affectedDistanceKm - route.distanceM / 1000) <
        10 ** -1 / 2,
    );
    assert.ok(first(failures).sections.length > 1);
    assert.equal(
      first(result.rankings).best.conditions.maximumPrecipitationProbability,
      0.4,
    );
  },
);

integration(
  'an unspecified monthly minimum is unknown and an explicit fallback resolves it without refetching',
  async (h) => {
    h.use(metOffice());
    const route = await upload(h);
    const policy = { kind: 'monthly', valuesC: { '1': 0, '6': 16 } };
    const unknown = await recommend(h, [route.id], {
      preferences: { minimumStandards: { minimumTemperature: policy } },
    });
    assert.equal(unknown.minimumStandardsStatus, 'unknown');
    assert.deepEqual(unknown.resolvedMinimumTemperature, {
      valueC: null,
      resolved: false,
      origin: 'unresolved-month:10',
    });
    const resolved = await recommend(h, [route.id], {
      preferences: {
        minimumStandards: { minimumTemperature: { ...policy, fallbackC: 12 } },
      },
    });
    assert.equal(resolved.minimumStandardsStatus, 'match_found');
    assert.equal(resolved.resolvedMinimumTemperature.valueC, 12);
    assert.equal(resolved.weather.cache.misses, 0);
  },
);

integration(
  'a missing field at a later route location leaves that route unknown, never dry or calm',
  async (h) => {
    h.use(
      metOffice(({ request }) => {
        const url = new URL(request.url);
        const forecast = hourlyForecast(request, {
          values: () => ({ probOfPrecipitation: 40 }),
        });
        if (
          Number(url.searchParams.get('longitude')) < -0.5 &&
          Number(url.searchParams.get('latitude')) > 51.49
        ) {
          for (const feature of forecast.features)
            for (const row of feature.properties.timeSeries)
              Reflect.deleteProperty(row, 'probOfPrecipitation');
        }
        return HttpResponse.json(forecast);
      }),
    );
    const missing = await upload(h, 'Missing location', -1);
    const known = await upload(h, 'Known wet ride', -0.1);
    const result = await recommend(h, [missing.id, known.id], {
      preferences: {
        minimumStandards: { maximumPrecipitationProbability: 0.2 },
      },
    });
    assert.equal(result.recommendedRouteId, known.id);
    assert.equal(result.minimumStandardsStatus, 'unknown');
    assert.equal(first(result.rankings).best.standards.status, 'below');
    assert.equal(first(result.unranked).routeId, missing.id);
    assert.ok(
      first(result.unranked).issues.includes('missing-weather-at-arrival'),
    );
  },
);

integration(
  'a limited forecast horizon keeps covered departures and discloses the unknown alternatives',
  async (h) => {
    h.use(
      metOffice(({ request }) =>
        HttpResponse.json(
          hourlyForecast(request, { firstHour: 10, lastHour: 14 }),
        ),
      ),
    );
    const route = await upload(h);
    const result = await recommend(h, [route.id], {
      preferences: {
        minimumStandards: { minimumTemperature: { kind: 'fixed', valueC: 20 } },
      },
    });
    assert.equal(result.minimumStandardsStatus, 'unknown');
    const ride = first(result.rankings);
    assert.ok(ride.departuresAssessed > 0);
    assert.ok(ride.departuresUnknown > 0);
    assert.ok(
      Date.parse(ride.best.departureAt) >= Date.parse('2026-10-10T09:30:00Z'),
    );
    assert.ok(
      Date.parse(ride.best.finishAt) < Date.parse('2026-10-10T14:00:00Z'),
    );
    assert.ok(
      ride.warnings.join(' ').includes('Some departures could not be assessed'),
    );
  },
);

for (const [status, code] of [
  [401, 'unauthorized'],
  [429, 'rate-limited'],
  [503, 'upstream-unavailable'],
] as const) {
  integration(
    `Met Office ${status} is explicit, sanitized, not cached, and can recover on a later request`,
    async (h) => {
      h.use(
        metOffice(
          () =>
            new HttpResponse(`Upstream echoed ${WEATHER_KEY}`, {
              status,
              headers: { 'Retry-After': '42' },
            }),
        ),
      );
      const route = await upload(h);
      const failed = await recommend(h, [route.id]);
      assert.equal(failed.recommendedRouteId, null);
      assert.equal(first(failed.unranked).status, 'unassessable');
      assert.equal(
        failed.weather.locations.every((location) =>
          location.issues.some((issue) => issue.code === code),
        ),
        true,
      );
      assert.ok(!JSON.stringify(failed).includes(WEATHER_KEY));
      assert.equal(
        (await (await h.runtime.getKVNamespace('WEATHER_CACHE')).list()).keys
          .length,
        0,
      );
      if (status !== 503) assert.ok(h.requests.length <= 4);
      if (status === 429)
        assert.equal(
          first(first(failed.weather.locations).issues).retryAfterSeconds,
          42,
        );
      const calls = h.requests.length;
      h.use(metOffice());
      const recovered = await recommend(h, [route.id]);
      assert.equal(recovered.recommendedRouteId, route.id);
      assert.ok(h.requests.length > calls);
    },
  );
}

integration(
  'redirects are rejected in the Workers runtime without forwarding the weather key',
  async (h) => {
    h.use(
      metOffice(
        () =>
          new HttpResponse(null, {
            status: 302,
            headers: { Location: 'https://untrusted.example/steal-key' },
          }),
      ),
    );
    const route = await upload(h);
    const result = await recommend(h, [route.id]);
    assert.equal(result.recommendedRouteId, null);
    assert.ok(h.requests.length > 0);
    assert.equal(
      h.requests.every((request) =>
        request.url.startsWith(`${MET_OFFICE_HOURLY}?`),
      ),
      true,
    );
  },
);

for (const scenario of [
  'invalid-json',
  'wrong-units',
  'too-distant',
] as const) {
  integration(
    `${scenario} weather cannot produce a recommendation`,
    async (h) => {
      h.use(
        metOffice(({ request }) => {
          if (scenario === 'invalid-json')
            return new HttpResponse('{not-json', {
              headers: { 'Content-Type': 'application/json' },
            });
          const forecast = hourlyForecast(request, {
            offsetLatitude: scenario === 'too-distant' ? 1 : 0,
          });
          if (scenario === 'wrong-units')
            first(forecast.parameters).screenTemperature.unit.symbol.type = 'F';
          return HttpResponse.json(forecast);
        }),
      );
      const route = await upload(h);
      const result = await recommend(h, [route.id]);
      assert.equal(result.recommendedRouteId, null);
      assert.equal(result.rankings.length, 0);
      const codes = result.weather.locations.flatMap((location) =>
        location.issues.map((issue) => issue.code),
      );
      assert.ok(
        codes.includes(
          scenario === 'too-distant' ? 'outside-coverage' : 'invalid-response',
        ),
      );
    },
  );
}

integration(
  'KV corruption is repaired, retrieval TTL expires, and a stale model is never rescued by cache',
  async (h) => {
    h.use(metOffice());
    const route = await upload(h);
    await recommend(h, [route.id]);
    const initialCalls = h.requests.length;
    const kv = await h.runtime.getKVNamespace('WEATHER_CACHE');
    const entry = first((await kv.list()).keys);
    await kv.put(entry.name, '{broken');
    const repaired = await recommend(h, [route.id]);
    assert.equal(repaired.recommendedRouteId, route.id);
    assert.deepEqual(repaired.weather.cache, { hits: 5, misses: 1 });
    assert.equal(h.requests.length, initialCalls + 1);
    await h.restart({ TEST_NOW: '2026-10-09T12:21:00.000Z' });
    const expired = await recommend(h, [route.id]);
    assert.deepEqual(expired.weather.cache, { hits: 0, misses: 6 });
    assert.equal(expired.recommendedRouteId, route.id);
    await h.restart({ TEST_NOW: '2026-10-09T18:01:00.000Z' });
    const stale = await recommend(h, [route.id]);
    assert.equal(stale.recommendedRouteId, null);
    assert.equal(stale.weather.cache.hits, 0);
    assert.equal(
      stale.weather.locations.every((location) =>
        location.issues.some((issue) => issue.code === 'stale-data'),
      ),
      true,
    );
  },
);

integration(
  'auth and D1 ownership prevent another rider from listing or recommending a route without spending weather quota',
  async (h) => {
    const route = await upload(h);
    assert.equal((await h.send('/routes', { token: null })).status, 401);
    assert.equal(
      (
        await h.send('/recommendations', {
          token: 'incorrect-token-that-is-long-enough',
          body: '{}',
        })
      ).status,
      401,
    );
    const listed = await h.send('/routes', { token: BOB_TOKEN });
    assert.equal(
      z.object({ routes: z.array(z.unknown()) }).parse(await listed.json())
        .routes.length,
      0,
    );
    const requested = await h.send('/recommendations', {
      token: BOB_TOKEN,
      body: JSON.stringify({ routeIds: [route.id], date: RIDE_DATE }),
    });
    assert.equal(requested.status, 404);
    assert.deepEqual((await requested.json()) as object, {
      error: {
        code: 'ROUTE_NOT_FOUND',
        message: 'One or more routes were not found.',
      },
    });
    assert.equal(h.requests.length, 0);
  },
);

integration(
  'invalid GPX and invalid recommendation inputs fail before database writes or upstream requests',
  async (h) => {
    for (const body of [
      '<broken>',
      routeGpx('Invalid').replace('lat="51.2"', 'lat="NaN"'),
    ]) {
      assert.equal(
        (await h.send('/routes', { body, contentType: 'application/gpx+xml' }))
          .status,
        422,
      );
    }
    const db = await h.runtime.getD1Database('ROUTES_DB');
    assert.equal(
      await db
        .prepare('SELECT count(*) AS count FROM routes')
        .first<number>('count'),
      0,
    );
    const route = await upload(h);
    for (const changes of [
      { date: '2026-02-30' },
      { timeZone: 'Missing/Zone' },
      { preferences: { minimumStandards: { minimumTemprature: 15 } } },
      { riding: { averageSpeedKph: 0 } },
    ]) {
      const response = await h.send('/recommendations', {
        body: JSON.stringify({
          routeIds: [route.id],
          date: RIDE_DATE,
          ...changes,
        }),
      });
      assert.equal(response.status, 400);
    }
    assert.equal(
      (await h.send('/recommendations', { body: 'x'.repeat(65_000) })).status,
      413,
    );
    assert.equal(h.requests.length, 0);
  },
);

integration(
  'an impossible daylight ride and an unconfigured provider never make weather requests',
  async (h) => {
    const route = await upload(h);
    const past = await recommend(h, [route.id], { date: '2026-10-08' });
    assert.equal(past.recommendedRouteId, null);
    assert.equal(first(past.unranked).status, 'no_feasible_departure');
    const absent = await recommend(h, [route.id], {
      weather: { mode: 'strict', providerId: 'unconfigured-source' },
    });
    assert.equal(absent.recommendedRouteId, null);
    assert.equal(
      first(first(absent.weather.locations).issues).code,
      'not-configured',
    );
    assert.equal(h.requests.length, 0);
  },
);

integration(
  'multipart GPX import preserves the supplied name and rejects ambiguous multi-file uploads atomically',
  async (h) => {
    const multipart = async (count: number) => {
      const form = new FormData();
      for (let index = 0; index < count; index++)
        form.append(
          'file',
          new File([routeGpx('Embedded name')], `route-${index}.gpx`, {
            type: 'application/gpx+xml',
          }),
        );
      form.set('name', "Afternoon ride'); DROP TABLE routes; --");
      const encoded = new Request('https://upload.test', {
        method: 'POST',
        body: form,
      });
      const contentType = encoded.headers.get('Content-Type');
      assert.ok(contentType);
      return h.send('/routes', { body: await encoded.text(), contentType });
    };
    assert.equal((await multipart(2)).status, 400);
    const db = await h.runtime.getD1Database('ROUTES_DB');
    assert.equal(
      await db
        .prepare('SELECT count(*) AS count FROM routes')
        .first<number>('count'),
      0,
    );
    const accepted = await multipart(1);
    assert.equal(accepted.status, 201);
    const body = z
      .object({ route: z.object({ name: z.string() }) })
      .parse(await accepted.json());
    assert.equal(body.route.name, "Afternoon ride'); DROP TABLE routes; --");
    assert.equal(
      await db
        .prepare('SELECT count(*) AS count FROM routes')
        .first<number>('count'),
      1,
    );
    assert.equal(h.requests.length, 0);
  },
);

// Deliberately bypass the normal zero-unhandled-request teardown to test the guard itself.
test('an absent MSW handler is recorded and denied rather than reaching the real weather service', {
  timeout: 15_000,
}, async () => {
  const h = await createHarness();
  try {
    const route = await upload(h);
    const result = await recommend(h, [route.id]);
    assert.equal(result.recommendedRouteId, null);
    assert.equal(h.unexpected.length, 6);
    assert.ok(
      h.unexpected.every((request) =>
        request.startsWith(`GET ${MET_OFFICE_HOURLY}?`),
      ),
    );
    assert.deepEqual(h.handlerErrors, []);
  } finally {
    await h.dispose();
  }
});
