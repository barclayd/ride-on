import { expect, test } from 'bun:test';
import { exportPKCS8, generateKeyPair, jwtVerify } from 'jose';
import { sampleAt } from '../src/recommendations/engine.ts';
import {
  appleSkyCondition,
  createAppleWeather,
  normaliseAppleWeather,
} from '../src/weather/apple-weather.ts';
import { withForecastCache } from '../src/weather/cache.ts';
import { skyConditions } from '../src/weather/conditions.ts';
import type {
  ForecastRequest,
  ProviderIssue,
} from '../src/weather/contracts.ts';
import {
  weatherDescriptors as d,
  descriptorKey,
} from '../src/weather/descriptors.ts';
import { APPLE_NOW, appleWeatherFixture } from './fixtures/apple-weather.ts';
import { present } from './fixtures/rides.ts';

const location = {
  id: 'sample',
  coordinate: { latitude: 51.2, longitude: -1 },
};
const request: ForecastRequest = {
  locations: [location],
  range: { start: '2026-10-10T08:00:00Z', end: '2026-10-10T12:00:00Z' },
  required: Object.values(d),
  maxTimeStepSeconds: 3600,
  maxLocationDistanceM: 10000,
  maxAgeSeconds: 21600,
  freshnessBasis: 'retrieval-time',
};
const normalized = (
  raw: unknown = appleWeatherFixture(),
  changes: Partial<ForecastRequest> = {},
) =>
  normaliseAppleWeather(raw, location, { ...request, ...changes }, APPLE_NOW);
const keys = await generateKeyPair('ES256', { extractable: true });
const config = JSON.stringify({
  teamId: 'TESTTEAM01',
  keyId: 'TESTKEY001',
  serviceId: 'cc.ride-on.synthetic-weather',
  privateKey: await exportPKCS8(keys.privateKey),
});
const signal = () => new AbortController().signal;

test('Apple hourly fields preserve units, from-wind direction, forward periods, model uncertainty and attribution', () => {
  const raw = appleWeatherFixture();
  for (const row of raw.forecastHourly.hours) {
    row.precipitationAmount = 0.4;
    row.windDirection = 360;
  }
  const result = normalized(raw);
  if (result.status === 'unavailable') throw new Error('Expected evidence');
  const series = (key: keyof typeof d) =>
    present(
      result.series.find(
        (s) => descriptorKey(s.descriptor) === descriptorKey(d[key]),
      ),
    );
  expect(series('windSpeed').samples[0]?.value).toBe(2);
  expect(series('windGust').samples[0]?.value).toBe(4);
  expect(series('windDirection').samples[0]?.value).toBe(0);
  expect(series('precipitationProbability').samples[0]?.value).toBe(0.08);
  expect(series('precipitationRate').samples[0]).toEqual({
    validAt: '2026-10-10T08:00:00.000Z',
    value: 0.4,
    time: {
      kind: 'period',
      aggregation: 'mean',
      range: {
        start: '2026-10-10T08:00:00.000Z',
        end: '2026-10-10T09:00:00.000Z',
      },
    },
  });
  expect(series('precipitationAmount').samples[0]?.time).toMatchObject({
    aggregation: 'accumulation',
  });
  expect(series('precipitationProbability').samples[0]?.time).toMatchObject({
    aggregation: 'event',
  });
  expect(series('windGust').samples[0]?.time).toMatchObject({
    aggregation: 'maximum',
  });
  expect(result.provenance.forecastRunAt).toBeUndefined();
  expect(result.provenance.dataVersion).toBeNull();
  expect(result.issuedAt).toBe(raw.forecastHourly.metadata.reportedTime);
  expect(result.provenance.expiresAt).toBe(
    raw.forecastHourly.metadata.expireTime,
  );
  expect(result.provenance.attribution[0]?.logo?.lightUrl).toContain(
    'Apple_Weather',
  );
  expect(result.issues.map((i) => i.code)).toEqual(['unknown-model-run']);
});

