import { z } from 'zod';
import { haversineKm } from '../geo.ts';
import { type Coordinate, DAY, dateKey, dayStart } from './contracts.ts';
import { fetchEvidenceJson } from './http.ts';

export const EA_ATTRIBUTION = {
  text: 'This uses Environment Agency rainfall data from the real-time data API (Beta).',
  url: 'https://environment.data.gov.uk/flood-monitoring/doc/rainfall',
  licence: 'Open Government Licence v3.0',
};
const measureSchema = z.object({
  notation: z.string().regex(/^[a-zA-Z0-9_-]{1,180}$/),
  parameter: z.literal('rainfall'),
  period: z.literal(900),
  unitName: z.literal('mm'),
  valueType: z.literal('total'),
});
const measureReferenceSchema = measureSchema
  .partial({ notation: true, valueType: true })
  .extend({ '@id': z.string().optional() });
const stationSchema = z.object({
  lat: z.number().min(-90).max(90),
  long: z.number().min(-180).max(180),
  measures: z.array(z.unknown()),
});
const envelope = z.object({ items: z.array(z.unknown()).max(4000) });
const readingSchema = z.object({
  dateTime: z.iso.datetime(),
  value: z.number().nonnegative().max(500).nullish(),
  measure: z.string(),
});
const gaugeCandidates = (input: unknown, point: Coordinate) => {
  const candidates = envelope.parse(input).items.flatMap((item) => {
    const station = stationSchema.safeParse(item);
    if (!station.success) return [];
    const { lat, long, measures } = station.data;
    const distanceKm = haversineKm(
      [point.latitude, point.longitude],
      [lat, long],
    );
    if (distanceKm > 15) return [];
    return measures.flatMap((measure) => {
      const parsed = measureReferenceSchema.safeParse(measure);
      if (!parsed.success) return [];
      const uri = parsed.data['@id'];
      const fromUri = uri?.match(
        /^https?:\/\/environment\.data\.gov\.uk\/flood-monitoring\/id\/measures\/([a-zA-Z0-9_-]{1,180})$/,
      )?.[1];
      if (uri && !fromUri) return [];
      if (fromUri && parsed.data.notation && fromUri !== parsed.data.notation)
        return [];
      const measureId = fromUri ?? parsed.data.notation;
      return measureId
        ? [
            {
              measureId,
              coordinate: { latitude: lat, longitude: long },
              distanceKm,
            },
          ]
        : [];
    });
  });
  return candidates.sort(
    (a, b) =>
      a.distanceKm - b.distanceKm || a.measureId.localeCompare(b.measureId),
  );
};
export const chooseGauge = (input: unknown, point: Coordinate) =>
  gaugeCandidates(input, point)[0] ?? null;

export const normalizeGaugeReadings = (input: unknown, measureId: string) => {
  const readings = new Map<number, number | null>();
  const items = envelope.parse(input).items;
  // A full page could be truncated. Do not present a partial page as complete.
  if (items.length === 4000) throw new Error('Gauge reading limit reached.');
  for (const item of items) {
    const parsed = readingSchema.safeParse(item);
    if (!parsed.success) continue;
    const value = parsed.data;
    if (
      !['http:', 'https:'].some(
        (scheme) =>
          value.measure ===
          `${scheme}//environment.data.gov.uk/flood-monitoring/id/measures/${measureId}`,
      )
    )
      continue;
    const time = Date.parse(value.dateTime);
    if (time % 900_000 !== 0) continue;
    const rain = value.value ?? null;
    // Conflicting duplicate observations invalidate this interval.
    readings.set(
      time,
      readings.has(time) && readings.get(time) !== rain ? null : rain,
    );
  }
  return readings;
};
export const gaugeDay = (
  readings: ReadonlyMap<number, number | null>,
  date: string,
) => {
  const total = (offset: number) => {
    let count = 0;
    let sum = 0;
    for (let i = 0; i < 96; i++) {
      const rain = readings.get(dayStart(date) + (i + offset) * 900_000);
      if (rain !== undefined && rain !== null) {
        count++;
        sum += rain;
      }
    }
    return {
      availableIntervals: count,
      expectedIntervals: 96,
      totalMm: count === 96 ? Math.round(sum * 1000) / 1000 : null,
    };
  };
  // EA's public reference specifies 15-minute totals but not which interval
  // edge dateTime denotes. Expose BOTH, rather than inventing exact alignment.
  return {
    date,
    ifTimestampStartsInterval: total(0),
    ifTimestampEndsInterval: total(1),
  };
};

