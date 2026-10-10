import { describe, expect, test } from 'bun:test';
import { requiredWeatherFor } from '../src/recommendations/engine.ts';
import { recommendationSchema } from '../src/recommendations/input.ts';
import { withForecastCache } from '../src/weather/cache.ts';
import type { ForecastRequest } from '../src/weather/contracts.ts';
import { ensembleDescriptors } from '../src/weather/descriptors.ts';
import {
  createMetOfficeBpf,
  normaliseBpf,
} from '../src/weather/met-office-bpf.ts';
import { bpfFixture, bpfSites } from './fixtures/bpf.ts';
import { present } from './fixtures/rides.ts';

const now = () => new Date('2026-10-09T12:00:00Z');
const location = { id: 'one', coordinate: { latitude: 51.2, longitude: -1 } };
const input = recommendationSchema.parse({
  routeIds: [crypto.randomUUID()],
  date: '2026-10-10',
  preferences: { weights: { clearSkies: 0.4 } },
  forecast: {
    representation: 'ensemble-summary',
    freshnessBasis: 'retrieval-time',
  },
});
const request: ForecastRequest = {
  locations: [location],
  range: { start: '2026-10-10T06:00:00Z', end: '2026-10-10T19:00:00Z' },
  required: requiredWeatherFor(input),
  maxAgeSeconds: 21600,
  maxTimeStepSeconds: 3600,
  maxLocationDistanceM: 10_000,
  freshnessBasis: 'retrieval-time',
};
const normalize = (
  percentiles = bpfFixture(),
  probabilities = bpfFixture({ probabilities: true }),
  req = request,
) =>
  normaliseBpf(
    [percentiles, probabilities],
    location,
    req,
    now().toISOString(),
  );

