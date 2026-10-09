import { describe, expect, test } from 'bun:test';
import type {
  ForecastProvider,
  ForecastRequest,
  LocationForecastResult,
} from '../src/weather/contracts.ts';
import { weatherDescriptors as weather } from '../src/weather/descriptors.ts';
import {
  createMetOfficeGlobalSpot,
  normaliseGlobalSpot,
} from '../src/weather/met-office-global-spot.ts';
import { getForecastForPolicy } from '../src/weather/source-policy.ts';
import { globalSpotFixture } from './fixtures/global-spot.ts';

const location = {
  id: 'route-sample',
  coordinate: { latitude: 52, longitude: -1 },
};
const request: ForecastRequest = {
  locations: [location],
  range: { start: '2026-10-09T10:00:00Z', end: '2026-10-09T12:00:00Z' },
  required: Object.values(weather),
  maxTimeStepSeconds: 3600,
  maxLocationDistanceM: 5000,
  maxAgeSeconds: 6 * 3600,
};
const now = () => new Date('2026-10-09T09:30:00Z');
const signal = () => new AbortController().signal;
const required = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error('Fixture entry is missing');
  return value;
};
const normalise = (raw: unknown, input = request) =>
  normaliseGlobalSpot(raw, location, input, now().toISOString());
const evidence = (result: LocationForecastResult) => {
  if (result.status === 'unavailable') throw new Error('Expected evidence');
  return result;
};

