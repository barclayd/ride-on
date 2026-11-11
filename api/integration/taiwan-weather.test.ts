import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exportPKCS8, generateKeyPair } from 'jose';
import { HttpResponse, http } from 'msw/http';
import { z } from 'zod';
import type { publicTracking } from '../src/tracking/store.ts';
import catalogue from '../src/weather/cwa-locations.json' with { type: 'json' };
import { BPF_ENDPOINT } from '../src/weather/met-office-bpf.ts';
import { appleWeatherFixture } from '../test/fixtures/apple-weather.ts';
import { bpfFixture, bpfSites } from '../test/fixtures/bpf.ts';
import { taipeiGpx, taipeiRoutes } from '../test/fixtures/taipei.ts';
import { first, recommend, upload } from './client.ts';
import { createHarness, type Harness } from './harness.ts';

const keys = await generateKeyPair('ES256', { extractable: true });
const config = JSON.stringify({
  teamId: 'TESTTEAM01',
  keyId: 'TESTKEY001',
  serviceId: 'cc.ride-on.synthetic-taiwan',
  privateKey: await exportPKCS8(keys.privateKey),
});
const settings = {
  timeZone: 'Asia/Taipei',
  riding: { window: { start: '06:30', end: '14:00' } },
};
const apple = (
  options: {
    gust?: number;
    rain?: number;
    missingGust?: boolean;
    unknownSky?: boolean;
  } = {},
) =>
  http.get(
    'https://weatherkit.apple.com/api/v1/weather/en/:latitude/:longitude',
    ({ params }) => {
      const data = appleWeatherFixture({
        latitude: Number(params.latitude),
        longitude: Number(params.longitude),
        start: '2026-10-09T12:00:00Z',
        hours: 120,
      });
      for (const row of data.forecastHourly.hours) {
        Object.assign(row, {
          temperature: 22,
          windSpeed: 0,
          windGust: options.gust ?? 0,
          precipitationAmount: options.rain ?? 0,
          precipitationChance: 0,
          cloudCover: 0,
        });
        if (options.missingGust) Reflect.deleteProperty(row, 'windGust');
        if (options.unknownSky) row.conditionCode = 'NewUnknownSymbol';
      }
      return HttpResponse.json(data);
    },
  );
const cwa = (
  options: {
    probability?: number;
    wind?: number;
    direction?: string;
    clearsAt?: string;
  } = {},
) =>
  http.get(
    'https://opendata.cwa.gov.tw/api/v1/rest/datastore/:dataset',
    ({ request, params }) => {
      assert.equal(request.headers.get('Authorization'), 'synthetic-cwa-key');
      const url = new URL(request.url);
      assert.equal(url.searchParams.has('Authorization'), false);
      const sites = catalogue.filter(
        (s) =>
          s.datasetId === params.dataset &&
          url.searchParams.get('LocationName')?.split(',').includes(s.name),
      );
      assert.ok(sites.length);
      const start = Date.parse('2026-10-09T13:00:00Z');
      const elements = [
        ['溫度', 'Temperature', '22'],
        ['體感溫度', 'ApparentTemperature', '22'],
        ['風速', 'WindSpeed', String(options.wind ?? 0)],
        ['風向', 'WindDirection', options.direction ?? '東風'],
        [
          '3小時降雨機率',
          'ProbabilityOfPrecipitation',
          String(options.probability ?? 0),
        ],
      ];
      return HttpResponse.json({
        success: 'true',
        result: { resource_id: params.dataset },
        records: {
          Locations: [
            {
              Dataid: String(params.dataset).slice(2),
              Location: sites.map((s) => ({
                LocationName: s.name,
                Geocode: s.geocode,
                Latitude: String(s.latitude),
                Longitude: String(s.longitude),
                WeatherElement: elements.map(
                  ([ElementName = '', key = '', value = '']) => ({
                    ElementName,
                    Time: Array.from({ length: 25 }, (_, i) => {
                      const at = start + i * 3 * 3600000;
                      const iso = new Date(at).toISOString();
                      const rain = key === 'ProbabilityOfPrecipitation';
                      return {
                        ...(rain
                          ? {
                              StartTime: iso,
                              EndTime: new Date(at + 3 * 3600000).toISOString(),
                            }
                          : { DataTime: iso }),
                        ElementValue: [
                          {
                            [key]:
                              rain &&
                              options.clearsAt &&
                              at >= Date.parse(options.clearsAt)
                                ? '0'
                                : value,
                          },
                        ],
                      };
                    }),
                  }),
                ),
              })),
            },
          ],
        },
      });
    },
  );
