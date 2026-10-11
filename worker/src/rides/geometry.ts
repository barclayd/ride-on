import { z } from 'zod';
import { haversineKm } from '../geo.ts';
import type { Coordinate } from '../weather/contracts.ts';

// Six decimal places preserve about 0.1 m precision without retaining GPX metadata.
export const geometrySchema = z.object({
  version: z.literal(1),
  encoding: z.literal('polyline6'),
  data: z.string().max(1_200_000),
  pointCount: z.number().int().min(2).max(100_000),
});
export type RideGeometry = z.infer<typeof geometrySchema>;
// Bounded iterative 2 m simplification preserves bends and handles date-line
// crossings using earth-centred metres. Never thin by GPX point index.
const simplify = (points: readonly Coordinate[]): Coordinate[] | null => {
  const vectors = points.map((p) => {
    const lat = (p.latitude * Math.PI) / 180;
    const lon = (p.longitude * Math.PI) / 180;
    return [
      6371000 * Math.cos(lat) * Math.cos(lon),
      6371000 * Math.cos(lat) * Math.sin(lon),
      6371000 * Math.sin(lat),
    ];
  });
  const keep = new Set([0, points.length - 1]);
  const pending: [number, number][] = [[0, points.length - 1]];
  let work = 0;
  while (pending.length) {
    const interval = pending.pop();
    if (!interval) break;
    const [first, last] = interval;
    const a = vectors[first];
    const b = vectors[last];
    if (!a || !b) return null;
    const d = b.map((v, i) => v - (a[i] ?? 0));
    const squared = d.reduce((n, v) => n + v * v, 0);
    let farthest = -1;
    let maximum = 4;
    for (let i = first + 1; i < last; i++) {
      if (++work > 2_000_000) return null;
      const p = vectors[i];
      if (!p) continue;
      const t = squared
        ? Math.max(
            0,
            Math.min(
              1,
              p.reduce((n, v, j) => n + (v - (a[j] ?? 0)) * (d[j] ?? 0), 0) /
                squared,
            ),
          )
        : 0;
      const error = p.reduce(
        (n, v, j) => n + (v - (a[j] ?? 0) - t * (d[j] ?? 0)) ** 2,
        0,
      );
      if (error > maximum) {
        maximum = error;
        farthest = i;
      }
    }
    if (farthest !== -1) {
      keep.add(farthest);
      pending.push([first, farthest], [farthest, last]);
    }
  }
  return [...keep]
    .sort((a, b) => a - b)
    .flatMap((i) => (points[i] ? [points[i]] : []));
};
export const encodeGeometry = (
  points: readonly Coordinate[],
): RideGeometry | null => {
  if (
    points.length > 100_000 ||
    points.some((p, i) => {
      const previous = points[i - 1];
      return previous && distanceM(previous, p) > 5000;
    })
  )
    return null;
  const simplified = simplify(points);
  if (!simplified || simplified.length < 2) return null;
  let lat = 0;
  let lon = 0;
  let data = '';
  const encode = (delta: number) => {
    let value = delta < 0 ? -delta * 2 - 1 : delta * 2;
    while (value >= 32) {
      data += String.fromCharCode((value % 32) + 95);
      value = Math.floor(value / 32);
    }
    data += String.fromCharCode(value + 63);
  };
  for (const p of simplified) {
    const nextLat = Math.round(p.latitude * 1e6);
    const nextLon = Math.round(p.longitude * 1e6);
    encode(nextLat - lat);
    encode(nextLon - lon);
    lat = nextLat;
    lon = nextLon;
  }
  return data.length <= 1_200_000
    ? { version: 1, encoding: 'polyline6', data, pointCount: simplified.length }
    : null;
};
export const decodeGeometry = (geometry: RideGeometry): Coordinate[] => {
  let offset = 0;
  let lat = 0;
  let lon = 0;
  const decode = () => {
    let value = 0;
    let factor = 1;
    while (offset < geometry.data.length && factor <= 32 ** 6) {
      const byte = geometry.data.charCodeAt(offset++) - 63;
      if (byte < 0 || byte > 63) throw new Error('Invalid encoded geometry');
      value += (byte % 32) * factor;
      if (byte < 32) return value % 2 ? -(value + 1) / 2 : value / 2;
      factor *= 32;
    }
    throw new Error('Truncated encoded geometry');
  };
  const points: Coordinate[] = [];
  while (offset < geometry.data.length) {
    lat += decode();
    lon += decode();
    if (
      Math.abs(lat) > 90e6 ||
      Math.abs(lon) > 180e6 ||
      points.length >= 100_000
    )
      throw new Error('Invalid encoded coordinate');
    points.push({ latitude: lat / 1e6, longitude: lon / 1e6 });
  }
  if (points.length !== geometry.pointCount)
    throw new Error('Geometry count mismatch');
  return points;
};

export const distanceM = (a: Coordinate, b: Coordinate) =>
  1000 * haversineKm([a.latitude, a.longitude], [b.latitude, b.longitude]);
