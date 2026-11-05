import { expect, test } from 'bun:test';
import { requiredWeather } from '../src/recommendations/engine.ts';
import { defaultSettings } from '../src/recommendations/input.ts';
import {
  cachedForecastSchema,
  withForecastCache,
} from '../src/weather/cache.ts';
import type { ForecastRequest } from '../src/weather/contracts.ts';
import {
  createCwa,
  cwaPrecipitationProbability,
  nearestCwaLocation,
  normaliseCwa,
} from '../src/weather/cwa.ts';
import catalogue from '../src/weather/cwa-locations.json';
import { weatherDescriptors as d } from '../src/weather/descriptors.ts';
import { CWA_NOW, cwaFixture, cwaLocation } from './fixtures/cwa.ts';

const signal = () => new AbortController().signal;
const request: ForecastRequest = {
  locations: [cwaLocation],
  range: { start: '2026-11-05T01:00:00Z', end: '2026-11-05T07:00:00Z' },
  required: [
    d.airTemperature,
    d.feelsLikeTemperature,
    d.windSpeed,
    d.windDirection,
    cwaPrecipitationProbability,
  ],
  maxTimeStepSeconds: 10_800,
  maxLocationDistanceM: 10_000,
  maxAgeSeconds: 3600,
  freshnessBasis: 'retrieval-time',
};
const site = nearestCwaLocation(cwaLocation)?.site;
if (!site) throw new Error('Missing CWA fixture location');
const normalise = (
  raw: unknown = cwaFixture(),
  changes: Partial<ForecastRequest> = {},
) => normaliseCwa(raw, site, cwaLocation, { ...request, ...changes }, CWA_NOW);
const rows = (
  raw: ReturnType<typeof cwaFixture>,
  index: number,
): {
  DataTime?: string;
  StartTime?: string;
  EndTime?: string;
  ElementValue: Record<string, string>[];
}[] => {
  const element = raw.records.Locations[0]?.Location[0]?.WeatherElement[index];
  if (!element) throw new Error('Missing fixture element');
  return element.Time;
};

test('CWA preserves Celsius, m/s, from-direction, UTC and the native precipitation event', () => {
  const result = normalise();
  if (result.status === 'unavailable') throw new Error('Expected forecast');
  expect(result.status).toBe('complete');
  expect(result.series.map((s) => s.samples[0]?.value)).toEqual([
    23, 25, 3, 45, 0.3,
  ]);
  expect(result.series[2]?.samples[0]?.time).toEqual({
    kind: 'instant',
    at: '2026-11-05T01:00:00.000Z',
  });
  expect(result.series[4]?.descriptor).toEqual(cwaPrecipitationProbability);
  expect(result.series[4]?.samples[0]).toEqual({
    validAt: '2026-11-05T01:00:00.000Z',
    value: 0.3,
    time: {
      kind: 'period',
      aggregation: 'event',
      range: {
        start: '2026-11-05T01:00:00.000Z',
        end: '2026-11-05T04:00:00.000Z',
      },
    },
  });
  expect(result.location).toMatchObject({
    sourceLocationId: '63000010',
    distanceFromRequestedM: 0,
    method: 'nearest-site',
  });
  expect(result.issuedAt).toBeNull();
  expect(result.provenance.dataVersion).toBeNull();
  expect(result.provenance.forecastRunAt).toBeUndefined();
  expect(result.provenance.attribution[0]?.notice).toContain(
    'Open Government Data License',
  );
  expect(result.issues.map((i) => i.code)).toEqual(['unknown-model-run']);
  expect(cachedForecastSchema.safeParse(result).success).toBe(true);
});

test('overlapping rain events retain all three hours and their full probability', () => {
  const result = normalise(undefined, {
    required: [cwaPrecipitationProbability],
    range: { start: '2026-11-05T02:00:00Z', end: '2026-11-05T03:00:00Z' },
  });
  if (result.status === 'unavailable') throw new Error('Expected forecast');
  expect(result.status).toBe('complete');
  expect(result.series[0]?.samples).toHaveLength(1);
  expect(result.series[0]?.samples[0]?.value).toBe(0.3);
  expect(result.series[0]?.samples[0]?.time).toMatchObject({
    range: {
      start: '2026-11-05T01:00:00.000Z',
      end: '2026-11-05T04:00:00.000Z',
    },
  });
});

