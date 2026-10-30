import { callApi } from './session.ts';

/** A route's line as GeoJSON `[lon, lat]` pairs. */
export type Line = [number, number][];
/** SPEC §12.4: one feature per route, keyed `routeId@version`, which never changes for a version. */
export type LibraryGeometry = {
  type: 'FeatureCollection';
  features: {
    type: 'Feature';
    id: string;
    properties: Record<string, never>;
    geometry: { type: 'LineString'; coordinates: Line };
  }[];
};
type RouteGeometry = {
  routeId: string;
  version: number;
  geometry: { encoding: string; data: string } | null;
};

export const maxRoutes = 100;
// The binding has no rate limit on geometry, but a big library shouldn't open 100 requests at once.
const concurrency = 6;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const error = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message } }, { status });

/** The API's polyline6 (lat before lon, as `worker/src/rides/geometry.ts` encodes it) as GeoJSON. */
export const decodePolyline6 = (data: string): Line => {
  const line: Line = [];
  let offset = 0;
  let lat = 0;
  let lon = 0;
  const next = () => {
    let value = 0;
    let factor = 1;
    for (;;) {
      const byte = data.charCodeAt(offset++) - 63;
      if (!(byte >= 0 && byte <= 63)) throw new Error('Invalid polyline6');
      value += (byte % 32) * factor;
      if (byte < 32) return value % 2 ? -(value + 1) / 2 : value / 2;
      factor *= 32;
    }
  };
  while (offset < data.length) {
    lat += next();
    lon += next();
    line.push([lon / 1e6, lat / 1e6]);
  }
  return line;
};

/** Runs `task` over `items`, at most `limit` at once, keeping their order. */
export const mapLimit = async <T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<R>,
) => {
  const results: R[] = [];
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index] as T);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
};

/**
 * `GET /api/library-geometry?ids=…`: the BFF fans out to `GET /routes/:id/geometry` and answers with
 * one FeatureCollection. Deleted routes and routes without geometry are left out; any other failure
 * is too, so the client asks again next time rather than caching a gap.
 */
export const libraryGeometry = async (
  api: Fetcher,
  request: Request,
  token: string | null,
  ids: readonly string[],
) => {
  if (!token) return error(401, 'UNAUTHORIZED', 'A valid session is required.');
  if (ids.length > maxRoutes)
    return error(
      400,
      'TOO_MANY_ROUTES',
      `Ask for at most ${maxRoutes} routes.`,
    );
  if (!ids.every((id) => uuid.test(id)))
    return error(400, 'INVALID_ROUTE_ID', 'Route ids are UUIDs.');
  const responses = await mapLimit(ids, concurrency, (id) =>
    callApi(api, request, `/routes/${id}/geometry`, token),
  );
  const expired = responses.find((r) => r.status === 401);
  if (expired) return expired;
  const body: LibraryGeometry = { type: 'FeatureCollection', features: [] };
  for (const response of responses) {
    if (!response.ok) continue;
    const { routeId, version, geometry } =
      (await response.json()) as RouteGeometry;
    if (geometry?.encoding !== 'polyline6') continue;
    body.features.push({
      type: 'Feature',
      id: `${routeId}@${version}`,
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates: decodePolyline6(geometry.data),
      },
    });
  }
  const headers = new Headers({ 'Cache-Control': 'no-store' });
  // A refreshed session from any of the calls becomes the cookie (callApi already turned it into one).
  const cookie = responses
    .map((r) => r.headers.get('Set-Cookie'))
    .find(Boolean);
  if (cookie) headers.set('Set-Cookie', cookie);
  return Response.json(body, { headers });
};
