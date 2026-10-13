import { z } from 'zod';
import { haversineKm } from '../../src/geo.ts';

const STEP = 15 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const MAX_ROWS = 4000;
const ROOT = 'https://environment.data.gov.uk/hydrology/id/';
const ref = z.object({ '@id': z.string() });
const coordinate = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
});
const measureSchema = z.object({
  items: z
    .array(
      z.object({
        '@id': z.string(),
        notation: z.string(),
        parameter: z.literal('rainfall'),
        period: z.literal(900),
        unitName: z.literal('mm'),
        unit: z.object({
          '@id': z.literal('http://qudt.org/1.1/vocab/unit#Millimeter'),
        }),
        valueType: z.literal('total'),
        valueStatistic: z.object({
          '@id': z.literal(
            'http://environment.data.gov.uk/reference/def/core/total',
          ),
        }),
        observationType: z.object({
          '@id': z.literal(
            'http://environment.data.gov.uk/reference/def/core/Qualified',
          ),
        }),
        station: z.object({
          '@id': z.string(),
          label: z.string().max(200),
          lat: z.number().finite().min(-90).max(90),
          long: z.number().finite().min(-180).max(180),
        }),
      }),
    )
    .length(1),
});
const snapshotSchema = z.object({
  url: z.string(),
  retrievedAt: z.string(),
  raw: z.object({
    meta: z.object({
      '@id': z.string(),
      limit: z.number().int().positive().max(MAX_ROWS),
      offset: z.number().int().min(0).optional(),
    }),
    items: z
      .array(
        z.object({
          measure: ref,
          dateTime: z.string(),
          date: z.string().optional(),
          value: z.unknown(),
          quality: z.unknown(),
          completeness: z.unknown(),
          valid: z.unknown().optional(),
          invalid: z.unknown().optional(),
          missing: z.unknown().optional(),
        }),
      )
      .max(MAX_ROWS),
  }),
});

// The archive records GMT even when its timestamps omit a suffix. Never use the
// machine's local timezone. Strict round-trip validation rejects impossible dates.
const timestamp = (value: string, allowBare = false): number => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) {
    if (!allowBare || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value))
      throw new Error(
        'Expected a UTC timestamp (archive readings may omit Z).',
      );
    value += 'Z';
  }
  const time = Date.parse(value);
  if (
    !Number.isFinite(time) ||
    new Date(time).toISOString() !==
      (value.length === 20 ? value.replace('Z', '.000Z') : value)
  )
    throw new Error('Invalid calendar timestamp.');
  return time;
};

const resource = (value: string, kind: 'measures' | 'stations') => {
  const url = new URL(value);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.hostname !== 'environment.data.gov.uk' ||
    url.port ||
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    !new RegExp(`^/hydrology/id/${kind}/[A-Za-z0-9_-]+$`).test(url.pathname)
  )
    throw new Error('Unexpected Hydrology resource identity.');
  return `${ROOT}${kind}/${url.pathname.split('/').at(-1)}`;
};
const readingURL = (value: string, measure: string) => {
  const url = new URL(value);
  if (
    url.searchParams.has('_offset') &&
    url.searchParams.get('_offset') !== '0'
  )
    throw new Error('Partial readings page.');
  if (url.pathname !== `${new URL(measure).pathname}/readings`)
    throw new Error('Wrong readings resource.');
  url.pathname = url.pathname.replace(/\/readings$/, '');
  url.search = '';
  if (resource(url.href, 'measures') !== measure)
    throw new Error('Wrong readings measure.');
  return value;
};
const count = (counts: Record<string, number>, key: string) => {
  counts[key] = (counts[key] ?? 0) + 1;
};
const numericFlag = (value: unknown) => {
  if (typeof value === 'number')
    return Number.isFinite(value) && value >= 0 ? value : null;
  if (
    typeof value === 'string' &&
    /^\d+(?:\.\d+)?$/.test(value) &&
    Number.isFinite(Number(value))
  )
    return Number(value);
  return null;
};