describe('Global Spot normalisation', () => {
  test('preserves units, north wind, probability and distinct statistical periods', () => {
    const result = evidence(normalise(globalSpotFixture()));
    expect(result.status).toBe('complete');
    expect(result.issues).toEqual([]);
    expect(result.location.coordinate).toEqual(location.coordinate);
    expect(result.provenance.dataVersion).toBe('2026-10-09T09:00Z');
    expect(result.issuedAt).toBeNull();
    const [temperature, , wind, direction, gust, amount, , probability] =
      result.series;
    expect(temperature?.samples[0]?.value).toBe(16);
    expect(temperature?.samples).toHaveLength(2);
    expect(direction?.samples[0]?.value).toBe(0);
    expect(wind?.samples[0]?.time).toEqual({
      kind: 'period',
      aggregation: 'mean',
      range: {
        start: '2026-10-09T10:50:00.000Z',
        end: '2026-10-09T11:00:00.000Z',
      },
    });
    expect(gust?.samples[0]?.time).toEqual({
      kind: 'period',
      aggregation: 'maximum',
      range: {
        start: '2026-10-09T10:00:00.000Z',
        end: '2026-10-09T11:00:00.000Z',
      },
    });
    expect(amount?.samples[0]?.time).toEqual({
      kind: 'period',
      aggregation: 'accumulation',
      range: {
        start: '2026-10-09T10:00:00.000Z',
        end: '2026-10-09T11:00:00.000Z',
      },
    });
    expect(probability?.samples[0]).toEqual({
      validAt: '2026-10-09T10:00:00.000Z',
      value: 0.25,
      time: {
        kind: 'period',
        aggregation: 'event',
        range: {
          start: '2026-10-09T09:30:00.000Z',
          end: '2026-10-09T10:30:00.000Z',
        },
      },
    });
    expect(probability?.samples).toHaveLength(3);
  });

  test('marks unknown units and invalid values as partial, retaining valid evidence', () => {
    const fixture = globalSpotFixture();
    required(fixture.parameters[0]).screenTemperature.unit.symbol.type = 'K';
    required(
      required(fixture.features[0]).properties.timeSeries[1],
    ).probOfPrecipitation = 101;
    const result = evidence(normalise(fixture));
    expect(result.status).toBe('partial');
    expect(result.series[0]?.samples[0]?.value).toBeNull();
    expect(result.series[7]?.samples[1]?.value).toBeNull();
    expect(result.issues.map((issue) => issue.code)).toContain(
      'invalid-response',
    );
    expect(result.issues.map((issue) => issue.code)).toContain('missing-data');
  });

  test('does not turn absent fields into zero or reject unrelated future fields', () => {
    const fixture = globalSpotFixture();
    const rows = required(fixture.features[0]).properties.timeSeries;
    const raw = {
      ...fixture,
      features: [
        {
          ...fixture.features[0],
          properties: {
            ...required(fixture.features[0]).properties,
            timeSeries: rows.map(({ windSpeed10m: _, ...row }) => ({
              ...row,
              newWeatherField: 'new-value',
            })),
          },
        },
      ],
    };
    const result = evidence(normalise(raw));
    expect(result.status).toBe('partial');
    expect(
      result.series[2]?.samples.every((sample) => sample.value === null),
    ).toBe(true);
    expect(result.series[0]?.samples[0]?.value).toBe(16);
  });

  test('rejects malformed structures and duplicate validity times', () => {
    expect(normalise({ features: [] }).status).toBe('unavailable');
    const fixture = globalSpotFixture();
    required(required(fixture.features[0]).properties.timeSeries[1]).time =
      '2026-10-09T10:00Z';
    expect(normalise(fixture).status).toBe('unavailable');
  });

  test('distinguishes an internal forecast gap from an exhausted horizon', () => {
    const fixture = globalSpotFixture();
    required(fixture.features[0]).properties.timeSeries.splice(1, 1);
    const result = normalise(fixture);
    expect(result.status).toBe('partial');
    expect(result.issues.map((issue) => issue.code)).toContain('missing-data');
    expect(result.issues.map((issue) => issue.code)).not.toContain(
      'outside-forecast-horizon',
    );
  });

  test('enforces distance, freshness, horizon and requested resolution', () => {
    const fixture = globalSpotFixture();
    required(fixture.features[0]).geometry.coordinates[0] = 1;
    expect(normalise(fixture).issues[0]?.code).toBe('outside-coverage');
    const stale = globalSpotFixture();
    required(stale.features[0]).properties.modelRunDate = '2026-10-08T00:00Z';
    expect(normalise(stale).issues[0]?.code).toBe('stale-data');
    expect(
      normalise(globalSpotFixture(), { ...request, maxTimeStepSeconds: 1800 })
        .issues[0]?.code,
    ).toBe('insufficient-resolution');
    const extended = evidence(
      normalise(globalSpotFixture(), {
        ...request,
        range: { ...request.range, end: '2026-10-09T16:00:00Z' },
      }),
    );
    expect(extended.status).toBe('partial');
    expect(extended.issues.map((issue) => issue.code)).toContain(
      'outside-forecast-horizon',
    );
    expect(
      normalise(globalSpotFixture(), {
        ...request,
        range: { start: '2026-10-15T00:00:00Z', end: '2026-10-16T00:00:00Z' },
      }).status,
    ).toBe('unavailable');
  });

  test('does not pretend that precipitation is rain or supply unsupported percentiles', () => {
    const result = evidence(
      normalise(globalSpotFixture(), {
        ...request,
        required: [
          weather.airTemperature,
          {
            kind: 'scalar',
            measure: { quantity: 'rainfall-amount', unit: 'mm' },
            statistic: { kind: 'percentile', percentile: 50 },
          },
        ],
      }),
    );
    expect(result.status).toBe('partial');
    expect(result.series).toHaveLength(1);
    expect(result.issues[0]?.code).toBe('unsupported-statistic');
  });
});

