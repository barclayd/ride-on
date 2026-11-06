import { expect, test } from 'bun:test';
import { exportPKCS8, generateKeyPair } from 'jose';
import { recommendRides } from '../src/recommendations/engine.ts';
import { createAppleWeather } from '../src/weather/apple-weather.ts';
import {
  cachedForecastSchema,
  withForecastCache,
} from '../src/weather/cache.ts';
import type {
  ForecastDescriptor,
  ForecastRequest,
  LocationForecastResult,
} from '../src/weather/contracts.ts';
import { createCwa, cwaPrecipitationProbability } from '../src/weather/cwa.ts';
import {
  weatherDescriptors as d,
  descriptorKey,
} from '../src/weather/descriptors.ts';
import {
  createTaiwanWeather,
  taiwanPrecipitationProbability,
} from '../src/weather/taiwan.ts';
import { isTaiwanCoordinate } from '../src/weather/taiwan-region.ts';
import { appleWeatherFixture } from './fixtures/apple-weather.ts';
import { CWA_NOW, cwaFixture, cwaLocation } from './fixtures/cwa.ts';
import {
  forecastsFor,
  inputFor,
  makeRoute,
  present,
  now as scoringNow,
} from './fixtures/rides.ts';

const keys = await generateKeyPair('ES256', { extractable: true });
const config = JSON.stringify({
  teamId: 'TESTTEAM01',
  keyId: 'TESTKEY001',
  serviceId: 'cc.ride-on.synthetic-taiwan',
  privateKey: await exportPKCS8(keys.privateKey),
});
const now = () => new Date(CWA_NOW);
const request: ForecastRequest = {
  locations: [cwaLocation],
  range: { start: '2026-11-05T01:00:00Z', end: '2026-11-05T07:00:00Z' },
  required: [
    d.airTemperature,
    d.windSpeed,
    d.windDirection,
    d.windGust,
    d.precipitationRate,
    taiwanPrecipitationProbability,
  ],
  maxTimeStepSeconds: 10800,
  maxLocationDistanceM: 10000,
  maxAgeSeconds: 3600,
  freshnessBasis: 'retrieval-time',
};
const setup = () => {
  const cwa = cwaFixture();
  const apple = appleWeatherFixture({
    ...cwaLocation.coordinate,
    now: CWA_NOW,
    start: CWA_NOW,
    hours: 120,
  });
  for (const row of apple.forecastHourly.hours) row.precipitationAmount = 0.4;
  let calls = 0;
  const provider = createTaiwanWeather({
    now,
    cwa: createCwa({
      apiKey: 'synthetic-secret',
      now,
      fetch: async () => {
        calls++;
        return Response.json(cwa);
      },
    }),
    apple: createAppleWeather({
      config,
      now,
      fetch: async () => {
        calls++;
        return Response.json(apple);
      },
    }),
  });
  return {
    provider,
    cwa,
    apple,
    calls: () => calls,
    get: async (changes: Partial<ForecastRequest> = {}) =>
      present(
        (
          await provider.getForecast(
            { ...request, ...changes },
            new AbortController().signal,
          )
        )[0],
      ),
  };
};
const available = (result: LocationForecastResult) => {
  if (result.status === 'unavailable')
    throw new Error(JSON.stringify(result.issues));
  return result;
};
const series = (r: LocationForecastResult, descriptor: ForecastDescriptor) =>
  present(
    available(r).series.find(
      (s) => descriptorKey(s.descriptor) === descriptorKey(descriptor),
    ),
  );

