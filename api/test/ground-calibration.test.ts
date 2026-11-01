import { expect, test } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  archiveUrl,
  readArchive,
} from '../scripts/ground-calibration/archive.ts';
import { calibrateTrack } from '../scripts/ground-calibration/report.ts';
import {
  parseCalibrationTrack,
  sampleTrack,
} from '../scripts/ground-calibration/track.ts';
import { DAY, HOUR } from '../src/ground/contracts.ts';
import {
  estimateGround,
  hindcastWetnessTimeline,
  wetnessTimeline,
} from '../src/ground/wetness.ts';
import { groundRoute } from './fixtures/ground.ts';
import { GROUND_NOW, wetnessEvidence } from './fixtures/wetness.ts';

const recorded = (times = ['2026-06-07T10:00:00Z', '2026-06-07T10:30:00Z']) =>
  `<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Synthetic</name><trkseg>${times.map((time, i) => `<trkpt lat="51.51" lon="${-0.111 + i * 0.005}"><time>${time}</time></trkpt>`).join('')}</trkseg></trk></gpx>`;

test('recorded sampling preserves actual GPS passage times and rejects unbounded or ambiguous tracks', () => {
  const track = parseCalibrationTrack(recorded());
  expect(sampleTrack(track, 0, track.distanceM, 2).map((p) => p.time)).toEqual(
    track.points.map((p) => p.time),
  );
  for (const invalid of [
    recorded(['2026-06-07T10:00:00Z', '2026-06-07T09:00:00Z']),
    recorded(['2026-06-07T10:00:00Z', '2026-06-10T10:00:00Z']),
    recorded().replace('<time>2026-06-07T10:00:00Z</time>', ''),
    recorded().replace('lon="-0.111"', 'lon="30"'),
    recorded().replace('<trkseg>', '<trkseg></trkseg><trkseg>'),
    `<!DOCTYPE gpx []>${recorded()}`,
  ])
    expect(() => parseCalibrationTrack(invalid)).toThrow();
  for (const count of [0, 1, 13, NaN, 2.5])
    expect(() => sampleTrack(track, 0, track.distanceM, count)).toThrow();
  for (const end of [NaN, Infinity, 0, track.distanceM + 1])
    expect(() => sampleTrack(track, 0, end, 2)).toThrow();
});

