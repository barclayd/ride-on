import { Decoder, Stream } from '@garmin/fitsdk';
import { z } from 'zod';
import { AppError } from '../errors.ts';
import { importGpx } from './gpx.ts';

export const routeFileSchema = z.discriminatedUnion('format', [
  z.strictObject({
    format: z.literal('gpx'),
    content: z.string().min(1).max(5_000_000),
  }),
  z.strictObject({
    format: z.literal('fit'),
    content: z
      .string()
      .min(1)
      .max(6_666_668)
      .describe(
        'Standard base64 encoding of the raw FIT bytes, without a data URL prefix.',
      ),
  }),
]);
const invalidFit = (message: string): never => {
  throw new AppError(422, 'INVALID_FIT', message);
};

export const importRouteFile = async (
  file: z.infer<typeof routeFileSchema>,
  name?: string,
  createdAt = new Date().toISOString(),
) => {
  if (file.format === 'gpx') return importGpx(file.content, name, createdAt);
  if (
    file.content.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(file.content)
  )
    return invalidFit('FIT content must be standard base64.');
  const bytes = Uint8Array.from(atob(file.content), (c) => c.charCodeAt(0));
  if (bytes.length < 14) return invalidFit('The FIT file is truncated.');
  if (bytes.length > 5_000_000)
    throw new AppError(
      413,
      'UPLOAD_TOO_LARGE',
      'FIT uploads are limited to 5 MB.',
    );
  const decoder = new Decoder(Stream.fromByteArray(bytes));
  if (!decoder.isFIT() || !decoder.checkIntegrity())
    return invalidFit('The FIT header, length or checksum is invalid.');
  let count = 0;
  const { messages, errors } = decoder.read({
    mergeHeartRates: false,
    expandComponents: false,
    convertDateTimesToDates: false,
    mesgListener: () => {
      if (++count > 100_000)
        invalidFit('A FIT file may contain at most 100,000 messages.');
    },
  });
  if (errors.length) return invalidFit('The FIT file could not be decoded.');
  const type = messages.fileIdMesgs?.[0]?.type;
  if (
    !['activity', 'course'].includes(String(type)) ||
    (messages.fileIdMesgs?.length ?? 0) !== 1 ||
    (messages.sessionMesgs?.length ?? 0) > 1 ||
    (messages.courseMesgs?.length ?? 0) > 1
  )
    return invalidFit('Upload one FIT activity or course per file.');
  const records = messages.recordMesgs ?? [];
  if (records.length > 50_000)
    return invalidFit('A route may contain at most 50,000 points.');
  const points: string[] = [];
  let skipped = false;
  for (const record of records) {
    const lat = record.positionLat;
    const lon = record.positionLong;
    if (lat === undefined && lon === undefined) {
      skipped = true;
      continue;
    }
    if (
      typeof lat !== 'number' ||
      typeof lon !== 'number' ||
      !Number.isInteger(lat) ||
      !Number.isInteger(lon) ||
      Math.abs(lat) > 2 ** 30 ||
      Math.abs(lon) > 2 ** 31 ||
      lon === 0x7fffffff
    )
      return invalidFit('A FIT route point has invalid coordinates.');
    const elevation = record.enhancedAltitude ?? record.altitude;
    points.push(
      `<trkpt lat="${(lat * 180) / 2 ** 31}" lon="${(lon * 180) / 2 ** 31}">${typeof elevation === 'number' && Number.isFinite(elevation) ? `<ele>${elevation}</ele>` : ''}</trkpt>`,
    );
  }
  // Use the same bounded normalisation, elevation and sampling rules as GPX.
  const route = await importGpx(
    `<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg>${points.join('')}</trkseg></trk></gpx>`,
    name ?? messages.courseMesgs?.[0]?.name,
    createdAt,
  );
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return {
    ...route,
    sourceHash: Array.from(new Uint8Array(digest), (b) =>
      b.toString(16).padStart(2, '0'),
    ).join(''),
    warnings: [
      ...route.warnings,
      ...(skipped ? ['FIT_RECORDS_WITHOUT_POSITION_IGNORED'] : []),
    ],
  };
};