test('full-hour averages apply to the native hour, without changing short Met Office wind means', () => {
  const raw = appleWeatherFixture();
  const eight = present(raw.forecastHourly.hours[8]);
  eight.precipitationAmount = 3;
  eight.cloudCover = 0.9;
  const result = normalized(raw);
  if (result.status === 'unavailable') throw new Error('Expected evidence');
  for (const [descriptor, expected] of [
    [d.precipitationRate, 3],
    [d.totalCloudCover, 0.9],
  ] as const) {
    const s = present(
      result.series.find(
        (s) => descriptorKey(s.descriptor) === descriptorKey(descriptor),
      ),
    );
    expect(sampleAt(s.samples, Date.parse('2026-10-10T08:59:59Z'))).toBe(
      expected,
    );
    expect(sampleAt(s.samples, Date.parse('2026-10-10T09:00:00Z'))).toBe(
      descriptor === d.totalCloudCover ? 0.1 : 0,
    );
  }
  expect(
    sampleAt(
      [
        {
          validAt: '2026-10-10T09:00:00Z',
          value: 2,
          time: {
            kind: 'period',
            aggregation: 'mean',
            range: {
              start: '2026-10-10T08:50:00Z',
              end: '2026-10-10T09:00:00Z',
            },
          },
        },
      ],
      Date.parse('2026-10-10T09:20:00Z'),
    ),
  ).toBe(2);
});

test('sky symbols retain daylight and visible sunshine; unspecified sky and future codes stay unknown', () => {
  expect(appleSkyCondition('Clear', true)).toBe(skyConditions.sunny);
  expect(appleSkyCondition('Clear', false)).toBe(skyConditions.clearNight);
  expect(appleSkyCondition('MostlyClear', true)).toBe(
    skyConditions.sunnyIntervals,
  );
  expect(appleSkyCondition('PartlyCloudy', false)).toBe(
    skyConditions.partlyCloudyNight,
  );
  expect(appleSkyCondition('Cloudy', true)).toBe(skyConditions.overcast);
  expect(appleSkyCondition('SunShowers', true)).toBe(
    skyConditions.sunnyIntervals,
  );
  expect(appleSkyCondition('Rain', true)).toBe(skyConditions.precipitation);
  for (const code of ['Breezy', 'Windy', 'Hot', 'Frigid', 'NewCondition'])
    expect(appleSkyCondition(code, true)).toBeNull();
  expect(appleSkyCondition('Clear', undefined)).toBeNull();
});

test('missing gusts, direction, amount and invalid values remain gaps; unknown fields are tolerated', () => {
  const raw = appleWeatherFixture();
  const row: Record<string, unknown> = present(raw.forecastHourly.hours[8]);
  delete row.windGust;
  delete row.windDirection;
  delete row.precipitationAmount;
  row.precipitationChance = 80;
  row.cloudCover = -1;
  row.unrelatedFutureField = 'allowed';
  const result = normalized(raw);
  if (result.status === 'unavailable')
    throw new Error('Expected partial evidence');
  for (const descriptor of [
    d.windGust,
    d.windDirection,
    d.precipitationRate,
    d.precipitationProbability,
    d.totalCloudCover,
  ])
    expect(
      result.series.find(
        (s) => descriptorKey(s.descriptor) === descriptorKey(descriptor),
      )?.samples[0]?.value,
    ).toBeNull();
  expect(result.issues.map((i) => i.code)).toContain('missing-data');
  expect(
    result.series.find((s) => s.descriptor === d.airTemperature)?.samples[0]
      ?.value,
  ).toBe(18);
});

