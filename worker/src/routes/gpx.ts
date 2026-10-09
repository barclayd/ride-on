import { SaxesParser } from 'saxes';
import { AppError } from '../errors.ts';
import { haversineKm, isValidLatLon } from '../geo.ts';
import type { Coordinate } from '../weather/contracts.ts';
import type { Route } from './model.ts';

type GpxPoint = Coordinate & { elevation: number | null };
const fail = (message: string): never => {
  throw new AppError(422, 'INVALID_GPX', message);
};
const number = (value: string | undefined): number => {
  if (
    !value?.trim() ||
    !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())
  )
    return NaN;
  return Number(value);
};
const distance = (a: Coordinate, b: Coordinate) =>
  haversineKm([a.latitude, a.longitude], [b.latitude, b.longitude]) * 1000;
const bearing = (a: Coordinate, b: Coordinate) => {
  const rad = Math.PI / 180;
  const delta = (b.longitude - a.longitude) * rad;
  return (
    (Math.atan2(
      Math.sin(delta) * Math.cos(b.latitude * rad),
      Math.cos(a.latitude * rad) * Math.sin(b.latitude * rad) -
        Math.sin(a.latitude * rad) *
          Math.cos(b.latitude * rad) *
          Math.cos(delta),
    ) /
      rad +
      360) %
    360
  );
};

