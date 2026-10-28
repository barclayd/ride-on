// Writes src/data/routes.json: the intro's seven routes from web/design's fixtures, in WORDS order.
// Run with `bun run routes` after the fixtures change.

const NAMES = [
  'Windsor Great Park',
  'Thames to Walton',
  'Ripley café loop',
  'Richmond Park laps',
  'Box Hill via Leatherhead',
  'Leith Hill & the Surrey Hills',
  'Esher & Claygate lanes',
];

type Fixtures = {
  routes: { routes: { id: string; name: string; distanceM: number }[] };
  geometry: Record<string, { geometry: { encoding: string; data: string } }>;
};

// fixtures.js is a classic script that assigns window.RIDE_ON_FIXTURES, not a module.
const FIXTURES = '../../web/design/data/fixtures.js';
const g = globalThis as unknown as { window: { RIDE_ON_FIXTURES?: Fixtures } };
g.window = {};
await import(FIXTURES);
const fixtures = g.window.RIDE_ON_FIXTURES;
if (!fixtures) throw new Error('fixtures.js did not set RIDE_ON_FIXTURES');

function decodePolyline6(data: string): [number, number][] {
  const points: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  const next = () => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = data.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < data.length) {
    lat += next();
    lng += next();
    points.push([lng / 1e6, lat / 1e6]);
  }
  return points;
}

// Douglas–Peucker in degrees; the backdrop never zooms in far enough to see 0.0002° (~20 m).
function simplify(points: [number, number][], tolerance: number) {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop() as [number, number];
    const [ax, ay] = points[a] as [number, number];
    const [bx, by] = points[b] as [number, number];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    let max = 0;
    let at = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i] as [number, number];
      // Loops start and end on the same point, so fall back to distance from it.
      const d = len
        ? Math.abs(dy * px - dx * py + bx * ay - by * ax) / len
        : Math.hypot(px - ax, py - ay);
      if (d > max) {
        max = d;
        at = i;
      }
    }
    if (max > tolerance && at > 0) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

const routes = NAMES.map((name) => {
  const route = fixtures.routes.routes.find((r) => r.name === name);
  if (!route) throw new Error(`No fixture route named ${name}`);
  const geometry = fixtures.geometry[route.id]?.geometry;
  if (geometry?.encoding !== 'polyline6')
    throw new Error(`No polyline6 for ${name}`);
  const coordinates = simplify(decodePolyline6(geometry.data), 0.0002).map(
    ([lng, lat]) => [+lng.toFixed(5), +lat.toFixed(5)],
  );
  return { name, km: Math.round(route.distanceM / 1000), coordinates };
});

await Bun.write('src/data/routes.json', `${JSON.stringify(routes)}\n`);
console.log(
  routes
    .map((r) => `${r.name}: ${r.km} km, ${r.coordinates.length} points`)
    .join('\n'),
);

export {};
