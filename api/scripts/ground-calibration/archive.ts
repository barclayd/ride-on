import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import {
  type Coordinate,
  coordinate,
  DAY,
  dayStart,
} from '../../src/ground/contracts.ts';
import { fetchEvidenceJson } from '../../src/ground/http.ts';
import {
  GROUND_VARIABLES,
  parseGroundResponse,
} from '../../src/ground/open-meteo.ts';

export const archiveUrl = (
  point: Coordinate,
  firstDate: string,
  lastDate: string,
  now: Date,
) => {
  coordinate.parse(point);
  z.iso.date().parse(firstDate);
  z.iso.date().parse(lastDate);
  const span = dayStart(lastDate) - dayStart(firstDate);
  if (span < 0 || span > 30 * DAY || dayStart(lastDate) + DAY > now.getTime())
    throw new Error(
      'Archive requests must cover 1–31 complete past UTC dates.',
    );
  const url = new URL(
    'https://historical-forecast-api.open-meteo.com/v1/forecast',
  );
  url.search = new URLSearchParams({
    latitude: String(point.latitude),
    longitude: String(point.longitude),
    models: 'ukmo_seamless',
    hourly: GROUND_VARIABLES.join(','),
    start_date: firstDate,
    end_date: lastDate,
    timezone: 'GMT',
    timeformat: 'unixtime',
  }).toString();
  return url;
};

const envelope = z.object({
  schemaVersion: z.literal(1),
  url: z.string().url(),
  retrievedAt: z.iso.datetime(),
  raw: z.unknown(),
});

/** Explicit opt-in network; durable local snapshots, separate from the live API cache. */
export const readArchive = async (
  point: Coordinate,
  first: string,
  last: string,
  options: {
    directory: string;
    live: boolean;
    now: Date;
    fetchJson?: typeof fetchEvidenceJson;
  },
) => {
  const url = archiveUrl(point, first, last, options.now);
  const key = createHash('sha256').update(url.href).digest('hex');
  const path = join(options.directory, `${key}.json`);
  const file = Bun.file(path);
  const cached = await file.exists();
  if (!cached && !options.live)
    throw new Error(
      'Archive cache miss. Use --live explicitly to retrieve historical weather.',
    );
  let stored: z.infer<typeof envelope>;
  if (cached) {
    if (file.size > 2_100_000)
      throw new Error('Archive cache file is too large.');
    stored = envelope.parse(JSON.parse(await file.text()));
  } else {
    stored = {
      schemaVersion: 1,
      url: url.href,
      retrievedAt: options.now.toISOString(),
      raw: await (options.fetchJson ?? fetchEvidenceJson)(url),
    };
  }
  if (
    stored.url !== url.href ||
    Date.parse(stored.retrievedAt) > options.now.getTime() ||
    Date.parse(stored.retrievedAt) < dayStart(last) + DAY
  )
    throw new Error('Archive provenance does not match this request.');
  const parsed = parseGroundResponse(
    stored.raw,
    point,
    new Date(stored.retrievedAt),
  );
  if (!cached) {
    await mkdir(options.directory, { recursive: true });
    await Bun.write(path, JSON.stringify(stored));
  }
  return {
    ...parsed,
    path,
    retrievedAt: stored.retrievedAt,
    url: url.href,
    httpRequests: cached ? 0 : 1,
  };
};