describe('BPF CoverageJSON contract', () => {
  test('a partial first hour still requires the interval overlapping the request start', () => {
    const fixture = bpfFixture();
    const gust = present(
      fixture.coverages.find((c) => c.id === 'windSpeedOfGust10mMaximumPt01h'),
    );
    const range = present(gust.ranges[gust.id]);
    gust.domain.axes.t.values = gust.domain.axes.t.values.slice(8);
    gust.domain.axes.t.bounds = gust.domain.axes.t.bounds?.slice(16);
    range.values = range.values.filter((_, index) => index % 25 >= 8);
    range.shape[1] = 17;
    const result = normalize(fixture, bpfFixture({ probabilities: true }), {
      ...request,
      required: [ensembleDescriptors.windGust],
      range: { start: '2026-10-10T06:30:00Z', end: '2026-10-10T08:30:00Z' },
    });
    expect(result.status).toBe('partial');
    expect(result.issues.map((i) => i.code)).toContain(
      'outside-forecast-horizon',
    );
  });

  test('three-hourly evidence cannot satisfy an hourly comparison', () => {
    const fixture = bpfFixture();
    const coverage = present(
      fixture.coverages.find((c) => c.id === 'airTemperature1p5m'),
    );
    const range = present(coverage.ranges[coverage.id]);
    const selectedHours = [0, 3, 6, 9, 12, 15, 18, 21, 24];
    const values = range.values;
    range.values = Array.from({ length: 3 }, (_, p) =>
      selectedHours.map((h) => values[p * 25 + h] ?? null),
    ).flat();
    range.shape = [3, selectedHours.length];
    const times = coverage.domain.axes.t.values;
    coverage.domain.axes.t.values = selectedHours.map((h) => present(times[h]));
    const result = normalize(fixture);
    expect(
      result.issues.some((i) => i.code === 'insufficient-resolution'),
    ).toBe(true);
  });

  test('retains median/mean semantics, threshold probability and native periods', () => {
    const result = normalize();
    expect(result.status).toBe('complete');
    if (result.status === 'unavailable') throw new Error('Expected evidence');
    expect(result.provenance.forecastRunAt).toBeUndefined();
    expect(result.provenance.dataVersion).toBeNull();
    expect(result.issues.map((i) => i.code)).toEqual(['unknown-model-run']);
    const [temperature, wind, direction, gust, rain, probability, cloud] =
      result.series;
    expect(temperature?.samples[0]?.value).toBeCloseTo(14);
    expect(temperature?.descriptor).toMatchObject({
      statistic: { kind: 'percentile', percentile: 50 },
    });
    expect(wind?.samples[0]?.value).toBe(2);
    expect(direction?.descriptor).toMatchObject({
      statistic: { kind: 'ensemble-mean' },
    });
    expect(gust?.samples[10]?.time).toEqual({
      kind: 'period',
      aggregation: 'maximum',
      range: {
        start: '2026-10-10T09:00:00.000Z',
        end: '2026-10-10T10:00:00.000Z',
      },
    });
    expect(rain?.samples[0]?.value).toBe(0);
    expect(probability?.samples[10]?.value).toBe(0.08);
    expect(probability?.descriptor).toMatchObject({
      event: { kind: 'threshold', threshold: 0, measure: { unit: 'mm' } },
    });
    expect(probability?.samples[10]?.time).toMatchObject({
      range: {
        start: '2026-10-10T09:00:00.000Z',
        end: '2026-10-10T10:00:00.000Z',
      },
    });
    expect(cloud?.samples[0]?.value).toBe(0.1);
  });
  test('decodes transposed axes and converts precipitation metres/second to mm/hour', () => {
    const fixture = bpfFixture({
      value: (field, hour, selection) =>
        field === 'lwePrecipitationRate'
          ? 0.000001
          : field === 'airTemperature1p5m'
            ? 273.15 + hour + Number(selection)
            : 0,
    });
    for (const coverage of fixture.coverages) {
      const range = present(coverage.ranges[coverage.id]);
      const original = [...range.values];
      const count = present(range.shape[0]);
      range.axisNames.reverse();
      range.shape.reverse();
      range.values = Array.from({ length: 25 }, (_, h) =>
        Array.from({ length: count }, (_, p) => original[p * 25 + h] ?? null),
      ).flat();
    }
    const result = normalize(fixture);
    if (result.status === 'unavailable') throw new Error('Expected evidence');
    expect(result.series[0]?.samples[12]?.value).toBeCloseTo(62);
    expect(result.series[4]?.samples[12]?.value).toBeCloseTo(3.6);
  });
  test.each([
    'units',
    'shape',
    'bounds',
    'mean',
    'site',
    'crs',
    'threshold-unit',
  ] as const)('rejects unverified %s instead of fabricating weather', (fault) => {
    const fixture = bpfFixture();
    const probabilities = bpfFixture({ probabilities: true });
    const first = present(fixture.coverages[0]);
    if (fault === 'units')
      present(first.parameters[first.id]).unit.symbol = 'Cel';
    if (fault === 'shape') present(first.ranges[first.id]).shape = [25, 3];
    if (fault === 'bounds')
      present(
        fixture.coverages.find((c) => c.id.includes('Gust')),
      ).domain.axes.t.bounds = [];
    if (fault === 'mean') {
      const c = present(
        fixture.coverages.find((c) => c.id.includes('Direction')),
      );
      present(c.parameters[c.id]).custom.cellMethods = {
        label: { en: 'time: mean' },
      };
    }
    if (fault === 'site')
      probabilities.coverages[0]?.domain.axes.x.values.splice(0, 1, -2);
    if (fault === 'crs')
      present(fixture.referencing[0]).system.id = 'unverified';
    if (fault === 'threshold-unit')
      present(probabilities.referencing[1]).system.label = {
        en: 'thresholds in inches',
      };
    expect(normalize(fixture, probabilities)).toMatchObject({
      status: 'unavailable',
      issues: [{ code: 'invalid-response' }],
    });
  });
  test('null/invalid cloud values and missing median stay unknown', () => {
    for (const value of [null, -0.1, 1.1]) {
      const result = normalize(
        bpfFixture({
          value: (field) => (field === 'cloudAreaFraction' ? value : 0),
        }),
      );
      expect(result.status).toBe('partial');
      if (result.status !== 'unavailable')
        expect(
          result.series.at(-1)?.samples.every((s) => s.value === null),
        ).toBe(true);
    }
    const fixture = bpfFixture();
    const cloud = present(
      fixture.coverages.find((c) => c.id === 'cloudAreaFraction'),
    );
    present(cloud.domain.axes.percentiles).values = ['10', '40', '90'];
    const result = normalize(fixture);
    expect(result.status).toBe('partial');
    if (result.status !== 'unavailable') expect(result.series).toHaveLength(6);
  });
  test('cannot claim model-run freshness or use distant sites', () => {
    expect(
      normalize(undefined, undefined, {
        ...request,
        freshnessBasis: 'model-run',
      }),
    ).toMatchObject({
      status: 'unavailable',
      issues: [{ code: 'unknown-model-run' }],
    });
    expect(
      normalize(
        bpfFixture({ longitude: 1 }),
        bpfFixture({ probabilities: true, longitude: 1 }),
      ),
    ).toMatchObject({
      status: 'unavailable',
      issues: [{ code: 'outside-coverage' }],
    });
  });
});

