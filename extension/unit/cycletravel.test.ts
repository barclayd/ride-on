import { expect, test } from 'bun:test';
import {
  buildGpx,
  decodePolyline,
  elevationPerPoint,
  encodePolyline,
} from '../lib/cycletravel';

test('decodes the reference Google polyline and round-trips at precision 6', () => {
  const points = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@', 5);
  expect(points).toEqual([
    [38.5, -120.2],
    [40.7, -120.95],
    [43.252, -126.453],
  ]);
  expect(decodePolyline(encodePolyline(points), 6)).toEqual(points);
});

test('elevation: mode 1 slices, mode 2 interpolates between sampled indices', () => {
  expect(elevationPerPoint(2, [10, 20, 99], null)).toEqual([10, 20]);
  expect(elevationPerPoint(5, [0, 40], [0, 4])).toEqual([0, 10, 20, 30, 40]);
});

test('GPX escapes the name and omits missing elevation', () => {
  const gpx = buildGpx(
    'Tea & <cake>',
    [
      [51.5, -0.1],
      [51.6, -0.2],
    ],
    [12.34],
  );
  expect(gpx).toContain('<name>Tea &amp; &lt;cake&gt;</name>');
  expect(gpx).toContain('<trkpt lat="51.5" lon="-0.1"><ele>12.3</ele></trkpt>');
  expect(gpx).toContain('<trkpt lat="51.6" lon="-0.2"></trkpt>');
});