const integration = (
  name: string,
  run: (h: Harness, ids: string[]) => Promise<void>,
) =>
  test(name, { timeout: 30000 }, async () => {
    const h = await createHarness();
    try {
      await h.restart({
        APPLE_WEATHER_CONFIG_JSON: config,
        CWA_API_KEY: 'synthetic-cwa-key',
      });
      const ids: string[] = [];
      for (const route of taipeiRoutes) {
        const r = await h.send('/routes', {
          contentType: 'application/gpx+xml',
          body: taipeiGpx(route),
        });
        assert.equal(r.status, 201);
        ids.push(
          z.object({ route: z.object({ id: z.uuid() }) }).parse(await r.json())
            .route.id,
        );
      }
      await run(h, ids);
    } finally {
      await h.dispose();
      assert.deepEqual(h.unexpected, []);
      assert.deepEqual(h.handlerErrors, []);
    }
  });

integration(
  'CWA selection covers the route sections beyond each weather sample',
  async (h) => {
    h.use(cwa(), apple());
    // Synthetic coastal line, not a surveyed cycling track or a user's GPX.
    const points = [
      [23.59, 121.51],
      [23.62, 121.52],
      [23.65, 121.53],
      [23.68, 121.535],
      [23.71, 121.54],
      [23.74, 121.545],
      [23.77, 121.55],
    ];
    const response = await h.send('/routes', {
      contentType: 'application/gpx+xml',
      body: `<gpx version="1.1"><trk><name>Hualien synthetic coast</name><trkseg>${points.map(([lat, lon]) => `<trkpt lat="${lat}" lon="${lon}"><ele>10</ele></trkpt>`).join('')}</trkseg></trk></gpx>`,
    });
    assert.equal(response.status, 201);
    const { route } = z
      .object({ route: z.object({ id: z.uuid() }) })
      .parse(await response.json());
    const result = await recommend(h, [route.id], {
      ...settings,
      weatherProviderId: 'met-office',
    });
    assert.equal(result.weather.selectedSource?.providerId, 'taiwan-weather');
    assert.equal(result.rankings.length, 1);
    assert.deepEqual(result.unranked, []);
    assert.equal(first(result.rankings).departuresUnknown, 0);
    const temperatures = result.weather.locations
      .flatMap((l) => l.fieldEvidence ?? [])
      .filter(
        (e) =>
          e.descriptor.kind === 'scalar' &&
          e.descriptor.measure.quantity === 'air-temperature',
      );
    const sources = new Set(
      temperatures.flatMap((e) =>
        e.sources.map((s) => s.provenance.source.providerId),
      ),
    );
    assert.deepEqual(sources, new Set(['cwa', 'apple-weather']));
  },
);

integration(
  'automatic Taiwan scoring uses both sources, local daylight and durable field evidence',
  async (h, ids) => {
    h.use(cwa(), apple());
    const result = await recommend(h, ids, settings);
    assert.equal(result.weather.selectedSource?.providerId, 'taiwan-weather');
    assert.equal(result.rankings.length, 2);
    assert.deepEqual(result.unranked, []);
    for (const route of result.rankings) {
      assert.equal(route.best.score, 100);
      assert.equal(route.best.departureAt, '2026-10-09T22:30:00.000Z');
      assert.equal(route.departuresUnknown, 0);
      assert.ok(
        Date.parse(route.best.departureAt) >= Date.parse(route.daylight.start),
      );
      assert.ok(
        Date.parse(route.best.finishAt) <= Date.parse(route.daylight.end),
      );
    }
    const evidence = first(result.weather.locations).fieldEvidence ?? [];
    const probability = first(
      evidence.filter((e) => e.descriptor.kind === 'probability'),
    );
    assert.ok(
      probability.sources.some(
        (s) =>
          s.nativeTimeStepSeconds === 10800 &&
          s.provenance.source.providerId === 'cwa',
      ),
    );
    assert.ok(
      evidence.some(
        (e) =>
          e.descriptor.kind === 'scalar' &&
          e.descriptor.measure.quantity === 'wind-gust' &&
          e.sources.every(
            (s) => s.provenance.source.providerId === 'apple-weather',
          ),
      ),
    );
    const calls = h.requests.length;
    // Four route samples, batched into one CWA county request and four Apple calls.
    assert.equal(calls, 5);
    await h.restart();
    const cached = await recommend(h, ids, settings);
    assert.equal(h.requests.length, calls);
    assert.deepEqual(cached.rankings, result.rankings);
    assert.deepEqual(cached.weather.locations, result.weather.locations);
    const nextResponse = await h.send('/recommendations/next-windows', {
      body: JSON.stringify({
        routeIds: ids,
        after: { date: '2026-10-09', window: 'daylight' },
        timeZone: settings.timeZone,
      }),
    });
    assert.equal(nextResponse.status, 200, await nextResponse.clone().text());
    const next = z
      .object({
        windows: z.array(z.unknown()),
        weather: z.object({
          selectedSource: z.object({ providerId: z.string() }),
        }),
      })
      .parse(await nextResponse.json());
    assert.equal(next.weather.selectedSource.providerId, 'taiwan-weather');
    assert.ok(next.windows.length > 0);
    assert.equal(h.requests.length, calls);
  },
);