/** GPX 1.0/1.1 track or route. Disconnected segments are explicitly rejected. */
export const importGpx = async (
  xml: string,
  nameOverride?: string,
  createdAt = new Date().toISOString(),
): Promise<Route> => {
  if (new TextEncoder().encode(xml).length > 5_000_000)
    throw new AppError(
      413,
      'UPLOAD_TOO_LARGE',
      'GPX uploads are limited to 5 MB.',
    );
  const parser = new SaxesParser({ xmlns: true });
  const stack: { name: string; text: string }[] = [];
  const segments: GpxPoint[][] = [];
  const warnings = new Set<string>();
  let namespace = '';
  let routes = 0;
  let tracks = 0;
  let pointCount = 0;
  let segment: GpxPoint[] | undefined;
  let point: GpxPoint | undefined;
  let embeddedName = '';
  parser.on('doctype', () => fail('DTD declarations are not supported.'));
  parser.on('opentag', (tag) => {
    if (stack.length > 32) fail('GPX nesting is too deep.');
    if (!stack.length) {
      if (
        tag.local !== 'gpx' ||
        ![
          '',
          'http://www.topografix.com/GPX/1/0',
          'http://www.topografix.com/GPX/1/1',
        ].includes(tag.uri)
      )
        fail('Expected a GPX document.');
      namespace = tag.uri;
      if (!namespace) warnings.add('GPX_NAMESPACE_MISSING');
      if (!['1.0', '1.1'].includes(tag.attributes.version?.value ?? ''))
        fail('Only GPX 1.0 and 1.1 are supported.');
    }
    stack.push({
      name: tag.uri === namespace ? tag.local : '#extension',
      text: '',
    });
    const path = stack.map((entry) => entry.name).join('/');
    if (path === 'gpx/trk') tracks++;
    if (path === 'gpx/rte') {
      routes++;
      segment = [];
      segments.push(segment);
    }
    if (path === 'gpx/trk/trkseg') {
      segment = [];
      segments.push(segment);
    }
    if (path === 'gpx/trk/trkseg/trkpt' || path === 'gpx/rte/rtept') {
      const latitude = number(tag.attributes.lat?.value);
      const longitude = number(tag.attributes.lon?.value);
      if (!isValidLatLon([latitude, longitude]))
        fail('A route point has invalid coordinates.');
      if (++pointCount > 50_000)
        fail('A route may contain at most 50,000 points.');
      point = { latitude, longitude, elevation: null };
      segment?.push(point);
    }
  });
  const text = (value: string) => {
    const top = stack.at(-1);
    if (top) top.text = (top.text + value).slice(0, 1000);
  };
  parser.on('text', text);
  parser.on('cdata', text);
  parser.on('closetag', () => {
    const path = stack.map((entry) => entry.name).join('/');
    const value = stack.at(-1)?.text ?? '';
    if (['gpx/trk/name', 'gpx/rte/name'].includes(path) && !embeddedName)
      embeddedName = value.trim();
    if (
      ['gpx/trk/trkseg/trkpt/ele', 'gpx/rte/rtept/ele'].includes(path) &&
      point
    ) {
      const elevation = number(value);
      if (Number.isFinite(elevation)) point.elevation = elevation;
      else warnings.add('INVALID_ELEVATION_IGNORED');
    }
    if (['gpx/trk/trkseg/trkpt', 'gpx/rte/rtept'].includes(path))
      point = undefined;
    stack.pop();
  });
  try {
    parser.write(xml).close();
  } catch (error) {
    if (error instanceof AppError) throw error;
    fail('The GPX XML is malformed.');
  }
  if (tracks + routes !== 1) fail('Upload one track or route per file.');
  const points: GpxPoint[] = [];
  for (const part of segments) {
    if (!part.length) continue;
    const previous = points.at(-1);
    if (previous && part[0] && distance(previous, part[0]) > 1)
      fail('Disconnected GPX segments need to be uploaded as separate routes.');
    for (const next of part) {
      const last = points.at(-1);
      if (last && distance(last, next) < 0.01) {
        warnings.add('DUPLICATE_POINTS_REMOVED');
        continue;
      }
      points.push(next);
    }
  }
  if (points.length < 2) fail('A route needs at least two distinct points.');
  const cumulative = [0];
  let ascentM = 0;
  let completeElevation = true;
  for (let i = 0; i < points.length; i++) {
    const current = points[i];
    const previous = points[i - 1];
    if (!current) continue;
    if (current.elevation === null) completeElevation = false;
    if (previous) {
      const gap = distance(previous, current);
      if (gap > 5000)
        fail('A gap between consecutive route points exceeds 5 km.');
      cumulative.push((cumulative.at(-1) ?? 0) + gap);
      if (previous.elevation !== null && current.elevation !== null)
        ascentM += Math.max(0, current.elevation - previous.elevation);
    }
  }
  const distanceM = cumulative.at(-1) ?? 0;
  if (distanceM < 100 || distanceM > 400_000)
    fail('Routes must be between 100 metres and 400 kilometres.');
  if (!completeElevation) warnings.add('MISSING_ELEVATION');
  else warnings.add('ASCENT_IS_UNSMOOTHED_ESTIMATE');
  const at = (metres: number) => {
    let low = 1;
    let high = cumulative.length - 1;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if ((cumulative[mid] ?? Infinity) < metres) low = mid + 1;
      else high = mid;
    }
    const a = points[low - 1];
    const b = points[low];
    if (!a || !b) return fail('Route geometry could not be sampled.');
    const from = cumulative[low - 1] ?? 0;
    const to = cumulative[low] ?? from;
    const fraction = Math.max(0, Math.min(1, (metres - from) / (to - from)));
    const delta = ((b.longitude - a.longitude + 540) % 360) - 180;
    return {
      coordinate: {
        latitude: a.latitude + fraction * (b.latitude - a.latitude),
        longitude: ((a.longitude + fraction * delta + 540) % 360) - 180,
      },
      bearingDegrees: bearing(a, b),
    };
  };
  const id = crypto.randomUUID();
  const weatherDistances = Array.from(
    { length: Math.ceil(distanceM / 10_000) + 1 },
    (_, index) => Math.min(index * 10_000, distanceM),
  );
  const weatherLocations = weatherDistances.map((metres, index) => ({
    id: `${id}:${index}`,
    distanceM: metres,
    coordinate: at(metres).coordinate,
  }));
  const legs: Route['legs'] = [];
  for (let fromM = 0; fromM < distanceM; fromM += 500) {
    const toM = Math.min(fromM + 500, distanceM);
    const mid = (fromM + toM) / 2;
    const nearest = weatherLocations.reduce((best, item) =>
      Math.abs(item.distanceM - mid) < Math.abs(best.distanceM - mid)
        ? item
        : best,
    );
    legs.push({ fromM, toM, ...at(mid), weatherLocationId: nearest.id });
  }
  const name = (nameOverride?.trim() || embeddedName || 'Imported route')
    // biome-ignore lint/suspicious/noControlCharactersInRegex: Strip control characters from user-facing names.
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .slice(0, 160);
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(xml),
  );
  return {
    schemaVersion: 1,
    id,
    name: name || 'Imported route',
    createdAt,
    sourceHash: Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join(''),
    distanceM,
    ascentM: completeElevation ? ascentM : null,
    originalPointCount: pointCount,
    warnings: [...warnings],
    legs,
    weatherLocations,
  };
};