test('Taiwan combines real adapter contracts with native CWA probabilities and Apple hourly rain and gusts', async () => {
  const h = setup();
  const result = available(await h.get());
  expect(result.status).toBe('complete');
  expect(series(result, d.airTemperature).samples.map((s) => s.value)).toEqual([
    23, 23, 23, 23, 23, 23,
  ]);
  expect(series(result, d.windSpeed).samples.every((s) => s.value === 3)).toBe(
    true,
  );
  expect(
    series(result, d.windDirection).samples.every((s) => s.value === 45),
  ).toBe(true);
  expect(series(result, d.windGust).samples.every((s) => s.value === 4)).toBe(
    true,
  );
  expect(
    series(result, d.precipitationRate).samples.every((s) => s.value === 0.4),
  ).toBe(true);
  const rain = series(result, taiwanPrecipitationProbability);
  expect(rain.samples).toHaveLength(2);
  expect(rain.samples[0]).toMatchObject({
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
  expect(rain.evidence?.[0]).toMatchObject({
    descriptor: cwaPrecipitationProbability,
    nativeTimeStepSeconds: 10800,
    method: 'native',
    provenance: { source: { providerId: 'cwa' } },
  });
  expect(
    series(result, d.windSpeed).evidence?.some(
      (e) =>
        e.method === 'linear-interpolation' &&
        e.nativeTimeStepSeconds === 10800,
    ),
  ).toBe(true);
  expect(
    series(result, d.windGust).evidence?.[0]?.provenance.source.providerId,
  ).toBe('apple-weather');
  expect(new Set(result.provenance.attribution.map((a) => a.text)).size).toBe(
    2,
  );
  expect(cachedForecastSchema.safeParse(result).success).toBe(true);
});

test('wind follows the short arc through north and ambiguous opposite directions fall back as a pair', async () => {
  for (const [last, expected] of [
    ['東北風', 345],
    ['東南風', 180],
  ] as const) {
    const h = setup();
    const rows = present(
      h.cwa.records.Locations[0]?.Location[0]?.WeatherElement[3],
    ).Time;
    present(rows[0]).ElementValue = [{ WindDirection: '西北風' }];
    present(rows[1]).ElementValue = [{ WindDirection: last }];
    const result = await h.get();
    expect(series(result, d.windDirection).samples[1]?.value).toBeCloseTo(
      expected,
      8,
    );
    expect(series(result, d.windSpeed).samples[1]?.value).toBe(
      last === '東北風' ? 3 : 2,
    );
  }
});

test('missing CWA values use Apple, without zero substitution or extrapolation beyond CWA coverage', async () => {
  const h = setup();
  present(
    present(h.cwa.records.Locations[0]?.Location[0]?.WeatherElement[0]).Time[1],
  ).ElementValue = [{ Temperature: '-99' }];
  const result = await h.get();
  expect(series(result, d.airTemperature).samples.map((s) => s.value)).toEqual([
    23, 18, 18, 18, 18, 18,
  ]);
  const later = await h.get({
    range: { start: '2026-11-08T01:00:00Z', end: '2026-11-08T07:00:00Z' },
  });
  expect(
    series(later, d.airTemperature).samples.every((s) => s.value === 18),
  ).toBe(true);
  expect(
    series(later, taiwanPrecipitationProbability).samples.every(
      (s) => s.value === 0.08,
    ),
  ).toBe(true);
  expect(
    series(later, taiwanPrecipitationProbability).evidence?.[0]?.descriptor,
  ).toEqual(d.precipitationProbability);
});

test('missing Apple gusts remain missing even when CWA supplies sustained wind', async () => {
  const h = setup();
  const row = present(h.apple.forecastHourly.hours[3]);
  Reflect.deleteProperty(row, 'windGust');
  const result = available(await h.get());
  expect(series(result, d.windGust).samples[2]?.value).toBeNull();
  expect(result.issues.some((i) => i.code === 'missing-data')).toBe(true);
  expect(cachedForecastSchema.safeParse(result).success).toBe(false);
});

test('cache reuses native rain events inside the last period and retains evidence for new route IDs', async () => {
  const h = setup();
  const rows = new Map<string, string>();
  const cached = withForecastCache(
    h.provider,
    {
      get: async (key) => rows.get(key) ?? null,
      put: async (key, value) => {
        rows.set(key, value);
      },
    },
    { now, forecastHorizonHours: 120 },
  );
  const fetch = (id: string) =>
    cached.getForecast(
      { ...request, locations: [{ ...cwaLocation, id }] },
      new AbortController().signal,
    );
  const first = available(present((await fetch('first'))[0]));
  expect(first.issues.some((i) => i.code === 'outside-forecast-horizon')).toBe(
    false,
  );
  const calls = h.calls();
  const second = available(present((await fetch('second'))[0]));
  expect(h.calls()).toBe(calls);
  expect(rows.size).toBe(1);
  expect(
    second.series
      .flatMap((s) => s.evidence ?? [])
      .every((e) => e.location.requested.id === 'second'),
  ).toBe(true);
  expect(series(second, taiwanPrecipitationProbability).samples).toEqual(
    series(first, taiwanPrecipitationProbability).samples,
  );
});

test('only missing sky categories remain cacheable alongside continuous three-hour rain events', async () => {
  const h = setup();
  present(h.apple.forecastHourly.hours[3]).conditionCode = 'NewUnknownSymbol';
  const result = available(
    await h.get({ required: [...request.required, d.skyCondition] }),
  );
  expect(result.issues.some((i) => i.code === 'missing-data')).toBe(true);
  expect(cachedForecastSchema.safeParse(result).success).toBe(true);
});

test('invalid resolution, foreign locations and model-run freshness fail before spending quota', async () => {
  for (const changes of [
    { maxTimeStepSeconds: 3600 },
    { freshnessBasis: 'model-run' as const },
    {
      locations: [
        {
          id: 'xiamen',
          coordinate: { latitude: 24.4798, longitude: 118.0894 },
        },
      ],
    },
  ]) {
    const h = setup();
    expect((await h.get(changes)).status).toBe('unavailable');
    expect(h.calls()).toBe(0);
  }
});

test.each([
  ['Taipei', 25.05, 121.56, true],
  ['Hualien', 23.987, 121.601, true],
  ['Kaohsiung', 22.627, 120.301, true],
  ['Kinmen', 24.433, 118.317, true],
  ['Matsu', 26.159, 119.944, true],
  ['Penghu', 23.565, 119.566, true],
  ['Green Island', 22.665, 121.49, true],
  ['Orchid Island', 22.044, 121.548, true],
  ['Xiamen', 24.4798, 118.0894, false],
  ['Fuzhou', 26.0745, 119.2965, false],
  ['London', 51.507, -0.128, false],
  ['open sea', 24.0, 119.0, false],
])('%s is classified by land boundaries, not proximity to a CWA station', (_name, latitude, longitude, expected) => {
  expect(isTaiwanCoordinate({ latitude, longitude })).toBe(expected);
});

test('expired Apple evidence cannot be disguised by a fresh CWA retrieval', async () => {
  const h = setup();
  h.apple.forecastHourly.metadata.readTime = '2026-11-04T22:00:00Z';
  h.apple.forecastHourly.metadata.reportedTime = '2026-11-04T21:00:00Z';
  h.apple.forecastHourly.metadata.expireTime = '2026-11-04T23:00:00Z';
  const result = await h.get();
  expect(result.status).toBe('unavailable');
  expect(result.issues.some((i) => i.code === 'stale-data')).toBe(true);
});

test('the composite representative point cannot hide a distant component forecast from route scoring', async () => {
  const route = await makeRoute();
  const input = inputFor([route]);
  const forecasts = forecastsFor([route]);
  const assessed = recommendRides(
    [route],
    input,
    forecasts,
    scoringNow.getTime(),
  );
  expect(assessed.rankings).toHaveLength(1);
  const remote = forecasts.map((f) => {
    if (f.status === 'unavailable') return f;
    return {
      ...f,
      series: f.series.map((s) => ({
        ...s,
        evidence: [
          {
            provenance: f.provenance,
            descriptor: s.descriptor,
            method: 'native' as const,
            nativeTimeStepSeconds: 3600,
            location: {
              ...f.location,
              coordinate: { latitude: 25.05, longitude: 121.56 },
            },
            periods: [
              { start: '2026-10-10T00:00:00Z', end: '2026-10-11T00:00:00Z' },
            ],
          },
        ],
      })),
    };
  });
  const result = recommendRides([route], input, remote, scoringNow.getTime());
  expect(result.rankings).toHaveLength(0);
  expect(result.unranked[0]?.issues).toContain('forecast-too-far-from-route');
});