describe('BPF transport and cache', () => {
  test('coalesces nearby samples at one site, uses header-only auth and caches retrieval freshness separately', async () => {
    let calls = 0;
    const provider = createMetOfficeBpf({
      apiKey: 'fake-bpf-key',
      now,
      fetch: async (url, init) => {
        calls++;
        expect(url).not.toContain('fake-bpf-key');
        expect(new Headers(init.headers).get('apikey')).toBe('fake-bpf-key');
        expect(init.redirect).toBe('manual');
        if (url.endsWith('/locations')) return Response.json(bpfSites());
        return Response.json(
          bpfFixture({ probabilities: url.includes('uk-spot-probabilities') }),
        );
      },
    });
    const data = new Map<string, string>();
    const cached = withForecastCache(
      provider,
      {
        get: async (key) => data.get(key) ?? null,
        put: async (key, value) => {
          data.set(key, value);
        },
      },
      { now },
    );
    const req = {
      ...request,
      locations: [
        location,
        { id: 'two', coordinate: { latitude: 51.201, longitude: -1 } },
      ],
    };
    expect(
      (await cached.getForecast(req, new AbortController().signal)).map(
        (r) => r.status,
      ),
    ).toEqual(['complete', 'complete']);
    expect(calls).toBe(3);
    const again = await cached.getForecast(req, new AbortController().signal);
    expect(calls).toBe(3);
    expect(again[1]).toMatchObject({ location: { requested: { id: 'two' } } });
    expect(
      (
        await cached.getForecast(
          { ...req, freshnessBasis: 'model-run' },
          new AbortController().signal,
        )
      )[0]?.status,
    ).toBe('unavailable');
    expect(calls).toBe(3);
  });
  test('stops queued requests on quota rejection and preserves retry advice', async () => {
    let calls = 0;
    const provider = createMetOfficeBpf({
      apiKey: 'fake',
      concurrency: 1,
      fetch: async () => {
        calls++;
        return new Response('private upstream body', {
          status: 429,
          headers: { 'Retry-After': '60' },
        });
      },
    });
    const result = await provider.getForecast(
      {
        ...request,
        locations: Array.from({ length: 8 }, (_, i) => ({
          id: String(i),
          coordinate: { latitude: 51 + i / 100, longitude: -1 },
        })),
      },
      new AbortController().signal,
    );
    expect(calls).toBe(1);
    expect(
      result.every(
        (r) =>
          r.status === 'unavailable' &&
          r.issues[0].code === 'rate-limited' &&
          r.issues[0].retryAfterSeconds === 60,
      ),
    ).toBe(true);
    expect(JSON.stringify(result)).not.toContain('private upstream body');
  });
});