describe('Global Spot transport', () => {
  test('rejects unsupported polar locations without spending quota', async () => {
    let calls = 0;
    const provider = createMetOfficeGlobalSpot({
      apiKey: 'test-only-secret',
      now,
      fetch: async () => {
        calls++;
        return Response.json(globalSpotFixture());
      },
    });
    const results = await provider.getForecast(
      {
        ...request,
        locations: [
          { id: 'polar', coordinate: { latitude: 89, longitude: 0 } },
        ],
      },
      signal(),
    );
    expect(results[0]?.issues[0]?.code).toBe('outside-coverage');
    expect(calls).toBe(0);
  });
  test('sends the key only in a header and coalesces identical locations while preserving IDs', async () => {
    const calls: string[] = [];
    const provider = createMetOfficeGlobalSpot({
      apiKey: 'test-only-secret',
      now,
      fetch: async (url, init) => {
        calls.push(url);
        expect(new URL(url).origin).toBe(
          'https://data.hub.api.metoffice.gov.uk',
        );
        expect(url).not.toContain('test-only-secret');
        expect(new Headers(init.headers).get('apikey')).toBe(
          'test-only-secret',
        );
        expect(init.redirect).toBe('manual');
        return Response.json(globalSpotFixture());
      },
    });
    const results = await provider.getForecast(
      {
        ...request,
        locations: [location, { ...location, id: 'another-route' }],
      },
      signal(),
    );
    expect(calls).toHaveLength(1);
    expect(
      results.map((result) => evidence(result).location.requested.id),
    ).toEqual(['route-sample', 'another-route']);
    expect(results.every((result) => result.status === 'complete')).toBe(true);
  });

  test.each([
    302, 401, 403, 429, 500,
  ])('sanitises HTTP %s without retrying', async (status) => {
    let calls = 0;
    const provider = createMetOfficeGlobalSpot({
      apiKey: 'test-only-secret',
      now,
      concurrency: 1,
      fetch: async () => {
        calls++;
        return new Response('upstream echoed test-only-secret', {
          status,
          headers: { 'Retry-After': '42' },
        });
      },
    });
    const results = await provider.getForecast(request, signal());
    expect(calls).toBe(1);
    expect(results[0]?.status).toBe('unavailable');
    expect(results[0]?.issues[0]?.code).toBe(
      status === 429
        ? 'rate-limited'
        : status === 500 || status === 302
          ? 'upstream-unavailable'
          : 'unauthorized',
    );
    expect(JSON.stringify(results)).not.toContain('test-only-secret');
    if (status === 429)
      expect(results[0]?.issues[0]?.retryAfterSeconds).toBe(42);
  });

  test('stops queued requests after hitting a quota limit', async () => {
    let calls = 0;
    const provider = createMetOfficeGlobalSpot({
      apiKey: 'test-only-secret',
      now,
      concurrency: 1,
      fetch: async () => {
        calls++;
        return new Response(null, { status: 429 });
      },
    });
    const results = await provider.getForecast(
      {
        ...request,
        locations: [
          location,
          { id: 'other', coordinate: { latitude: 53, longitude: -1 } },
        ],
      },
      signal(),
    );
    expect(calls).toBe(1);
    expect(
      results.every((result) => result.issues[0]?.code === 'rate-limited'),
    ).toBe(true);
  });

  test('bounds concurrency and restores request order', async () => {
    let active = 0;
    let maximum = 0;
    const provider = createMetOfficeGlobalSpot({
      apiKey: 'test-only-secret',
      now,
      concurrency: 2,
      fetch: async () => {
        active++;
        maximum = Math.max(maximum, active);
        await Bun.sleep(2);
        active--;
        return Response.json(globalSpotFixture());
      },
    });
    const locations = Array.from({ length: 5 }, (_, i) => ({
      id: String(i),
      coordinate: { latitude: 52, longitude: -1 + i / 1000 },
    }));
    const results = await provider.getForecast(
      { ...request, locations },
      signal(),
    );
    expect(maximum).toBe(2);
    expect(
      results.map((result) => evidence(result).location.requested.id),
    ).toEqual(locations.map((item) => item.id));
  });

  test('handles a deadline, cancellation and malformed or oversized responses', async () => {
    const waiting = createMetOfficeGlobalSpot({
      apiKey: 'test-only-secret',
      now,
      timeoutMs: 5,
      fetch: async (_, init) =>
        new Promise((_, reject) => {
          init.signal?.addEventListener(
            'abort',
            () => reject(new Error('test-only-secret')),
            { once: true },
          );
        }),
    });
    expect(
      (await waiting.getForecast(request, signal()))[0]?.issues[0]?.code,
    ).toBe('timeout');
    const controller = new AbortController();
    controller.abort();
    expect(
      (await waiting.getForecast(request, controller.signal))[0]?.issues[0]
        ?.code,
    ).toBe('cancelled');
    for (const body of ['not-json', ' '.repeat(512_001)]) {
      const provider = createMetOfficeGlobalSpot({
        apiKey: 'test-only-secret',
        now,
        fetch: async () => new Response(body),
      });
      expect(
        (await provider.getForecast(request, signal()))[0]?.issues[0]?.code,
      ).toBe('invalid-response');
    }
  });

  test('rejects invalid requests and missing credentials without making network calls', async () => {
    let calls = 0;
    const provider = createMetOfficeGlobalSpot({
      apiKey: '',
      now,
      fetch: async () => {
        calls++;
        return Response.json(globalSpotFixture());
      },
    });
    expect(
      (await provider.getForecast(request, signal()))[0]?.issues[0]?.code,
    ).toBe('not-configured');
    expect(
      (
        await provider.getForecast({ ...request, maxAgeSeconds: -1 }, signal())
      )[0]?.issues[0]?.code,
    ).toBe('invalid-request');
    expect(
      (
        await provider.getForecast(
          { ...request, locations: [location, location] },
          signal(),
        )
      )[0]?.issues[0]?.code,
    ).toBe('invalid-request');
    expect(calls).toBe(0);
  });
});

