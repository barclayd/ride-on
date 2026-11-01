import { expect, test } from 'bun:test';
import { DAY, dayStart, HOUR } from '../src/ground/contracts.ts';
import {
  chooseGauge,
  gaugeDay,
  normalizeGaugeReadings,
} from '../src/ground/gauges.ts';
import { missingHour, refreshAfter } from '../src/ground/service.ts';
import { cellFor, routeExposure } from '../src/ground/spatial.ts';
import { summarizeHours } from '../src/ground/summary.ts';
import { groundRoute } from './fixtures/ground.ts';

test('surface intervals exclude paved/transport while retaining unknown gaps and located gravel', () => {
  const route = groundRoute();
  if (!route.surface) throw new Error('Missing fixture');
  route.surface.sections = [
    { fromM: 0, toM: 200, surface: 'paved', sourceCode: 'p' },
    { fromM: 300, toM: 700, surface: 'gravel', sourceCode: 'g' },
    { fromM: 700, toM: 900, surface: 'non-cycling', sourceCode: 'f' },
  ];
  const exposure = routeExposure(route);
  expect(
    exposure.sections.map(({ fromM, toM, surface }) => ({
      fromM,
      toM,
      surface,
    })),
  ).toEqual([
    { fromM: 200, toM: 300, surface: 'unknown' },
    { fromM: 300, toM: 700, surface: 'gravel' },
    { fromM: 900, toM: 1000, surface: 'unknown' },
  ]);
  expect(routeExposure(groundRoute('paved')).cells).toEqual([]);
  expect(
    routeExposure({ ...route, sourceHash: 'changed' }).sections[0]?.surface,
  ).toBe('unknown');
  expect(routeExposure({ ...route, surface: null }).sections[0]?.toM).toBe(
    1000,
  );
});

test('nearby overlapping routes share a request lattice, including valid edge coordinates', () => {
  expect(cellFor({ latitude: 51.511, longitude: -0.111 }).id).toBe(
    cellFor({ latitude: 51.512, longitude: -0.112 }).id,
  );
  for (const point of [
    { latitude: 90, longitude: 180 },
    { latitude: -90, longitude: -180 },
  ]) {
    const cell = cellFor(point);
    expect(Math.abs(cell.latitude)).toBeLessThan(90);
    expect(Math.abs(cell.longitude)).toBeLessThan(180);
  }
});

test('24-hour accumulation uses interval ends and never counts rain after the cut-off across DST', () => {
  for (const date of ['2026-03-29', '2026-10-25']) {
    const end = dayStart(date) + 12 * HOUR;
    const hours = Array.from({ length: 26 }, (_, i) => ({
      ...missingHour(end - (24 - i) * HOUR, end),
      rainMm: i === 0 || i === 25 ? 100 : 1,
      precipitationMm: 1,
      referenceEt0Mm: 0.1,
    }));
    const summary = summarizeHours(hours, end, 24);
    expect(summary.rain.totalMm).toBe(24);
    expect(summary.referenceEt0.totalMm).toBe(2.4);
    expect(Date.parse(summary.end) - Date.parse(summary.start)).toBe(DAY);
  }
});

test('missing data is not dry and cached forecasts retain their forecast provenance', () => {
  const end = dayStart('2026-10-09');
  const hours = Array.from({ length: 24 }, (_, i) => ({
    ...missingHour(end - i * HOUR, end - 48 * HOUR),
    rainMm: i === 0 ? null : 0,
  }));
  const summary = summarizeHours(hours, end, 24);
  expect(summary.rain).toEqual({
    totalMm: null,
    knownTotalMm: 0,
    availableHours: 23,
    expectedHours: 24,
    forecastHours: 23,
  });
  expect(summary.referenceEt0.knownTotalMm).toBeNull();
});

test('refresh is relative to retrieval: stable history is retained, recent and incomplete data revisited', () => {
  const now = Date.parse('2026-10-09T12:55:00Z');
  expect(refreshAfter('2026-10-09', now, true) - now).toBe(3 * HOUR);
  expect(refreshAfter('2026-10-08', now, true) - now).toBe(6 * HOUR);
  expect(refreshAfter('2026-10-12', now, true) - now).toBe(12 * HOUR);
  expect(refreshAfter('2026-09-30', now, true) - now).toBe(90 * DAY);
  expect(refreshAfter('2026-09-30', now, false) - now).toBe(15 * 60_000);
});

const measureId = 'synthetic-rainfall-t-15_min-mm';
const measure = `http://environment.data.gov.uk/flood-monitoring/id/measures/${measureId}`;
test('gauge selection validates distance, units, accumulation period and safe identifiers', () => {
  const point = { latitude: 51.5, longitude: -0.1 };
  const measurement = {
    notation: measureId,
    parameter: 'rainfall',
    period: 900,
    unitName: 'mm',
    valueType: 'total',
  };
  const station = {
    lat: point.latitude,
    long: point.longitude,
    measures: [measurement],
  };
  expect(chooseGauge({ items: [station] }, point)?.measureId).toBe(measureId);
  for (const bad of [
    { ...station, lat: 55 },
    { ...station, measures: [{ ...measurement, unitName: 'm' }] },
    { ...station, measures: [{ ...measurement, period: 3600 }] },
    { ...station, measures: [{ ...measurement, notation: '../secrets' }] },
  ])
    expect(chooseGauge({ items: [bad] }, point)).toBeNull();
});