test.each([
  '',
  '-',
  '-99',
  '-999',
  '>= 11',
  'NaN',
  'Infinity',
  '3 m/s',
])('CWA missing/bounded wind %s never becomes an exact wind speed', (value) => {
  const raw = cwaFixture();
  const row = rows(raw, 2)[0];
  if (!row) throw new Error('Missing fixture row');
  row.ElementValue = [{ WindSpeed: value }];
  const result = normalise(raw);
  if (result.status === 'unavailable')
    throw new Error('Expected partial forecast');
  expect(result.status).toBe('partial');
  expect(result.series[2]?.samples[0]?.value).toBeNull();
  expect(result.issues.some((i) => i.code === 'missing-data')).toBe(true);
});

test('unsupported direction and invalid probability stay unknown', () => {
  const raw = cwaFixture();
  const wind = rows(raw, 3)[0],
    rain = rows(raw, 4)[0];
  if (!wind || !rain) throw new Error('Missing fixture rows');
  wind.ElementValue = [{ WindDirection: '不定' }];
  rain.ElementValue = [{ ProbabilityOfPrecipitation: '101' }];
  const result = normalise(raw);
  if (result.status === 'unavailable')
    throw new Error('Expected partial forecast');
  expect(result.series[3]?.samples[0]?.value).toBeNull();
  expect(result.series[4]?.samples[0]?.value).toBeNull();
});

test('CWA rejects invented hourly resolution, missing periods and duplicate times', () => {
  const hourly = normalise(undefined, { maxTimeStepSeconds: 3600 });
  expect(hourly.issues.some((i) => i.code === 'insufficient-resolution')).toBe(
    true,
  );
  const raw = cwaFixture();
  rows(raw, 0).splice(1, 1);
  expect(
    normalise(raw).issues.some((i) => i.code === 'insufficient-resolution'),
  ).toBe(true);
  const duplicate = cwaFixture();
  const first = rows(duplicate, 0)[0];
  if (!first) throw new Error('Missing row');
  rows(duplicate, 0).push(first);
  expect(
    normalise(duplicate).issues.some((i) => i.code === 'invalid-response'),
  ).toBe(true);
  const invalid = cwaFixture();
  Object.assign(rows(invalid, 4)[0] ?? {}, {
    EndTime: '2026-11-05T10:00:00+08:00',
  });
  expect(
    normalise(invalid).issues.some((i) => i.code === 'invalid-response'),
  ).toBe(true);
});

test('CWA rejects mismatched datasets, townships, coordinates and timestamp ambiguity', () => {
  for (const raw of [
    null,
    {},
    { ...cwaFixture(), success: 'false' },
    { ...cwaFixture(), result: { resource_id: 'F-D0047-089' } },
  ])
    expect(normalise(raw)).toMatchObject({
      status: 'unavailable',
      issues: [{ code: 'invalid-response' }],
    });
  const raw = cwaFixture();
  const township = raw.records.Locations[0]?.Location[0];
  if (!township) throw new Error('Missing township');
  township.Geocode = '63000020';
  expect(normalise(raw).status).toBe('unavailable');
  township.Geocode = '63000010';
  township.Latitude = '24';
  expect(normalise(raw)).toMatchObject({
    status: 'unavailable',
    issues: [{ code: 'outside-coverage' }],
  });
  const noOffset = cwaFixture();
  Object.assign(rows(noOffset, 0)[0] ?? {}, {
    DataTime: '2026-11-05T09:00:00',
  });
  expect(
    normalise(noOffset).issues.some((i) => i.code === 'invalid-response'),
  ).toBe(true);
});

test('CWA does not promise evidence beyond the returned horizon', () => {
  expect(
    normalise(undefined, {
      range: { start: '2026-11-05T01:00:00Z', end: '2026-11-09T01:00:00Z' },
    }).issues.some((i) => i.code === 'outside-forecast-horizon'),
  ).toBe(true);
});

test('the catalogue has all 368 unique representative points including outlying islands', () => {
  expect(catalogue).toHaveLength(368);
  expect(new Set(catalogue.map((s) => s.geocode)).size).toBe(368);
  for (const geocode of ['63000010', '09020010', '09007010'])
    expect(catalogue.some((s) => s.geocode === geocode)).toBe(true);
  expect(defaultSettings.weather).toEqual({
    mode: 'strict',
    providerId: 'apple-weather',
  });
});