const point = { latitude: 51.525, longitude: -0.125 };
const now = new Date('2026-10-13T12:00:00Z');
const syntheticResponse = () => ({
  ...point,
  utc_offset_seconds: 0,
  hourly_units: {
    time: 'unixtime',
    precipitation: 'mm',
    rain: 'mm',
    snowfall: 'cm',
    temperature_2m: '°C',
    et0_fao_evapotranspiration: 'mm',
  },
  hourly: {
    time: [Date.parse('2026-06-07T10:00:00Z') / 1000],
    precipitation: [1],
    rain: [1],
    snowfall: [0],
    temperature_2m: [15],
    et0_fao_evapotranspiration: [0.1],
  },
});
test('archive requests fix the source/model and reject future, excessive and invalid windows', () => {
  const url = archiveUrl(point, '2026-05-10', '2026-06-07', now);
  expect(url.origin).toBe('https://historical-forecast-api.open-meteo.com');
  expect(url.searchParams.get('models')).toBe('ukmo_seamless');
  expect(url.searchParams.get('hourly')?.split(',')).toHaveLength(5);
  for (const [from, to] of [
    ['2026-05-01', '2026-06-07'],
    ['2026-06-07', '2026-06-01'],
    ['2026-10-12', '2026-10-13'],
    ['bad', '2026-06-07'],
  ])
    expect(() =>
      archiveUrl(point, from as string, to as string, now),
    ).toThrow();
});
test('archive is offline by default, caches successful validated responses and preserves provenance on replay', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ground-archive-'));
  try {
    let calls = 0;
    const options = {
      directory,
      live: false,
      now,
      fetchJson: async () => {
        calls++;
        return syntheticResponse();
      },
    };
    await expect(
      readArchive(point, '2026-05-10', '2026-06-07', options),
    ).rejects.toThrow('cache miss');
    expect(calls).toBe(0);
    const first = await readArchive(point, '2026-05-10', '2026-06-07', {
      ...options,
      live: true,
    });
    const second = await readArchive(point, '2026-05-10', '2026-06-07', {
      ...options,
      now: new Date(now.getTime() + DAY),
    });
    expect(calls).toBe(1);
    expect(second.httpRequests).toBe(0);
    expect(second.retrievedAt).toBe(first.retrievedAt);
    expect(second.hours).toEqual(first.hours);
    const stored = JSON.parse(await Bun.file(first.path).text());
    stored.retrievedAt = '2027-01-01T00:00:00Z';
    await Bun.write(first.path, JSON.stringify(stored));
    await expect(
      readArchive(point, '2026-05-10', '2026-06-07', options),
    ).rejects.toThrow('provenance');
    expect(calls).toBe(1);
  } finally {
    await rm(directory, { recursive: true });
  }
});
test('invalid archive units are never cached or silently replaced by live requests', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ground-archive-'));
  try {
    const raw = syntheticResponse();
    raw.hourly_units.rain = 'inches';
    await expect(
      readArchive(point, '2026-05-10', '2026-06-07', {
        directory,
        live: true,
        now,
        fetchJson: async () => raw,
      }),
    ).rejects.toThrow();
    await expect(
      readArchive(point, '2026-05-10', '2026-06-07', {
        directory,
        live: false,
        now,
      }),
    ).rejects.toThrow('cache miss');
  } finally {
    await rm(directory, { recursive: true });
  }
});
test('hindcast explicitly accepts later reconstruction while live estimates still reject it', async () => {
  const evidence = await wetnessEvidence([groundRoute()]);
  const cell = evidence.cells[0];
  assert.ok(cell);
  for (const day of cell.days)
    day.retrievedAt = new Date(GROUND_NOW + DAY).toISOString();
  const live = estimateGround(
    wetnessTimeline(cell, GROUND_NOW, GROUND_NOW).get(GROUND_NOW),
    'granular',
  );
  expect(live.condition).toBeNull();
  expect(live.reasons).toContain('evidence-retrieved-after-assessment');
  const hindcast = hindcastWetnessTimeline(
    cell,
    GROUND_NOW,
    GROUND_NOW,
    GROUND_NOW + 2 * DAY,
  );
  expect(hindcast.purpose).toBe('hindcast');
  expect(hindcast.historicalForecastValidation).toBe(false);
  expect(
    estimateGround(hindcast.timeline.get(GROUND_NOW), 'granular').condition,
  ).toBe('firm');
  const missing = cell.hours.find((h) => Date.parse(h.end) === GROUND_NOW);
  assert.ok(missing);
  missing.rainMm = null;
  expect(
    estimateGround(
      hindcastWetnessTimeline(
        cell,
        GROUND_NOW,
        GROUND_NOW,
        GROUND_NOW + 2 * DAY,
      ).timeline.get(GROUND_NOW),
      'granular',
    ).condition,
  ).toBeNull();
  expect(() =>
    hindcastWetnessTimeline(cell, GROUND_NOW, GROUND_NOW + DAY, GROUND_NOW),
  ).toThrow();
});
test('hindcast sampling deduplicates cells, excludes rain after passage and retains unresolved surfaces', async () => {
  const track = parseCalibrationTrack(recorded());
  const e = await wetnessEvidence(
    [groundRoute()],
    (h) => ({ ...h, rainMm: Date.parse(h.end) > track.start ? 100 : 0 }),
    track.start,
  );
  const cell = e.cells[0];
  assert.ok(cell);
  let calls = 0;
  const report = await calibrateTrack(track, {
    fromM: 0,
    toM: track.distanceM,
    samples: 12,
    directory: '/unused',
    live: false,
    now,
    archive: async () => {
      calls++;
      return {
        hours: cell.hours,
        gridCoordinate: point,
        retrievedAt: now.toISOString(),
        url: 'https://example.test',
        path: '/synthetic',
        httpRequests: 0,
      };
    },
  });
  expect(calls).toBe(1);
  expect(report.results).toHaveLength(12);
  expect(report.historicalForecastValidation).toBe(false);
  expect(report.scoringApplied).toBe(false);
  for (const result of report.results) {
    expect(result.estimate.condition).toBeNull();
    expect(result.sensitivity.ifGranular.condition).toBe('firm');
    expect(Date.parse(result.evidenceThrough)).toBe(track.start);
    expect(result.history[0]?.rain.totalMm).toBe(0);
  }
  expect(report.results[0]?.history[4]?.rain.expectedHours).toBe(
    (28 * DAY) / HOUR,
  );
});