test('gauge duplicates, missing values and unconfirmed timestamp conventions stay explicit', () => {
  const start = dayStart('2026-10-08');
  const items = Array.from({ length: 97 }, (_, i) => ({
    dateTime: new Date(start + i * 900000).toISOString(),
    measure,
    value: i === 0 ? 2 : 1,
  }));
  const readings = normalizeGaugeReadings({ items }, measureId);
  expect(gaugeDay(readings, '2026-10-08')).toMatchObject({
    ifTimestampStartsInterval: { totalMm: 97, availableIntervals: 96 },
    ifTimestampEndsInterval: { totalMm: 96, availableIntervals: 96 },
  });
  const conflict = { ...items[1], value: 4 };
  const bad = normalizeGaugeReadings(
    { items: [...items, conflict, items[1]] },
    measureId,
  );
  expect(
    gaugeDay(bad, '2026-10-08').ifTimestampEndsInterval.totalMm,
  ).toBeNull();
  expect(
    normalizeGaugeReadings(
      { items: [{ ...items[0], value: 'NaN' }] },
      measureId,
    ).size,
  ).toBe(0);
  expect(() =>
    normalizeGaugeReadings({ items: Array(4000).fill(items[0]) }, measureId),
  ).toThrow('limit');
});

test('public station references without inline notation can identify a gauge without following arbitrary URLs', () => {
  const point = { latitude: 51.5, longitude: -0.1 };
  const reference = {
    '@id': measure,
    parameter: 'rainfall',
    period: 900,
    unitName: 'mm',
  };
  const item = { lat: 51.5, long: -0.1, measures: [reference] };
  expect(chooseGauge({ items: [item] }, point)?.measureId).toBe(measureId);
  expect(
    chooseGauge(
      {
        items: [
          {
            ...item,
            measures: [{ ...reference, '@id': 'https://example.test/private' }],
          },
        ],
      },
      point,
    ),
  ).toBeNull();
});

test('a cache filled between the initial read and lease acquisition avoids a duplicate provider call', async () => {
  const { collectGroundEvidence } = await import('../src/ground/service.ts');
  const now = new Date('2026-10-09T12:00:00Z');
  const today = dayStart('2026-10-09');
  const days = Array.from({ length: 35 }, (_, i) => {
    const start = today + (i - 28) * DAY;
    return {
      date: new Date(start).toISOString().slice(0, 10),
      retrievedAt: now.toISOString(),
      refreshAt: new Date(now.getTime() + HOUR).toISOString(),
      gridCoordinate: { latitude: 51.5, longitude: -0.1 },
      hours: Array.from({ length: 24 }, (_, j) => ({
        ...missingHour(start + j * HOUR, now.getTime()),
        rainMm: 1,
      })),
    };
  });
  let reads = 0;
  const forbidden = async () => {
    throw new Error('Duplicate request');
  };
  const result = await collectGroundEvidence(
    [groundRoute()],
    {
      read: async () => (++reads === 1 ? [] : days),
      acquire: async () => true,
      release: async () => {},
      prune: async () => {},
      reserve: forbidden,
      write: forbidden,
    },
    {
      id: 'synthetic',
      model: 'synthetic',
      version: '1',
      attribution: {
        text: 'synthetic',
        url: 'https://example.test',
        licence: 'test',
      },
      fetch: forbidden,
    },
    now,
  );
  expect(result.usage.httpRequests).toBe(0);
  expect(result.cells[0]?.history[0]?.rain.totalMm).toBe(24);
});

test('gauge diagnostic skips inactive metadata, validates the full measure and bounds public requests', async () => {
  const { fetchGaugeComparison } = await import('../src/ground/gauges.ts');
  const ids = ['inactive', 'current'];
  const metadata = (id: string) => ({
    notation: id,
    parameter: 'rainfall',
    period: 900,
    unitName: 'mm',
    valueType: 'total',
  });
  const calls: string[] = [];
  const run = async (active: boolean) =>
    fetchGaugeComparison(
      { latitude: 51.5, longitude: -0.1 },
      '2026-10-08',
      '2026-10-08',
      new Date('2026-10-09T12:00:00Z'),
      async (url) => {
        calls.push(url.href);
        expect(url.origin).toBe('https://environment.data.gov.uk');
        if (url.pathname.endsWith('/stations'))
          return {
            items: ids.map((id, i) => ({
              lat: 51.5 + i * 0.001,
              long: -0.1,
              measures: [
                {
                  ...metadata(id),
                  notation: undefined,
                  valueType: undefined,
                  '@id': `http://environment.data.gov.uk/flood-monitoring/id/measures/${id}`,
                },
              ],
            })),
          };
        if (url.pathname.endsWith('/readings'))
          return {
            items: Array.from({ length: 97 }, (_, i) => ({
              dateTime: new Date(
                dayStart('2026-10-08') + i * 900000,
              ).toISOString(),
              value: 0.1,
              measure:
                'http://environment.data.gov.uk/flood-monitoring/id/measures/current',
            })),
          };
        const id = url.pathname.split('/').at(-1) ?? '';
        return {
          items: {
            ...metadata(id),
            latestReading:
              id === 'current' && active
                ? { dateTime: '2026-10-09T00:00:00Z' }
                : 'http://environment.data.gov.uk/flood-monitoring/data/readings/inactive/2024-01-01T00-00-00Z',
          },
        };
      },
    );
  const result = await run(true);
  expect(result.status).toBe('available');
  if (result.status !== 'available')
    throw new Error('Expected gauge comparison');
  expect(result.httpRequests).toBe(4);
  expect(result.days[0]?.ifTimestampEndsInterval.totalMm).toBe(9.6);
  expect(result.timestampConvention).toBe('unverified');
  expect(calls.filter((url) => url.includes('/readings'))).toHaveLength(1);
  expect((await run(false)).status).toBe('no-recent-readings');
});
