import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HttpResponse, http } from 'msw/http';
import { BPF_ENDPOINT } from '../src/weather/met-office-bpf.ts';
import { bpfFixture, bpfSites } from '../test/fixtures/bpf.ts';
import { first, recommend, upload } from './client.ts';
import { createHarness, type Harness } from './harness.ts';

const profile = {
  weather: { mode: 'strict', providerId: 'met-office-bpf' },
  forecast: {
    representation: 'ensemble-summary',
    freshnessBasis: 'retrieval-time',
  },
  preferences: {
    weights: { temperature: 0.15, wind: 0.2, dryness: 0.2, clearSkies: 0.45 },
  },
};
const sites = Array.from({ length: 13 }, (_, i) => ({
  latitude: 51.2 + i * 0.03,
  longitude: -1,
}));
const mock = (change?: (body: ReturnType<typeof bpfFixture>) => void) =>
  http.get(`${BPF_ENDPOINT}/collections/*`, ({ request }) => {
    assert.equal(
      request.headers.get('apikey'),
      'integration-bpf-key-not-a-real-secret',
    );
    assert.ok(!request.url.includes('integration-bpf-key'));
    const site = new URL(request.url).pathname.split('/locations/')[1];
    if (!site) return HttpResponse.json(bpfSites(sites));
    const [, lat, lon] = decodeURIComponent(site).split(':');
    const body = bpfFixture({
      latitude: Number(lat),
      longitude: Number(lon),
      probabilities: request.url.includes('uk-spot-probabilities'),
    });
    change?.(body);
    return HttpResponse.json(body);
  });
const integration = (name: string, run: (h: Harness) => Promise<void>) =>
  test(name, { timeout: 15_000 }, async () => {
    const h = await createHarness();
    try {
      await run(h);
    } finally {
      await h.dispose();
      assert.deepEqual(h.unexpected, []);
      assert.deepEqual(h.handlerErrors, []);
    }
  });

integration(
  'real Worker/D1/KV uses BPF cloud medians, native probabilities and reusable forecasts',
  async (h) => {
    h.use(mock());
    const route = await upload(h);
    const result = await recommend(h, [route.id], profile);
    const ride = first(result.rankings);
    assert.equal(result.weather.selectedSource?.providerId, 'met-office-bpf');
    assert.equal(ride.departuresUnknown, 0);
    assert.equal(ride.best.conditions.cloudCoverFraction?.mean, 0.1);
    assert.equal(ride.best.conditions.averageWindSpeedKph, 7.2);
    assert.equal(ride.best.conditions.maximumGustKph, 14.4);
    assert.equal(ride.best.conditions.maximumPrecipitationProbability, 0.08);
    assert.equal(ride.best.conditions.temperatureC.minimum, 14);
    assert.ok(
      ride.best.rideHours.every(
        (hour) => hour.conditions?.cloudCoverFraction?.mean === 0.1,
      ),
    );
    assert.equal(
      first(result.weather.locations).provenance?.forecastRunAt,
      undefined,
    );
    assert.ok(
      result.weather.locations.every((l) =>
        l.issues.some((i) => i.code === 'unknown-model-run'),
      ),
    );
    const calls = h.requests.length;
    assert.ok(calls > 2);
    await h.restart();
    const second = await recommend(h, [route.id], {
      ...profile,
      preferences: {
        weights: { temperature: 0.2, wind: 0.2, dryness: 0.2, clearSkies: 0.4 },
      },
    });
    assert.equal(h.requests.length, calls);
    assert.equal(second.weather.cache.misses, 0);
    assert.equal(second.weather.cache.hits, result.weather.locations.length);
  },
);

integration(
  'missing numeric cloud excludes rides without falling back or inventing clear skies',
  async (h) => {
    h.use(
      mock((body) => {
        body.coverages = body.coverages.filter(
          (c) => c.id !== 'cloudAreaFraction',
        );
      }),
    );
    const route = await upload(h);
    const result = await recommend(h, [route.id], profile);
    assert.equal(result.recommendedRouteId, null);
    assert.equal(first(result.unranked).status, 'unassessable');
    assert.ok(
      result.weather.locations.every((l) =>
        l.issues.some((i) => i.code === 'missing-data'),
      ),
    );
    assert.ok(h.requests.every((r) => r.url.startsWith(BPF_ENDPOINT)));
  },
);

integration(
  'sunshine uses BPF categorical weather even when cloud fraction is high',
  async (h) => {
    h.use(
      mock((body) => {
        const cloud = body.coverages.find((c) => c.id === 'cloudAreaFraction');
        if (cloud) first(Object.values(cloud.ranges)).values.fill(0.9);
      }),
    );
    const route = await upload(h);
    const result = await recommend(h, [route.id], {
      ...profile,
      preferences: {
        weights: {
          temperature: 0.15,
          wind: 0.2,
          dryness: 0.2,
          clearSkies: 0,
          sunshine: 0.45,
        },
      },
    });
    const conditions = first(result.rankings).best.conditions;
    assert.equal(conditions.skyConditionDistanceFractions?.sunnyIntervals, 1);
    assert.equal(conditions.cloudCoverFraction, null);
    const calls = h.requests.length;
    await h.restart();
    const repeat = await recommend(h, [route.id], {
      ...profile,
      preferences: { weights: { sunshine: 0.45 } },
    });
    assert.equal(repeat.recommendedRouteId, route.id);
    assert.equal(h.requests.length, calls);
  },
);

integration(
  'BPF requires explicit representation and retrieval freshness before spending quota',
  async (h) => {
    const route = await upload(h);
    const result = await recommend(h, [route.id], {
      weather: profile.weather,
      forecast: { freshnessBasis: 'model-run' },
    });
    assert.equal(result.recommendedRouteId, null);
    assert.ok(
      result.weather.locations.every((l) =>
        l.issues.some((i) => i.code === 'unknown-model-run'),
      ),
    );
    const unsupported = await recommend(h, [route.id], {
      weather: profile.weather,
      forecast: { freshnessBasis: 'retrieval-time' },
    });
    assert.equal(unsupported.recommendedRouteId, null);
    assert.ok(
      unsupported.weather.locations.every((l) =>
        l.issues.some((i) => i.code === 'unsupported-statistic'),
      ),
    );
    assert.equal(h.requests.length, 0);
  },
);

integration(
  'quota failure leaves the comparison unknown and never caches an invented forecast',
  async (h) => {
    h.use(
      http.get(
        `${BPF_ENDPOINT}/*`,
        () =>
          new HttpResponse('private upstream details', {
            status: 429,
            headers: { 'Retry-After': '600' },
          }),
      ),
    );
    const route = await upload(h);
    const result = await recommend(h, [route.id], profile);
    assert.equal(result.recommendedRouteId, null);
    assert.equal(h.requests.length, 1);
    assert.ok(
      result.weather.locations.every(
        (l) =>
          l.issues[0]?.code === 'rate-limited' &&
          l.issues[0]?.retryAfterSeconds === 600,
      ),
    );
    assert.ok(!JSON.stringify(result).includes('private upstream'));
    h.use(mock());
    assert.equal(
      (await recommend(h, [route.id], profile)).recommendedRouteId,
      route.id,
    );
  },
);