/** Explicit calibration diagnostic, never a fallback/blend in recommendations. */
export const fetchGaugeComparison = async (
  point: Coordinate,
  first: string,
  last: string,
  now: Date,
  fetchJson: typeof fetchEvidenceJson = fetchEvidenceJson,
) => {
  z.iso.date().parse(first);
  z.iso.date().parse(last);
  const today = dayStart(dateKey(now.getTime()));
  if (
    dayStart(first) < today - 28 * DAY ||
    dayStart(last) >= today ||
    dayStart(first) > dayStart(last)
  )
    throw new Error(
      'Gauge comparisons require completed UTC days within the last 28 days.',
    );
  const stationsUrl = new URL(
    'https://environment.data.gov.uk/flood-monitoring/id/stations',
  );
  stationsUrl.search = new URLSearchParams({
    parameter: 'rainfall',
    lat: String(point.latitude),
    long: String(point.longitude),
    dist: '15',
    _limit: '100',
  }).toString();
  const candidates = gaugeCandidates(await fetchJson(stationsUrl), point).slice(
    0,
    3,
  );
  let httpRequests = 1;
  if (!candidates.length)
    return {
      status: 'no-nearby-gauge' as const,
      attribution: EA_ATTRIBUTION,
      httpRequests,
    };
  for (const gauge of candidates) {
    const detailUrl = new URL(
      `https://environment.data.gov.uk/flood-monitoring/id/measures/${gauge.measureId}`,
    );
    httpRequests++;
    const detail = z
      .object({
        items: measureSchema.extend({ latestReading: z.unknown().optional() }),
      })
      .parse(await fetchJson(detailUrl));
    if (detail.items.notation !== gauge.measureId)
      throw new Error('Gauge measure identity mismatch.');
    // Inactive gauges remain in the station list. Skip them using metadata when
    // possible; never fetch a latestReading URI supplied by the provider.
    const latest = detail.items.latestReading;
    const objectTime = z
      .object({ dateTime: z.iso.datetime() })
      .safeParse(latest);
    const uriTime =
      typeof latest === 'string'
        ? latest.match(/\/(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z$/)
        : null;
    const lastAt = objectTime.success
      ? Date.parse(objectTime.data.dateTime)
      : uriTime
        ? Date.parse(`${uriTime[1]}T${uriTime[2]}:${uriTime[3]}:${uriTime[4]}Z`)
        : null;
    if (lastAt !== null && lastAt < dayStart(first)) continue;
    // Construct the allowlisted endpoint; never follow URLs in provider payloads.
    const readingsUrl = new URL(
      `https://environment.data.gov.uk/flood-monitoring/id/measures/${gauge.measureId}/readings`,
    );
    readingsUrl.search = new URLSearchParams({
      startdate: first,
      enddate: dateKey(dayStart(last) + DAY),
      _limit: '4000',
    }).toString();
    httpRequests++;
    const readings = normalizeGaugeReadings(
      await fetchJson(readingsUrl),
      gauge.measureId,
    );
    const available = [...readings]
      .filter(
        ([time, value]) =>
          value !== null && time >= dayStart(first) && time <= now.getTime(),
      )
      .map(([time]) => time);
    if (!available.length) continue;
    const latestTime = Math.max(...available);
    const dates = Array.from(
      { length: Math.round((dayStart(last) - dayStart(first)) / DAY) + 1 },
      (_, i) => dateKey(dayStart(first) + i * DAY),
    );
    return {
      status: 'available' as const,
      attribution: EA_ATTRIBUTION,
      httpRequests,
      gauge,
      basis: 'observed' as const,
      retrievedAt: now.toISOString(),
      latestReadingAt: new Date(latestTime).toISOString(),
      latestReadingAgeHours: (now.getTime() - latestTime) / 3_600_000,
      intervalSeconds: 900,
      timestampConvention: 'unverified' as const,
      days: dates.map((date) => gaugeDay(readings, date)),
    };
  }
  return {
    status: 'no-recent-readings' as const,
    attribution: EA_ATTRIBUTION,
    httpRequests,
    checkedGauges: candidates.length,
  };
};
