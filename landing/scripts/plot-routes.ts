// Writes src/data/routes.json: the intro's seven loops, in WORDS order, routed on real roads by the
// openstreetmap.de OSRM bike profile. Each starts somewhere different and none share roads, so every
// phrase reads as its own ride. Run with `bun run routes` after changing a waypoint.

type LngLat = [number, number];

const ROUTES: { name: string; via: LngLat[] }[] = [
  {
    name: 'Richmond Park laps',
    via: [
      [-0.2555, 51.4551], // Roehampton Gate
      [-0.28, 51.452],
      [-0.294, 51.4495], // Richmond Gate
      [-0.296, 51.4425], // Pembroke Lodge
      [-0.288, 51.433],
      [-0.283, 51.422], // Kingston Gate
      [-0.268, 51.429],
      [-0.2495, 51.4395], // Robin Hood Gate
    ],
  },
  {
    name: 'Esher & Claygate lanes',
    via: [
      [-0.306, 51.4095], // Kingston
      [-0.342, 51.403], // Hampton Court
      [-0.365, 51.3695], // Esher
      [-0.339, 51.36], // Claygate
      [-0.333, 51.333], // Oxshott
      [-0.315, 51.345], // Fairoak Lane
      [-0.304, 51.37], // Hook
      [-0.298, 51.392], // Surbiton
    ],
  },
  {
    name: 'Thames to Chertsey',
    via: [
      [-0.418, 51.386], // Walton-on-Thames
      [-0.451, 51.392], // Shepperton
      [-0.489, 51.408], // Laleham
      [-0.4835, 51.3893], // Chertsey Bridge
      [-0.49, 51.372], // Addlestone
      [-0.459, 51.372], // Weybridge
    ],
  },
  {
    name: 'Windsor Great Park',
    via: [
      [-0.58, 51.462], // Old Windsor
      [-0.606, 51.481], // Windsor
      [-0.676, 51.41], // Ascot
      [-0.571, 51.402], // Virginia Water
      [-0.548, 51.431], // Egham
    ],
  },
  {
    name: 'Ripley & the Horsleys',
    via: [
      [-0.488, 51.299], // Ripley
      [-0.451, 51.293], // Ockham
      [-0.433, 51.275], // East Horsley
      [-0.456, 51.262], // West Horsley
      [-0.5, 51.258], // West Clandon
      [-0.53, 51.285], // Send
    ],
  },
  {
    name: 'Leith Hill from Shere',
    via: [
      [-0.464, 51.22], // Shere
      [-0.439, 51.188], // Peaslake
      [-0.411, 51.183], // Holmbury St Mary
      [-0.38, 51.177], // Leith Hill
      [-0.393, 51.205], // Friday Street
      [-0.422, 51.212], // Abinger Hammer
      [-0.442, 51.219], // Gomshall
    ],
  },
  {
    name: 'Box Hill & Brockham',
    via: [
      [-0.3215, 51.255], // Burford Bridge
      [-0.311, 51.2505], // Zig Zag Road
      [-0.295, 51.26], // Box Hill village
      [-0.262, 51.254], // Pebble Hill
      [-0.269, 51.238], // Betchworth
      [-0.299, 51.2365], // Brockham
      [-0.315, 51.242], // Pixham
    ],
  },
];

const OSRM = 'https://routing.openstreetmap.de/routed-bike/route/v1/driving';

async function plot(via: LngLat[]) {
  const loop = [...via, via[0] as LngLat];
  const url = `${OSRM}/${loop.map((p) => p.join(',')).join(';')}?overview=full&geometries=geojson&steps=false&continue_straight=false`;
  const response = await fetch(url, {
    headers: { 'User-Agent': 'ride-on landing (https://ride-on.cc)' },
  });
  const body = (await response.json()) as {
    code: string;
    routes?: { distance: number; geometry: { coordinates: LngLat[] } }[];
  };
  const route = body.routes?.[0];
  if (body.code !== 'Ok' || !route) throw new Error(`OSRM: ${body.code}`);
  return route;
}

const metres = ([ax, ay]: LngLat, [bx, by]: LngLat) =>
  Math.hypot((bx - ax) * Math.cos((ay * Math.PI) / 180), by - ay) * 111_320;

// A waypoint just off the road makes OSRM ride out to it and back: both legs share nodes, so
// whenever the path returns to a point it left less than 3 km ago, drop what's in between.
function trimSpurs(points: LngLat[]) {
  const out: LngLat[] = [];
  for (const p of points) {
    let travelled = 0;
    let hit = -1;
    for (let k = out.length - 2; k >= 0 && travelled < 3000; k--) {
      travelled += metres(out[k] as LngLat, out[k + 1] as LngLat);
      if (metres(out[k] as LngLat, p) < 12) {
        hit = k;
        break;
      }
    }
    if (hit >= 0) out.length = hit + 1;
    else if (!out.length || metres(out.at(-1) as LngLat, p) > 1) out.push(p);
  }
  return out;
}

// Loops start and end at the same point, so trim again from the far side to catch a spur there,
// then rotate back to the original start.
function trimLoop(points: LngLat[]) {
  const open = trimSpurs(points).slice(0, -1);
  const half = Math.floor(open.length / 2);
  const turned = [...open.slice(half), ...open.slice(0, half)];
  const trimmed = trimSpurs([...turned, turned[0] as LngLat]).slice(0, -1);
  const start = open[0] as LngLat;
  let at = 0;
  trimmed.forEach((p, i) => {
    if (metres(p, start) < metres(trimmed[at] as LngLat, start)) at = i;
  });
  const loop = [...trimmed.slice(at), ...trimmed.slice(0, at)];
  return [...loop, loop[0] as LngLat];
}

// Douglas–Peucker in degrees; the backdrop never zooms in far enough to see 0.0001° (~10 m).
function simplify(points: LngLat[], tolerance: number) {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop() as [number, number];
    const [ax, ay] = points[a] as LngLat;
    const [bx, by] = points[b] as LngLat;
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    let max = 0;
    let at = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i] as LngLat;
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

// The public server is rate limited, so one request at a time.
const routes = [];
for (const { name, via } of ROUTES) {
  const path = trimLoop((await plot(via)).geometry.coordinates);
  const km = path.reduce(
    (sum, p, i) => (i ? sum + metres(path[i - 1] as LngLat, p) : 0),
    0,
  );
  const coordinates = simplify(path, 0.0001).map(([lng, lat]) => [
    +lng.toFixed(5),
    +lat.toFixed(5),
  ]);
  routes.push({ name, km: Math.round(km / 1000), coordinates });
  await Bun.sleep(1000);
}

await Bun.write('src/data/routes.json', `${JSON.stringify(routes)}\n`);
console.log(
  routes
    .map((r) => `${r.name}: ${r.km} km, ${r.coordinates.length} points`)
    .join('\n'),
);
