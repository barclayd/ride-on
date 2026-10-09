import { expect, test } from 'bun:test';
import { importGpx } from '../src/routes/gpx.ts';

const points =
  '<trkpt lat="51.5" lon="-0.1"><ele>10</ele></trkpt><trkpt lat="51.52" lon="-0.1"><ele>30</ele></trkpt>';
const gpx = (content: string, version = '1.1') =>
  `<gpx version="${version}" xmlns="http://www.topografix.com/GPX/${version.replace('.', '/')}">${content}</gpx>`;
test('GPX 1.0 and 1.1 create contiguous geometry, direction and sampling points', async () => {
  for (const version of ['1.0', '1.1']) {
    const route = await importGpx(
      gpx(
        `<trk><name>A &amp; B</name><trkseg>${points}</trkseg></trk>`,
        version,
      ),
    );
    expect(route.name).toBe('A & B');
    expect(route.distanceM).toBeCloseTo(2223.9, 0);
    expect(route.ascentM).toBe(20);
    expect(
      route.legs.reduce((sum, leg) => sum + leg.toM - leg.fromM, 0),
    ).toBeCloseTo(route.distanceM);
    expect(route.legs[0]?.bearingDegrees).toBeCloseTo(0);
    expect(route.weatherLocations.at(-1)?.distanceM).toBe(route.distanceM);
  }
});
test('route-only GPX accepts missing elevation without inventing zero ascent', async () => {
  const route = await importGpx(
    gpx(
      '<rte><rtept lat="51.5" lon="-0.1"/><rtept lat="51.52" lon="-0.1"/></rte>',
    ),
  );
  expect(route.ascentM).toBeNull();
  expect(route.warnings).toContain('MISSING_ELEVATION');
});
test('malformed XML, DTD, multiple routes, disconnected segments and invalid coordinates are rejected', async () => {
  for (const xml of [
    gpx('<trk>'),
    '<!DOCTYPE gpx [<!ENTITY x "boom">]>' +
      gpx(`<trk><trkseg>${points}</trkseg></trk>`),
    gpx(
      `<trk><trkseg>${points}</trkseg></trk><trk><trkseg>${points}</trkseg></trk>`,
    ),
    gpx(`<trk><trkseg>${points}</trkseg><trkseg>${points}</trkseg></trk>`),
    gpx(`<trk><trkseg>${points.replace('51.5', 'NaN')}</trkseg></trk>`),
  ])
    await expect(importGpx(xml)).rejects.toHaveProperty('code', 'INVALID_GPX');
});
test('duplicate points and connected segments do not add fictitious distance', async () => {
  const route = await importGpx(
    gpx(
      `<trk><trkseg>${points}</trkseg><trkseg><trkpt lat="51.52" lon="-0.1"/><trkpt lat="51.53" lon="-0.1"/></trkseg></trk>`,
    ),
  );
  expect(route.distanceM).toBeCloseTo(3335.85, 0);
  expect(route.warnings).toContain('DUPLICATE_POINTS_REMOVED');
});