export const auditGauge = (
  metadata: unknown,
  snapshot: unknown,
  target: {
    latitude: number;
    longitude: number;
    through: string;
  },
) => {
  coordinate.parse(target);
  const through = timestamp(target.through);
  if (through % STEP)
    throw new Error('Cutoff must align to a completed quarter hour.');
  const measure = measureSchema.parse(metadata).items[0];
  if (!measure) throw new Error('Missing measure.');
  const identity = resource(measure['@id'], 'measures');
  if (identity !== `${ROOT}measures/${measure.notation}`)
    throw new Error('Measure notation mismatch.');
  resource(measure.station['@id'], 'stations');
  const distanceKm = haversineKm(
    [target.latitude, target.longitude],
    [measure.station.lat, measure.station.long],
  );
  if (distanceKm > 15)
    throw new Error('Gauge is outside the 15 km comparison radius.');
  const data = snapshotSchema.parse(snapshot);
  readingURL(data.url, identity);
  readingURL(data.raw.meta['@id'], identity);
  const retrievedAt = timestamp(data.retrievedAt);
  if (retrievedAt < through)
    throw new Error('Snapshot predates the comparison cutoff.');
  if (data.raw.meta.offset || data.raw.items.length >= data.raw.meta.limit)
    throw new Error('Partial or potentially truncated readings snapshot.');

  const qualityCounts: Record<string, number> = Object.create(null);
  const completenessCounts: Record<string, number> = Object.create(null);
  const rejectionCounts: Record<string, number> = Object.create(null);
  const intervals = new Map<number, number | null>();
  let duplicateRows = 0;
  for (const row of data.raw.items) {
    if (resource(row.measure['@id'], 'measures') !== identity)
      throw new Error('Mixed measure identities.');
    const time = timestamp(row.dateTime, true);
    if (
      time % STEP ||
      time > retrievedAt ||
      (row.date !== undefined &&
        row.date !== new Date(time).toISOString().slice(0, 10))
    )
      throw new Error('Invalid reading date or quarter-hour alignment.');
    count(
      qualityCounts,
      typeof row.quality === 'string' ? row.quality : 'missing/invalid',
    );
    count(
      completenessCounts,
      typeof row.completeness === 'string'
        ? row.completeness
        : 'missing/invalid',
    );
    const reasons: string[] = [];
    if (row.quality !== 'Good') reasons.push('quality_not_good');
    if (row.completeness !== 'Complete') reasons.push('not_complete');
    if (
      typeof row.value !== 'number' ||
      !Number.isFinite(row.value) ||
      row.value < 0 ||
      row.value > 500
    )
      reasons.push('invalid_rainfall');
    // Do not assume the count/percentage scaling: only zero/nonzero is needed.
    if (row.valid !== undefined && (numericFlag(row.valid) ?? 0) <= 0)
      reasons.push('no_valid_components');
    for (const flag of ['invalid', 'missing'] as const)
      if (row[flag] !== undefined && numericFlag(row[flag]) !== 0)
        reasons.push(`${flag}_components`);
    for (const reason of reasons) count(rejectionCounts, reason);
    const value = reasons.length ? null : (row.value as number);
    if (intervals.has(time)) {
      duplicateRows++;
      if (intervals.get(time) !== value) {
        count(rejectionCounts, 'conflicting_duplicate');
        intervals.set(time, null);
      }
    } else intervals.set(time, value);
  }
  const windows = [24, 72, 168, 336, 672].map((hours) => ({
    hours,
    from: new Date(through - hours * HOUR).toISOString(),
    through: new Date(through).toISOString(),
    hypotheses: (['start', 'end'] as const).map((timestampEdge) => {
      let accepted = 0;
      let present = 0;
      let sum = 0;
      for (
        let end = through - hours * HOUR + STEP;
        end <= through;
        end += STEP
      ) {
        const time = timestampEdge === 'start' ? end - STEP : end;
        if (intervals.has(time)) present++;
        const value = intervals.get(time);
        if (typeof value === 'number') {
          accepted++;
          sum += value;
        }
      }
      const expected = hours * 4;
      return {
        timestampEdge,
        expected,
        present,
        accepted,
        unknown: expected - accepted,
        totalMm: accepted === expected ? Math.round(sum * 1000) / 1000 : null,
      };
    }),
  }));
  return {
    version: 'hydrology-quality-audit-v1',
    scoringApplied: false,
    historicalForecastValidation: false,
    target: { ...target, through: new Date(through).toISOString() },
    station: {
      name: measure.station.label,
      latitude: measure.station.lat,
      longitude: measure.station.long,
      distanceKm,
    },
    source: {
      measure: identity,
      readings: data.url,
      retrievedAt: data.retrievedAt,
      attribution:
        '© Environment Agency copyright and/or database right 2015. All rights reserved.',
      license:
        'https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/',
      timezone: 'GMT (UTC)',
      intervalEdge: 'unverified',
    },
    rows: data.raw.items.length,
    duplicateRows,
    qualityCounts,
    completenessCounts,
    rejectionCounts,
    windows,
  };
};

export const gaugeAuditMarkdown = (report: ReturnType<typeof auditGauge>) =>
  [
    '# Historical rainfall quality audit',
    '',
    `Gauge: ${report.station.name} (${report.station.distanceKm.toFixed(2)} km from sample).`,
    `Retrieved: ${report.source.retrievedAt}.`,
    '',
    'Only Good + Complete readings with consistent component flags are accepted. Missing or rejected intervals are unknown, never zero rain.',
    '',
    'Timestamp interval edge is unverified. Both hypotheses are shown; even complete totals are conditional until the edge is confirmed. No scoring or forecast validation is applied.',
    '',
    '| Hours | Timestamp edge | Accepted / expected | Total (mm) |',
    '| ---: | --- | ---: | ---: |',
    ...report.windows.flatMap((window) =>
      window.hypotheses.map(
        (h) =>
          `| ${window.hours} | ${h.timestampEdge} | ${h.accepted} / ${h.expected} | ${h.totalMm ?? 'Unknown'} |`,
      ),
    ),
    '',
    `Quality counts (all snapshot rows): ${JSON.stringify(report.qualityCounts)}.`,
    `Completeness counts: ${JSON.stringify(report.completenessCounts)}.`,
    `Rejection reasons (may overlap): ${JSON.stringify(report.rejectionCounts)}.`,
    '',
    `[Saved reading source](${report.source.readings}).`,
    report.source.attribution,
    `[Open Government Licence](${report.source.license}).`,
    '',
  ].join('\n');
