import { SaxesParser } from 'saxes';
import { z } from 'zod';
import { haversineKm, isValidLatLon } from '../../src/geo.ts';
import { DAY } from '../../src/ground/contracts.ts';

export type TrackPoint = {
  latitude: number;
  longitude: number;
  time: number;
  distanceM: number;
};
export const MAX_GPX_BYTES = 20_000_000;
/** Local recorded-ride analysis only; does not change the API's 5 MB upload limit. */
export const parseCalibrationTrack = (xml: string) => {
  if (new TextEncoder().encode(xml).length > MAX_GPX_BYTES)
    throw new Error('Calibration GPX is limited to 20 MB.');
  const parser = new SaxesParser({ xmlns: true });
  const stack: { name: string; text: string }[] = [];
  let namespace = '';
  let tracks = 0;
  let segments = 0;
  let point: {
    latitude: number;
    longitude: number;
    time: number | null;
  } | null = null;
  let title = '';
  const points: TrackPoint[] = [];
  parser.on('doctype', () => {
    throw new Error('GPX DTDs are not supported.');
  });
  parser.on('opentag', (tag) => {
    if (stack.length >= 32) throw new Error('GPX nesting is too deep.');
    if (!stack.length) {
      if (
        tag.local !== 'gpx' ||
        ![
          '',
          'http://www.topografix.com/GPX/1/0',
          'http://www.topografix.com/GPX/1/1',
        ].includes(tag.uri)
      )
        throw new Error('Expected GPX.');
      namespace = tag.uri;
    }
    stack.push({
      name: tag.uri === namespace ? tag.local : '#extension',
      text: '',
    });
    const path = stack.map((s) => s.name).join('/');
    if (path === 'gpx/trk') tracks++;
    if (path === 'gpx/trk/trkseg') segments++;
    if (path === 'gpx/trk/trkseg/trkpt') {
      const lat = tag.attributes.lat?.value;
      const lon = tag.attributes.lon?.value;
      const latitude = lat?.trim() ? Number(lat) : NaN;
      const longitude = lon?.trim() ? Number(lon) : NaN;
      if (!isValidLatLon([latitude, longitude]))
        throw new Error('Invalid GPX coordinates.');
      point = { latitude, longitude, time: null };
    }
  });
  const onText = (text: string) => {
    const top = stack.at(-1);
    if (top) top.text = (top.text + text).slice(0, 500);
  };
  parser.on('text', onText);
  parser.on('cdata', onText);
  parser.on('closetag', () => {
    const path = stack.map((s) => s.name).join('/');
    const text = stack.at(-1)?.text.trim() ?? '';
    if (path === 'gpx/trk/name') title = text;
    if (path === 'gpx/trk/trkseg/trkpt/time' && point)
      point.time = Date.parse(z.iso.datetime({ offset: true }).parse(text));
    if (path === 'gpx/trk/trkseg/trkpt' && point) {
      if (point.time === null)
        throw new Error('Every recorded track point needs a timestamp.');
      const previous = points.at(-1);
      const gap = previous
        ? haversineKm(
            [previous.latitude, previous.longitude],
            [point.latitude, point.longitude],
          ) * 1000
        : 0;
      if (gap > 1000)
        throw new Error(
          'A GPS gap exceeds 1 km; split or inspect this ride first.',
        );
      if (previous && point.time < previous.time)
        throw new Error('Track timestamps must be chronological.');
      points.push({
        ...point,
        time: point.time,
        distanceM: (previous?.distanceM ?? 0) + gap,
      });
      if (points.length > 100_000)
        throw new Error('Calibration track is limited to 100,000 points.');
      point = null;
    }
    stack.pop();
  });
  parser.write(xml).close();
  const first = points[0];
  const last = points.at(-1);
  if (tracks !== 1 || segments !== 1 || !first || !last || last.distanceM < 100)
    throw new Error(
      'Expected one recorded track and segment with at least 100 m.',
    );
  if (last.time - first.time > 2 * DAY || first.time === last.time)
    throw new Error(
      'Recorded ride duration must be positive and at most two days.',
    );
  return {
    title,
    points,
    start: first.time,
    end: last.time,
    distanceM: last.distanceM,
  };
};
export type CalibrationTrack = ReturnType<typeof parseCalibrationTrack>;

/** Select actual GPX fixes, retaining passage time and position, never interpolated weather. */
export const sampleTrack = (
  track: CalibrationTrack,
  fromM: number,
  toM: number,
  count: number,
) => {
  if (
    !Number.isFinite(fromM) ||
    !Number.isFinite(toM) ||
    fromM < 0 ||
    toM > track.distanceM ||
    toM <= fromM ||
    !Number.isInteger(count) ||
    count < 2 ||
    count > 12
  )
    throw new Error('Choose 2–12 samples inside the track distance range.');
  let index = 0;
  return Array.from({ length: count }, (_, i) => {
    const target = fromM + ((toM - fromM) * i) / (count - 1);
    while (
      index + 1 < track.points.length &&
      (track.points[index]?.distanceM ?? Infinity) < target
    )
      index++;
    const next = track.points[index];
    const previous = track.points[index - 1];
    if (!next) throw new Error('Missing sample.');
    return {
      ...(previous &&
      Math.abs(previous.distanceM - target) < Math.abs(next.distanceM - target)
        ? previous
        : next),
      sample: i + 1,
    };
  });
};