test('CWA batches township names, deduplicates route samples and keeps keys out of URLs', async () => {
  const calls: string[] = [];
  const provider = createCwa({
    apiKey: 'synthetic-secret',
    now: () => new Date(CWA_NOW),
    fetch: async (url, init) => {
      calls.push(url);
      expect(new Headers(init.headers).get('Authorization')).toBe(
        'synthetic-secret',
      );
      expect(init.redirect).toBe('manual');
      expect(url).not.toContain('synthetic-secret');
      expect(new URL(url).searchParams.get('LocationName')).toBe('松山區');
      expect(new URL(url).searchParams.get('ElementName')).toBe(
        '溫度,體感溫度,風速,風向,3小時降雨機率',
      );
      return Response.json(cwaFixture());
    },
  });
  const locations = [
    cwaLocation,
    { ...cwaLocation, id: 'duplicate' },
    { id: 'london', coordinate: { latitude: 51.5, longitude: -0.1 } },
  ];
  const results = await provider.getForecast(
    { ...request, locations },
    signal(),
  );
  expect(calls).toHaveLength(1);
  expect(results.map((r) => r.status)).toEqual([
    'complete',
    'complete',
    'unavailable',
  ]);
  expect(results[1]).toMatchObject({
    location: { requested: { id: 'duplicate' } },
  });
  expect(results[2]?.issues[0]?.code).toBe('outside-coverage');
});

test('unsupported scoring and model freshness fail without spending CWA quota', async () => {
  let calls = 0;
  const provider = createCwa({
    apiKey: 'synthetic',
    fetch: async () => {
      calls++;
      return Response.json({});
    },
  });
  const unsupported = await provider.getForecast(
    { ...request, required: requiredWeather },
    signal(),
  );
  expect(unsupported[0]?.issues[0]?.code).toBe('unsupported-variable');
  const model = await provider.getForecast(
    { ...request, freshnessBasis: 'model-run' },
    signal(),
  );
  expect(model[0]?.issues[0]?.code).toBe('unknown-model-run');
  expect(calls).toBe(0);
  const capabilities = await provider.getCapabilities(signal());
  expect(capabilities.available).toHaveLength(5);
  expect(capabilities.available.every((a) => a.timeStepSeconds === 10800)).toBe(
    true,
  );
});

test.each([
  401, 403, 429, 500, 302,
])('CWA sanitises HTTP %s and honours quota backoff', async (status) => {
  const provider = createCwa({
    apiKey: 'synthetic-secret',
    fetch: async () =>
      new Response('sensitive upstream body', {
        status,
        headers: { 'Retry-After': '120' },
      }),
  });
  const result = await provider.getForecast(request, signal());
  expect(result[0]?.issues[0]?.code).toBe(
    status === 401 || status === 403
      ? 'unauthorized'
      : status === 429
        ? 'rate-limited'
        : 'upstream-unavailable',
  );
  if (status === 429) expect(result[0]?.issues[0]?.retryAfterSeconds).toBe(120);
  expect(JSON.stringify(result)).not.toContain('sensitive');
  expect(JSON.stringify(result)).not.toContain('synthetic-secret');
});

test('CWA handles missing configuration, cancellation, timeout and oversized bodies', async () => {
  expect(
    (await createCwa({ apiKey: '' }).getForecast(request, signal()))[0]
      ?.issues[0]?.code,
  ).toBe('not-configured');
  expect(
    (
      await createCwa({ apiKey: 'test' }).getForecast(
        request,
        AbortSignal.abort(),
      )
    )[0]?.issues[0]?.code,
  ).toBe('cancelled');
  const slow = createCwa({
    apiKey: 'test',
    timeoutMs: 5,
    fetch: async (_url, init) =>
      new Promise((_resolve, reject) =>
        init.signal?.addEventListener(
          'abort',
          () => reject(new Error('sensitive')),
          { once: true },
        ),
      ),
  });
  expect((await slow.getForecast(request, signal()))[0]?.issues[0]?.code).toBe(
    'timeout',
  );
  const big = createCwa({
    apiKey: 'test',
    fetch: async () => new Response('x'.repeat(2_000_001)),
  });
  expect((await big.getForecast(request, signal()))[0]?.issues[0]?.code).toBe(
    'invalid-response',
  );
});

test('CWA snapshots use the existing cache without manufacturing a model timestamp', async () => {
  const values = new Map<string, string>();
  let calls = 0;
  const provider = withForecastCache(
    createCwa({
      apiKey: 'test',
      now: () => new Date(CWA_NOW),
      fetch: async () => {
        calls++;
        return Response.json(cwaFixture());
      },
    }),
    {
      get: async (key) => values.get(key) ?? null,
      put: async (key, value) => {
        values.set(key, value);
      },
    },
    { now: () => new Date(CWA_NOW) },
  );
  await provider.getForecast(request, signal());
  const result = await provider.getForecast(request, signal());
  expect(calls).toBe(1);
  expect(result[0]).toMatchObject({
    provenance: { retrievedAt: CWA_NOW, dataVersion: null },
  });
});
