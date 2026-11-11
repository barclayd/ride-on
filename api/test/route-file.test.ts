import { expect, test } from 'bun:test';
import { type Encodable, Encoder, type Mesg } from '@garmin/fitsdk';
import { importRouteFile } from '../src/routes/file.ts';
import { importGpx } from '../src/routes/gpx.ts';
import { simpleGpx } from './fixtures/rides.ts';

const fit = (type = 'course', position = true) => {
  const encoder = new Encoder();
  const write = <T extends Encodable<Mesg>>(message: T) =>
    encoder.writeMesg(message);
  write({
    mesgNum: 0,
    type,
    manufacturer: 'development',
    product: 1,
  });
  if (type === 'course')
    write({ mesgNum: 31, name: 'FIT candidate', sport: 'cycling' });
  for (const latitude of [51.5, 51.51, 51.52])
    write({
      mesgNum: 20,
      ...(position
        ? {
            positionLat: Math.round((latitude / 180) * 2 ** 31),
            positionLong: Math.round((-0.1 / 180) * 2 ** 31),
          }
        : {}),
      altitude: 10,
      heartRate: 123,
    });
  return encoder.close();
};
const encoded = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');

test('raw GPX uses the existing route normaliser unchanged', async () => {
  const expected = await importGpx(simpleGpx);
  const actual = await importRouteFile({ format: 'gpx', content: simpleGpx });
  expect(actual.sourceHash).toBe(expected.sourceHash);
  expect(actual.distanceM).toBe(expected.distanceM);
  expect(actual.ascentM).toBe(expected.ascentM);
});
test.each([
  'course',
  'activity',
])('FIT %s preserves geometry, hashes original bytes and excludes rider telemetry', async (type) => {
  const bytes = fit(type);
  const route = await importRouteFile({
    format: 'fit',
    content: encoded(bytes),
  });
  expect(route.distanceM).toBeCloseTo(
    (await importGpx(simpleGpx)).distanceM,
    1,
  );
  expect(route.ascentM).toBe(0);
  expect(route.originalPointCount).toBe(3);
  expect(JSON.stringify(route)).not.toContain('heartRate');
  expect(route.sourceHash).toBe(
    new Bun.CryptoHasher('sha256').update(bytes).digest('hex'),
  );
});
test('FIT rejects malformed base64, corrupt checksums, truncated bytes and non-route files', async () => {
  const bytes = fit();
  const corrupt = bytes.slice();
  corrupt[corrupt.length - 1] = (corrupt.at(-1) ?? 0) ^ 1;
  for (const content of [
    'not base64!',
    'A===',
    encoded(bytes.slice(0, -2)),
    encoded(corrupt),
    encoded(fit('settings')),
    encoded(fit('activity', false)),
  ])
    await expect(
      importRouteFile({ format: 'fit', content }),
    ).rejects.toBeDefined();
});
test('route uploads reject XML entities and excessive file bytes', async () => {
  await expect(
    importRouteFile({
      format: 'gpx',
      content:
        '<!DOCTYPE gpx [<!ENTITY x SYSTEM "file:///etc/passwd">]><gpx version="1.1">&x;</gpx>',
    }),
  ).rejects.toMatchObject({ code: 'INVALID_GPX' });
  await expect(
    importRouteFile({
      format: 'fit',
      content: encoded(new Uint8Array(5_000_001)),
    }),
  ).rejects.toMatchObject({ code: 'UPLOAD_TOO_LARGE' });
});
