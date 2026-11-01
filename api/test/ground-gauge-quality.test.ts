import { describe, expect, test } from 'bun:test';
import { auditGauge } from '../scripts/ground-calibration/hydrology.ts';

const id =
  'http://environment.data.gov.uk/hydrology/id/measures/synthetic-rainfall-t-900-mm-qualified';
const through = '2026-06-07T15:00:00Z';
const target = { latitude: 51, longitude: 0, through };
const metadata = () => ({
  items: [
    {
      '@id': id,
      notation: 'synthetic-rainfall-t-900-mm-qualified',
      period: 900,
      parameter: 'rainfall',
      unitName: 'mm',
      valueType: 'total',
      unit: { '@id': 'http://qudt.org/1.1/vocab/unit#Millimeter' },
      valueStatistic: {
        '@id': 'http://environment.data.gov.uk/reference/def/core/total',
      },
      observationType: {
        '@id': 'http://environment.data.gov.uk/reference/def/core/Qualified',
      },
      station: {
        '@id': 'http://environment.data.gov.uk/hydrology/id/stations/synthetic',
        label: 'Synthetic gauge',
        lat: 51,
        long: 0,
      },
    },
  ],
});
const row = (dateTime = through, value = 0) => ({
  measure: { '@id': id },
  dateTime,
  value,
  quality: 'Good',
  completeness: 'Complete',
  valid: '10000',
  invalid: '0',
  missing: '0',
});
const snapshot = (items: unknown[] = [row()]) => ({
  url: `${id}/readings?_limit=4000`,
  retrievedAt: '2026-10-13T18:00:00.001Z',
  raw: { meta: { '@id': `${id}/readings?_limit=4000`, limit: 4000 }, items },
});
const day = (value = 0) =>
  Array.from({ length: 97 }, (_, i) =>
    row(
      new Date(Date.parse(through) - (96 - i) * 900_000).toISOString(),
      value,
    ),
  );
const audit = (items: unknown[] = [row()]) =>
  auditGauge(metadata(), snapshot(items), target);
const totals = (result: ReturnType<typeof audit>) =>
  result.windows[0]?.hypotheses.map((h) => h.totalMm);

describe('offline Hydrology quality gate', () => {
  test('accepts measured zero only with full Good + Complete coverage', () => {
    const result = audit(day());
    expect(totals(result)).toEqual([0, 0]);
    expect(result.windows[1]?.hypotheses.every((h) => h.totalMm === null)).toBe(
      true,
    );
    expect(result.scoringApplied).toBe(false);
    expect(result.target.latitude).toBe(target.latitude);
    expect(result.source.intervalEdge).toBe('unverified');
  });

  test('Good numeric zeros cannot override Incomplete or missing components', () => {
    const result = audit(
      day().map((r) => ({
        ...r,
        completeness: 'Incomplete',
        valid: '0',
        missing: '10000',
      })),
    );
    expect(totals(result)).toEqual([null, null]);
    expect(result.windows[0]?.hypotheses.map((h) => h.accepted)).toEqual([
      0, 0,
    ]);
    expect(result.rejectionCounts.not_complete).toBe(97);
  });

  test('unchecked, suspect, estimated and unknown quality stay unaccepted', () => {
    for (const quality of [
      'Unchecked',
      'Suspect',
      'Estimated',
      'Missing',
      '',
    ]) {
      const result = audit(day().map((r) => ({ ...r, quality })));
      expect(totals(result)).toEqual([null, null]);
    }
  });

  test('rejects inconsistent component flags and invalid rainfall', () => {
    for (const patch of [
      { missing: '1' },
      { invalid: '10000' },
      { valid: '0' },
      { missing: '' },
      { valid: 'not a number' },
      { value: -1 },
      { value: Number.NaN },
      { value: 501 },
    ]) {
      const result = audit(day().map((r) => ({ ...r, ...patch })));
      expect(totals(result)).toEqual([null, null]);
    }
  });

  test('conflicting or rejected duplicates poison the interval in either order', () => {
    const rows = day(1);
    const first = rows[1];
    if (!first) throw new Error('Missing synthetic row');
    for (const duplicate of [
      { ...first, value: 2 },
      { ...first, completeness: 'Incomplete' },
    ]) {
      expect(totals(audit([...rows, duplicate]))).toEqual([null, null]);
      expect(totals(audit([duplicate, ...rows]))).toEqual([null, null]);
    }
    expect(totals(audit([...rows, first]))).toEqual([96, 96]);
  });

  test('reports both interval edges and excludes later readings', () => {
    const rows = day(1);
    rows[0] = row(rows[0]?.dateTime, 2);
    rows[96] = row(through, 3);
    rows.push(row('2026-06-07T15:15:00Z', 500));
    expect(totals(audit(rows))).toEqual([97, 98]);
  });

  test('interprets bare summer timestamps as GMT, not British Summer Time', () => {
    const rows = day(1).map((r) => ({
      ...r,
      dateTime: r.dateTime.replace('.000Z', ''),
    }));
    expect(totals(audit(rows))).toEqual([96, 96]);
    expect(() => audit([row('2026-02-30T15:00:00')])).toThrow();
    expect(() => audit([row('2026-06-07T15:00:00+01:00')])).toThrow();
    expect(() => audit([row('2026-06-07T15:01:00')])).toThrow();
    expect(() =>
      auditGauge(metadata(), snapshot(), {
        ...target,
        through: '2026-06-07T15:01:00Z',
      }),
    ).toThrow();
  });

  test('rejects wrong measure, units, period, remote identity or far-away gauge', () => {
    const bad = metadata();
    if (!bad.items[0]) throw new Error('Missing synthetic measure');
    bad.items[0].unitName = 'inches';
    expect(() => auditGauge(bad, snapshot(), target)).toThrow();
    bad.items[0].unitName = 'mm';
    bad.items[0].period = 86400;
    expect(() => auditGauge(bad, snapshot(), target)).toThrow();
    expect(() =>
      audit([
        { ...row(), measure: { '@id': id.replace('synthetic', 'another') } },
      ]),
    ).toThrow();
    expect(() =>
      audit([
        {
          ...row(),
          measure: {
            '@id': id.replace('environment.data.gov.uk', 'example.com'),
          },
        },
      ]),
    ).toThrow();
    expect(() =>
      auditGauge(metadata(), snapshot(), { ...target, latitude: 53 }),
    ).toThrow();
  });

  test('rejects truncation, invalid envelopes, future observations and predating snapshots', () => {
    expect(() =>
      auditGauge(
        metadata(),
        { ...snapshot(), url: `${id}/readings?_offset=10` },
        target,
      ),
    ).toThrow();
    const truncated = snapshot();
    truncated.raw.meta.limit = 1;
    expect(() => auditGauge(metadata(), truncated, target)).toThrow();
    expect(() =>
      auditGauge(
        metadata(),
        {
          ...snapshot(),
          raw: {
            ...snapshot().raw,
            meta: { ...snapshot().raw.meta, offset: 1 },
          },
        },
        target,
      ),
    ).toThrow();
    expect(() =>
      auditGauge(
        metadata(),
        { ...snapshot(), url: 'https://example.com/readings' },
        target,
      ),
    ).toThrow();
    expect(() =>
      auditGauge(
        metadata(),
        { ...snapshot(), retrievedAt: '2026-06-01T00:00:00Z' },
        target,
      ),
    ).toThrow();
    expect(() => audit([row('2027-01-01T00:00:00Z')])).toThrow();
    expect(() => audit([{ ...row(), date: '2026-06-06' }])).toThrow();
  });
});
