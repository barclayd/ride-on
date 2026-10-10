// cycle.travel reads. Runs in the content script, same-origin with the rider's cookies.
import type { JourneyGpx } from './state';

// Google polyline varints, as cycle.travel's L.PolylineUtil.decodeDeltas.
export const decodeDeltas = (
  encoded: string,
  dimension: number,
  factor: number,
) => {
  const out: number[] = [];
  const last = new Array<number>(dimension).fill(0);
  let current = 0;
  let shift = 0;
  for (let i = 0; i < encoded.length; i++) {
    const b = encoded.charCodeAt(i) - 63;
    current |= (b & 0x1f) << shift;
    if (b >= 0x20) {
      shift += 5;
      continue;
    }
    const d = out.length % dimension;
    last[d] += current & 1 ? ~(current >> 1) : current >> 1;
    out.push(last[d] / factor);
    current = 0;
    shift = 0;
  }
  return out;
};

export const decodePolyline = (encoded: string, precision: number) => {
  const flat = decodeDeltas(encoded, 2, 10 ** precision);
  const points: [number, number][] = [];
  for (let i = 0; i + 1 < flat.length; i += 2)
    points.push([flat[i], flat[i + 1]]);
  return points;
};

export const encodePolyline = (points: [number, number][], precision = 6) => {
  const factor = 10 ** precision;
  let out = '';
  const last = [0, 0];
  for (const point of points)
    for (const d of [0, 1]) {
      const value = Math.round(point[d] * factor);
      let v = value - last[d];
      last[d] = value;
      v = v < 0 ? ~(v << 1) : v << 1;
      while (v >= 0x20) {
        out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
        v >>= 5;
      }
      out += String.fromCharCode(v + 63);
    }
  return out;
};

// One elevation per point. Mode 1 returns one per point (plus a trailing extra);
// mode 2 returns samples at `indices`, so interpolate linearly between them.
export const elevationPerPoint = (
  pointCount: number,
  elevation: number[],
  indices: number[] | null,
) => {
  if (!indices) return elevation.slice(0, pointCount);
  const out = new Array<number>(pointCount);
  for (let k = 0; k < indices.length; k++) {
    const from = indices[k];
    const to = indices[k + 1] ?? pointCount;
    const next = elevation[k + 1] ?? elevation[k];
    for (let i = from; i < to && i < pointCount; i++)
      out[i] =
        elevation[k] + ((next - elevation[k]) * (i - from)) / (to - from);
  }
  return out;
};

const escapeXml = (text: string) =>
  text.replace(
    /[<>&"']/g,
    (c) =>
      ({
        '<': '&lt;',
        '>': '&gt;',
        '&': '&amp;',
        '"': '&quot;',
        "'": '&apos;',
      })[c] as string,
  );

export const buildGpx = (
  name: string,
  points: [number, number][],
  elevations: number[],
) =>
  `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Ride On" xmlns="http://www.topografix.com/GPX/1/1">
<trk><name>${escapeXml(name)}</name><trkseg>
${points
  .map(
    ([lat, lon], i) =>
      `<trkpt lat="${lat}" lon="${lon}">${Number.isFinite(elevations[i]) ? `<ele>${Math.round(elevations[i] * 10) / 10}</ele>` : ''}</trkpt>`,
  )
  .join('\n')}
</trkseg></trk>
</gpx>
`;

export type Journey = {
  name: string;
  polyline: string;
  distance: number;
  legacy: boolean;
  updated_at: number;
  full_osrm_url: string;
};

const json = async <T>(response: Response): Promise<T> => {
  if (!response.ok)
    throw new Error(`cycle.travel returned ${response.status}.`);
  return response.json();
};

export const fetchJourney = async (externalId: string) =>
  json<Journey>(await fetch(`/map/journey/${externalId}/data/with_pois`));

export const fetchJourneyGpx = async (
  externalId: string,
  journey?: Journey,
): Promise<JourneyGpx> => {
  journey ??= await fetchJourney(externalId);
  const points = decodePolyline(journey.polyline, journey.legacy ? 5 : 6);
  const form = new URLSearchParams({
    elevation_mode: journey.distance < 500_000 ? '1' : '2',
    locs: journey.legacy ? encodePolyline(points) : journey.polyline,
  });
  // The routing host serves the journey's region, so its origin is also the elevation host.
  const result = await json<{ elevation: string; elevation_indices?: string }>(
    await fetch(`${new URL(journey.full_osrm_url).origin}/elevation`, {
      method: 'POST',
      body: form,
    }),
  );
  const elevations = elevationPerPoint(
    points.length,
    decodeDeltas(result.elevation, 1, 1),
    result.elevation_indices
      ? decodeDeltas(result.elevation_indices, 1, 1)
      : null,
  );
  const name = journey.name.trim().slice(0, 160) || `Journey ${externalId}`;
  return {
    externalId,
    name,
    gpx: buildGpx(name, points, elevations),
    updatedAt: journey.updated_at,
  };
};

export type JourneyListItem = {
  id: number;
  name: string;
  distance: number;
  date: string;
};

export const fetchJourneyList = async () =>
  (await json<{ journeys: JourneyListItem[] }>(await fetch('/map/journeys')))
    .journeys;