test('invalid units, format, duplicate hours, distant locations, stale data and future timestamps are rejected', () => {
  const cases: [
    (raw: ReturnType<typeof appleWeatherFixture>) => void,
    ProviderIssue['code'],
  ][] = [
    [
      (r) => {
        r.forecastHourly.metadata.units = 'imperial';
      },
      'invalid-response',
    ],
    [
      (r) => {
        r.forecastHourly.metadata.version = 99;
      },
      'invalid-response',
    ],
    [
      (r) => {
        r.forecastHourly.hours.push(present(r.forecastHourly.hours[0]));
      },
      'invalid-response',
    ],
    [
      (r) => {
        r.forecastHourly.metadata.longitude = 50;
      },
      'outside-coverage',
    ],
    [
      (r) => {
        r.forecastHourly.metadata.readTime = '2026-10-09T10:00:00Z';
        r.forecastHourly.metadata.expireTime = APPLE_NOW;
      },
      'stale-data',
    ],
    [
      (r) => {
        r.forecastHourly.metadata.readTime = '2026-10-09T12:10:00Z';
      },
      'invalid-response',
    ],
    [
      (r) => {
        r.forecastHourly.metadata.temporarilyUnavailable = true;
      },
      'upstream-unavailable',
    ],
  ];
  for (const [change, code] of cases) {
    const raw = appleWeatherFixture();
    change(raw);
    const result = normalized(raw);
    expect(result.status).toBe('unavailable');
    expect(result.issues[0]?.code).toBe(code);
  }
});

test('partial first-hour intervals, interior gaps and shorter horizons retain honest coverage', () => {
  const raw = appleWeatherFixture();
  const partial = normalized(raw, {
    range: { start: '2026-10-10T08:30:00Z', end: '2026-10-10T10:00:00Z' },
  });
  if (partial.status === 'unavailable') throw new Error('Expected evidence');
  expect(
    partial.series.find((s) => s.descriptor === d.precipitationProbability)
      ?.samples[0]?.validAt,
  ).toBe('2026-10-10T08:00:00.000Z');
  raw.forecastHourly.hours.splice(9, 1);
  expect(normalized(raw).issues.map((i) => i.code)).toContain('missing-data');
  const horizon = appleWeatherFixture({ hours: 10 });
  expect(normalized(horizon).issues.map((i) => i.code)).toContain(
    'outside-forecast-horizon',
  );
});

test('transport signs a verifiable ES256 token, coalesces coordinates, sends only hourly data and keeps input order', async () => {
  let calls = 0;
  const provider = createAppleWeather({
    config,
    now: () => new Date(APPLE_NOW),
    fetch: async (url, init) => {
      calls++;
      const authorization = new Headers(init.headers).get('Authorization');
      const verified = await jwtVerify(
        present(authorization?.slice(7)),
        keys.publicKey,
        {
          issuer: 'TESTTEAM01',
          subject: 'cc.ride-on.synthetic-weather',
          algorithms: ['ES256'],
          currentDate: new Date(APPLE_NOW),
        },
      );
      expect(verified.protectedHeader).toEqual({
        alg: 'ES256',
        kid: 'TESTKEY001',
        id: 'TESTTEAM01.cc.ride-on.synthetic-weather',
      });
      expect(Object.keys(verified.payload).sort()).toEqual([
        'exp',
        'iat',
        'iss',
        'sub',
      ]);
      expect(Number(verified.payload.exp) - Number(verified.payload.iat)).toBe(
        900,
      );
      expect(init.redirect).toBe('manual');
      const u = new URL(url);
      expect(u.searchParams.get('dataSets')).toBe('forecastHourly');
      expect(u.searchParams.get('hourlyStart')).toBe(
        '2026-10-10T08:00:00.000Z',
      );
      expect(u.searchParams.get('timezone')).toBe('UTC');
      expect(url).not.toContain('TESTKEY001');
      return Response.json(appleWeatherFixture());
    },
  });
  const results = await provider.getForecast(
    { ...request, locations: [location, { ...location, id: 'duplicate' }] },
    signal(),
  );
  expect(calls).toBe(1);
  expect(
    results.map((r) =>
      r.status === 'unavailable' ? r.requested.id : r.location.requested.id,
    ),
  ).toEqual(['sample', 'duplicate']);
});

