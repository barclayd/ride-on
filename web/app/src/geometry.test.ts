import { expect, test } from 'bun:test';
import { decodePolyline6, libraryGeometry, mapLimit } from './geometry.ts';

// The encoder from worker/src/rides/geometry.ts, for round trips.
const encode = (points: [number, number][]) => {
  let [lat, lon, data] = [0, 0, ''];
  const put = (delta: number) => {
    let value = delta < 0 ? -delta * 2 - 1 : delta * 2;
    while (value >= 32) {
      data += String.fromCharCode((value % 32) + 95);
      value = Math.floor(value / 32);
    }
    data += String.fromCharCode(value + 63);
  };
  for (const [nextLon, nextLat] of points) {
    put(Math.round(nextLat * 1e6) - lat);
    put(Math.round(nextLon * 1e6) - lon);
    lat = Math.round(nextLat * 1e6);
    lon = Math.round(nextLon * 1e6);
  }
  return data;
};

const ids = [
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000003',
];
const richmond: [number, number][] = [
  [-0.2665, 51.4455],
  [-0.274512, 51.43901],
  [-0.25, 51.452311],
];

test('polyline6 decodes to [lon, lat]', () => {
  // Google's reference polyline, read at six decimal places rather than five.
  expect(decodePolyline6('_p~iF~ps|U_ulLnnqC_mqNvxq`@')).toEqual([
    [-12.02, 3.85],
    [-12.095, 4.07],
    [-12.6453, 4.3252],
  ]);
  expect(decodePolyline6(encode(richmond))).toEqual(richmond);
  expect(() => decodePolyline6('_p~iF~ps|U_')).toThrow();
});

test('mapLimit keeps order and never runs more than the limit at once', async () => {
  let running = 0;
  let peak = 0;
  const out = await mapLimit([5, 1, 4, 2, 3, 0, 6], 3, async (n) => {
    peak = Math.max(peak, ++running);
    await Bun.sleep(n);
    running--;
    return n * 10;
  });
  expect(out).toEqual([50, 10, 40, 20, 30, 0, 60]);
  expect(peak).toBe(3);
});

const from = new Request('https://app.ride-on.cc/api/library-geometry');
const stub = (answer: (id: string) => Response) =>
  ({
    fetch: async (request: Request) =>
      answer(new URL(request.url).pathname.split('/')[2] ?? ''),
  }) as unknown as Fetcher;

test('one FeatureCollection keyed routeId@version, without deleted or line-less routes', async () => {
  const api = stub((id) =>
    id === ids[0]
      ? Response.json({
          routeId: id,
          version: 3,
          geometry: { encoding: 'polyline6', data: encode(richmond) },
        })
      : id === ids[1]
        ? Response.json({ routeId: id, version: 1, geometry: null })
        : Response.json(
            { error: { code: 'ROUTE_NOT_FOUND' } },
            { status: 404 },
          ),
  );
  const response = await libraryGeometry(api, from, 'token', ids);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        id: `${ids[0]}@3`,
        properties: {},
        geometry: { type: 'LineString', coordinates: richmond },
      },
    ],
  });
});

test('an expired session is a 401, and bad requests never reach the API', async () => {
  const api = stub(() =>
    Response.json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 }),
  );
  expect((await libraryGeometry(api, from, 'token', ids)).status).toBe(401);
  expect((await libraryGeometry(api, from, null, ids)).status).toBe(401);
  const never = stub(() => {
    throw new Error('reached the API');
  });
  expect((await libraryGeometry(never, from, 't', ['../auth/me'])).status).toBe(
    400,
  );
  expect(
    (await libraryGeometry(never, from, 't', Array(101).fill(ids[0]))).status,
  ).toBe(400);
});