integration(
  'CWA probability and Apple rainfall produce the expected rain penalty of 58',
  async (h, ids) => {
    h.use(cwa({ probability: 80 }), apple({ rain: 2 }));
    const result = await recommend(h, ids, settings);
    assert.equal(result.rankings.length, 2);
    for (const route of result.rankings) {
      assert.equal(route.best.score, 58);
      assert.equal(route.best.conditions.maximumPrecipitationProbability, 0.8);
      assert.equal(route.best.conditions.maximumPrecipitationRateMmH, 2);
      assert.equal(route.best.conditions.maximumPrecipitationAmountMm, 2);
      assert.equal(route.departuresUnknown, 0);
    }
  },
);

for (const direction of ['東風', '西風'])
  integration(
    `CWA ${direction} reverses route preference while Apple gusts enforce minimum standards`,
    async (h, ids) => {
      h.use(cwa({ wind: 8, direction }), apple({ gust: 38 }));
      const result = await recommend(h, ids, settings);
      assert.equal(result.rankings.length, 2);
      assert.equal(
        result.recommendedRouteId,
        ids[direction === '東風' ? 0 : 1],
      );
      for (const route of result.rankings) {
        assert.equal(route.best.conditions.averageWindSpeedKph, 28.8);
        assert.equal(route.best.conditions.maximumGustKph, 38);
        assert.equal(route.departuresUnknown, 0);
      }
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
  'CWA three-hour rain events influence every hour until their end',
  async (h, ids) => {
    h.use(cwa({ probability: 80, clearsAt: '2026-10-10T01:00:00Z' }), apple());
    const result = await recommend(h, ids, settings);
    assert.equal(result.rankings.length, 2);
    assert.ok(
      result.rankings.every(
        (r) =>
          r.best.departureAt === '2026-10-10T01:00:00.000Z' &&
          r.best.score === 100,
      ),
    );
  },
);

integration(
  'Apple-only coverage beyond CWA horizon and optional sunshine remain assessable',
  async (h, ids) => {
    h.use(cwa(), apple());
    const result = await recommend(h, ids, {
      ...settings,
      date: '2026-10-13',
      preferences: { weights: { clearSkies: 0.2, sunshine: 0.2 } },
    });
    assert.equal(result.rankings.length, 2);
    assert.ok(
      result.rankings.every(
        (r) => r.best.score === 100 && r.departuresUnknown === 0,
      ),
    );
    const weather = await recommend(h, ids, {
      ...settings,
      preferences: { weights: { clearSkies: 0.2, sunshine: 0.2 } },
    });
    assert.equal(weather.rankings.length, 2);
    assert.ok(weather.rankings.every((r) => r.best.score === 100));
  },
);

integration(
  'missing supplementary gusts prevent scores and do not become calm weather',
  async (h, ids) => {
    h.use(cwa(), apple({ missingGust: true }));
    const result = await recommend(h, ids, settings);
    assert.deepEqual(result.rankings, []);
    assert.equal(result.unranked.length, 2);
    assert.ok(result.unranked.every((r) => r.status === 'unassessable'));
  },
);

integration(
  'CWA failure is disclosed by Apple field evidence and still supplies complete ride forecasts',
  async (h, ids) => {
    h.use(
      http.get(
        'https://opendata.cwa.gov.tw/api/v1/rest/datastore/:dataset',
        () => new HttpResponse(null, { status: 503 }),
      ),
      apple(),
    );
    const result = await recommend(h, ids, settings);
    assert.equal(result.rankings.length, 2);
    const evidence = result.weather.locations
      .flatMap((l) => l.fieldEvidence ?? [])
      .flatMap((e) => e.sources);
    assert.ok(evidence.length > 0);
    assert.ok(
      evidence.every((e) => e.provenance.source.providerId === 'apple-weather'),
    );
  },
);

const bpf = (quota = false) =>
  http.get(`${BPF_ENDPOINT}/collections/*`, ({ request }) => {
    if (quota)
      return new HttpResponse(null, {
        status: 429,
        headers: { 'Retry-After': '600' },
      });
    const site = new URL(request.url).pathname.split('/locations/')[1];
    if (!site)
      return HttpResponse.json(
        bpfSites(
          Array.from({ length: 13 }, (_, i) => ({
            latitude: 51.2 + i * 0.03,
            longitude: -1,
          })),
        ),
      );
    const [, latitude, longitude] = decodeURIComponent(site).split(':');
    return HttpResponse.json(
      bpfFixture({
        latitude: Number(latitude),
        longitude: Number(longitude),
        probabilities: request.url.includes('uk-spot-probabilities'),
      }),
    );
  });

for (const provider of ['automatic', 'apple-weather', 'met-office'])
  integration(
    `Taiwan overrides saved and requested ${provider}, including mixed-country shortlists`,
    async (h, ids) => {
      h.use(cwa({ probability: 80 }), apple(), bpf());
      const saved = await h.send('/users', {
        body: JSON.stringify({
          displayName: 'Existing rider',
          settings: { weatherProviderId: provider },
        }),
      });
      assert.equal(saved.status, 201);
      const profile = await (await h.send('/users/me')).json();
      for (const extra of [{}, { weatherProviderId: provider }]) {
        const explicit = await recommend(h, ids, { ...settings, ...extra });
        assert.equal(
          explicit.weather.selectedSource?.providerId,
          'taiwan-weather',
        );
        assert.equal(explicit.rankings.length, 2);
        assert.ok(
          explicit.rankings.every(
            (r) => r.best.conditions.maximumPrecipitationProbability === 0.8,
          ),
        );
      }
      const uk = await upload(h);
      const mixedSettings = {
        timeZone: 'Europe/London',
        riding: { window: 'daylight' },
      };
      const mixed = await recommend(h, [...ids, uk.id], mixedSettings);
      assert.equal(mixed.weather.selectedSource, null);
      assert.equal(mixed.rankings.length, 3);
      assert.ok(mixed.rankings.every((r) => r.departuresUnknown === 0));
      for (const route of mixed.rankings) {
        const expected = ids.includes(route.routeId)
          ? 'taiwan-weather'
          : provider === 'met-office'
            ? 'met-office-bpf'
            : 'apple-weather';
        assert.ok(
          route.best.forecastDetails.locations.every(
            (location) => location.source.providerId === expected,
          ),
        );
        assert.equal(
          route.best.conditions.maximumPrecipitationProbability,
          ids.includes(route.routeId)
            ? 0.8
            : provider === 'met-office'
              ? 0.081
              : 0,
        );
      }
      const calls = h.requests.length;
      await h.restart();
      const cached = await recommend(h, [...ids, uk.id], mixedSettings);
      assert.deepEqual(cached.rankings, mixed.rankings);
      assert.equal(h.requests.length, calls);
      assert.deepEqual(await (await h.send('/users/me')).json(), profile);
      // Reversing input order must not change regional selection or scores.
      const reversed = await recommend(
        h,
        [uk.id, ...ids].reverse(),
        mixedSettings,
      );
      assert.deepEqual(reversed.rankings, mixed.rankings);
      const next = await h.send('/recommendations/next-windows', {
        body: JSON.stringify({
          routeIds: [...ids, uk.id],
          after: { date: '2026-10-09', window: 'daylight' },
          timeZone: mixedSettings.timeZone,
        }),
      });
      assert.equal(next.status, 200, await next.clone().text());
      const nextResult = z
        .object({
          weather: z.object({
            routeSources: z.array(
              z.object({
                routeId: z.string(),
                selectedSource: z.object({ providerId: z.string() }).nullable(),
              }),
            ),
          }),
        })
        .parse(await next.json());
      assert.ok(
        nextResult.weather.routeSources
          .filter((r) => ids.includes(r.routeId))
          .every((r) => r.selectedSource?.providerId === 'taiwan-weather'),
      );
    },
  );

integration(
  'Met Office quota fallback in a mixed shortlist cannot switch Taiwan away from CWA',
  async (h, ids) => {
    h.use(cwa({ probability: 80 }), apple(), bpf(true));
    const uk = await upload(h);
    const result = await recommend(h, [...ids, uk.id], {
      timeZone: 'Europe/London',
      weatherProviderId: 'met-office',
      riding: { window: 'daylight' },
    });
    assert.equal(result.rankings.length, 3);
    for (const route of result.rankings)
      assert.ok(
        route.best.forecastDetails.locations.every(
          (l) =>
            l.source.providerId ===
            (route.routeId === uk.id ? 'apple-weather' : 'taiwan-weather'),
        ),
      );
  },
);

integration(
  'Apple supplement quota failure is not retried as a second Apple policy',
  async (h, ids) => {
    h.use(
      cwa(),
      http.get(
        'https://weatherkit.apple.com/api/v1/weather/en/:latitude/:longitude',
        () =>
          new HttpResponse(null, {
            status: 429,
            headers: { 'Retry-After': '600' },
          }),
      ),
    );
    const result = await recommend(h, ids, settings);
    assert.equal(result.recommendedRouteId, null);
    assert.equal(result.weather.attempts.length, 1);
    assert.equal(result.weather.selectedSource?.providerId, 'taiwan-weather');
    assert.ok(
      result.weather.locations.every((l) =>
        l.issues.some((i) => i.code === 'rate-limited'),
      ),
    );
    assert.ok(
      h.requests.filter(
        (r) => new URL(r.url).hostname === 'weatherkit.apple.com',
      ).length <= 4,
    );
  },
);

integration(
  'tracked Taiwan departures retain CWA across saved-provider changes and mixed comparisons',
  async (h, ids) => {
    h.use(cwa(), apple(), bpf());
    const uk = await upload(h);
    assert.equal(
      (
        await h.send('/users', {
          body: JSON.stringify({
            displayName: 'Traveller',
            settings: {
              weatherProviderId: 'met-office',
              timeZone: 'Europe/London',
            },
          }),
        })
      ).status,
      201,
    );
    const response = await h.send('/recommendations', {
      body: JSON.stringify({ routeIds: [...ids, uk.id], date: '2026-10-10' }),
    });
    assert.equal(response.status, 200);
    const recommendation = z
      .object({
        forecast: z.object({
          representation: z.string(),
          freshnessBasis: z.string(),
        }),
        days: z.array(
          z.object({
            availability: z.string(),
            coverage: z.array(
              z.object({
                routeId: z.string(),
                intervals: z.array(z.unknown()),
              }),
            ),
          }),
        ),
        rankings: z.array(
          z.object({
            routeId: z.string(),
            best: z.object({ recommendationRef: z.string() }),
          }),
        ),
      })
      .parse(await response.json());
    assert.equal(recommendation.forecast.representation, 'mixed');
    assert.equal(recommendation.forecast.freshnessBasis, 'retrieval-time');
    assert.equal(first(recommendation.days).availability, 'full');
    assert.ok(
      first(recommendation.days).coverage.every(
        (route) => route.intervals.length > 0,
      ),
    );
    const taiwan = recommendation.rankings.find((r) => ids.includes(r.routeId));
    assert.ok(taiwan);
    const tracked = await h.send('/tracked-rides', {
      headers: { 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({
        recommendationRef: taiwan.best.recommendationRef,
        expectedTrackingVersion: 0,
        replaceTrackedRideId: null,
      }),
    });
    assert.equal(tracked.status, 201, await tracked.clone().text());
    const created = (await tracked.json()) as {
      ride: ReturnType<typeof publicTracking>;
    };
    assert.equal(created.ride.refresh.result, 'assessed');
    assert.equal(
      (
        await h.send('/users/me', {
          method: 'PATCH',
          body: JSON.stringify({
            expectedVersion: 1,
            settings: { weatherProviderId: 'apple-weather' },
          }),
        })
      ).status,
      200,
    );
    const refreshed = await h.send(
      `/tracked-rides/${created.ride.id}/refresh`,
      { method: 'POST' },
    );
    assert.equal(refreshed.status, 200, await refreshed.clone().text());
    const latest = (await (
      await h.send(`/tracked-rides/${created.ride.id}`)
    ).json()) as { ride: ReturnType<typeof publicTracking> };
    assert.equal(latest.ride.refresh.result, 'assessed');
    assert.ok(
      latest.ride.latestAssessment?.pick.candidate.forecastDetails.locations.every(
        (l) => l.source.providerId === 'taiwan-weather',
      ),
    );
    assert.equal(
      latest.ride.latestAssessment?.context.weather.routeSources.find(
        (r) => r.routeId === taiwan.routeId,
      )?.selectedSource?.providerId,
      'taiwan-weather',
    );
  },
);