test('unsupported statistics, freshness, resolution and missing credentials fail before quota is spent', async () => {
  let calls = 0;
  const fetch = async () => {
    calls++;
    return Response.json(appleWeatherFixture());
  };
  for (const [changes, code] of [
    [{ freshnessBasis: 'model-run' }, 'unknown-model-run'],
    [
      {
        required: [
          {
            ...d.airTemperature,
            statistic: { kind: 'percentile', percentile: 50 },
          },
        ],
      },
      'unsupported-statistic',
    ],
    [{ maxTimeStepSeconds: 1800 }, 'insufficient-resolution'],
  ] as const) {
    const results = await createAppleWeather({ config, fetch }).getForecast(
      { ...request, ...changes },
      signal(),
    );
    expect(results[0]?.issues[0]?.code).toBe(code);
  }
  for (const config of [undefined, '{}', 'bad json'])
    expect(
      (
        await createAppleWeather({ config, fetch }).getForecast(
          request,
          signal(),
        )
      )[0]?.issues[0]?.code,
    ).toBe('not-configured');
  expect(calls).toBe(0);
});

test('quota and authorization stop queued requests, preserve retry advice and never leak the response body', async () => {
  for (const status of [401, 429, 503, 302]) {
    let calls = 0;
    const provider = createAppleWeather({
      config,
      concurrency: 1,
      fetch: async () => {
        calls++;
        return new Response('upstream-private-details', {
          status,
          headers: {
            'Retry-After': '60',
            Location: 'https://example.invalid/leak',
          },
        });
      },
    });
    const result = await provider.getForecast(
      {
        ...request,
        locations: [
          location,
          { id: 'second', coordinate: { latitude: 52, longitude: -1 } },
        ],
      },
      signal(),
    );
    expect(calls).toBe(status === 401 || status === 429 ? 1 : 2);
    expect(JSON.stringify(result)).not.toContain('upstream-private-details');
    if (status === 429)
      expect(result[0]?.issues[0]?.retryAfterSeconds).toBe(60);
    expect(result.every((r) => r.status === 'unavailable')).toBe(true);
  }
});

test('body bounds, timeout and cancellation are sanitized failures', async () => {
  for (const body of ['invalid json', ' '.repeat(512001)]) {
    const provider = createAppleWeather({
      config,
      fetch: async () => new Response(body),
    });
    expect(
      (await provider.getForecast(request, signal()))[0]?.issues[0]?.code,
    ).toBe('invalid-response');
  }
  const provider = createAppleWeather({
    config,
    timeoutMs: 5,
    fetch: async (_url, init) =>
      new Promise((_resolve, reject) =>
        init.signal?.addEventListener(
          'abort',
          () => reject(new Error('cancelled')),
          { once: true },
        ),
      ),
  });
  expect(
    (await provider.getForecast(request, signal()))[0]?.issues[0]?.code,
  ).toBe('timeout');
  const controller = new AbortController();
  controller.abort();
  expect(
    (await provider.getForecast(request, controller.signal))[0]?.issues[0]
      ?.code,
  ).toBe('cancelled');
});

test('provider expiry invalidates cached evidence before the shared TTL, while retaining branding', async () => {
  let clock = Date.parse(APPLE_NOW);
  let calls = 0;
  const values = new Map<string, string>();
  const provider = withForecastCache(
    createAppleWeather({
      config,
      now: () => new Date(clock),
      fetch: async () => {
        calls++;
        const raw = appleWeatherFixture({ now: new Date(clock).toISOString() });
        raw.forecastHourly.metadata.expireTime = new Date(
          clock + 600000,
        ).toISOString();
        return Response.json(raw);
      },
    }),
    {
      get: async (k) => values.get(k) ?? null,
      put: async (k, v) => {
        values.set(k, v);
      },
    },
    { now: () => new Date(clock) },
  );
  const cold = await provider.getForecast(request, signal());
  expect(await provider.getForecast(request, signal())).toEqual(cold);
  expect(calls).toBe(1);
  clock += 600000;
  await provider.getForecast(request, signal());
  expect(calls).toBe(2);
});