describe('source policy', () => {
  const primary = createMetOfficeGlobalSpot({ apiKey: '', now });
  test('treats inherited object properties as unconfigured provider IDs', async () => {
    const selected = await getForecastForPolicy(
      {},
      { mode: 'strict', providerId: 'toString' },
      request,
      signal(),
    );
    expect(selected.results[0]?.issues[0]?.code).toBe('not-configured');
  });
  test('strict Met Office policy never calls another configured source', async () => {
    let calls = 0;
    const other: ForecastProvider = {
      ...primary,
      source: { ...primary.source, providerId: 'other' },
      getForecast: async () => {
        calls++;
        return [];
      },
    };
    const selected = await getForecastForPolicy(
      { 'met-office': primary, other },
      { mode: 'strict', providerId: 'met-office' },
      request,
      signal(),
    );
    expect(calls).toBe(0);
    expect(selected.source.providerId).toBe('met-office');
    expect(selected.results[0]?.issues[0]?.code).toBe('not-configured');
  });

  test('uses a second conforming provider only when explicitly allowed', async () => {
    const source = {
      providerId: 'other',
      productId: 'synthetic',
      adapterVersion: '1',
    };
    const other: ForecastProvider = {
      source,
      getCapabilities: primary.getCapabilities,
      getForecast: async () => {
        const result = evidence(normalise(globalSpotFixture()));
        return [{ ...result, provenance: { ...result.provenance, source } }];
      },
    };
    const selected = await getForecastForPolicy(
      { 'met-office': primary, other },
      { mode: 'ordered-fallback', providerIds: ['met-office', 'other'] },
      request,
      signal(),
    );
    expect(selected.source.providerId).toBe('other');
    expect(selected.attempts.map((attempt) => attempt.status)).toEqual([
      'unavailable',
      'complete',
    ]);
    expect(selected.results[0]?.status).toBe('complete');
  });

  test('rejects a provider result with another source in its provenance', async () => {
    const wrong = evidence(normalise(globalSpotFixture()));
    const provider: ForecastProvider = {
      ...primary,
      getForecast: async () => [
        {
          ...wrong,
          provenance: {
            ...wrong.provenance,
            source: { ...wrong.provenance.source, providerId: 'untrusted' },
          },
        },
      ],
    };
    const selected = await getForecastForPolicy(
      { 'met-office': provider },
      { mode: 'strict', providerId: 'met-office' },
      request,
      signal(),
    );
    expect(selected.results[0]?.status).toBe('unavailable');
  });

  test('retains partial evidence from the first permitted source if fallback fails', async () => {
    const partial = evidence(
      normalise(globalSpotFixture(), { ...request, maxTimeStepSeconds: 1800 }),
    );
    const provider: ForecastProvider = {
      ...primary,
      getForecast: async () => [partial],
    };
    const selected = await getForecastForPolicy(
      { 'met-office': provider },
      { mode: 'ordered-fallback', providerIds: ['met-office', 'other'] },
      request,
      signal(),
    );
    expect(selected.source.providerId).toBe('met-office');
    expect(selected.results[0]?.status).toBe('partial');
    expect(selected.attempts.map((attempt) => attempt.status)).toEqual([
      'partial',
      'unavailable',
    ]);
  });
});
