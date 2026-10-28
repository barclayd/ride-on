// The intro's camera. scripts/poster.ts uses it too, so the poster lines up with the live map.
import routes from '../data/routes.json';
import { clamp } from './math';

// Web Mercator in world units (0–1): at zoom z the world is 512·2^z px across, as in MapLibre.
export const TILE = 512;
export const MIN_ZOOM = 8;
export const MAX_ZOOM = 13.5;

// The map overhangs the stage by 40px on every side, so the drift never shows an edge.
export const OVERHANG = 80;

export const project = ([lng, lat]: [number, number]): [number, number] => {
  const sin = Math.sin((lat * Math.PI) / 180);
  return [
    (lng + 180) / 360,
    0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI),
  ];
};

export const toLngLat = (x: number, y: number): [number, number] => [
  x * 360 - 180,
  (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI,
];

export type Route = {
  id: string;
  points: [number, number][];
  cx: number;
  cy: number;
  w: number;
  h: number;
};

export const ROUTES: Route[] = routes.map((route) => {
  const points = (route.coordinates as [number, number][]).map(project);
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const [minX, maxX, minY, maxY] = [
    Math.min(...xs),
    Math.max(...xs),
    Math.min(...ys),
    Math.max(...ys),
  ];
  return {
    id: route.name,
    points,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    w: maxX - minX,
    h: maxY - minY,
  };
});

export const route = (i: number) =>
  ROUTES[clamp(i, 0, ROUTES.length - 1)] as Route;

/** Fits a route's bounds into half the stage. */
export const zoomFor = (r: Route, width: number, height: number) =>
  clamp(
    Math.log2(Math.min((width * 0.5) / r.w, (height * 0.5) / r.h) / TILE),
    MIN_ZOOM,
    MAX_ZOOM,
  );

// How far each hop pulls back. MapLibre's flyTo uses 1.42; the rides are close together, so pull
// back further to show where the next one is.
const RHO = 2.4;

/**
 * Where the camera is at `pos`: over route k at whole numbers, and in between on van Wijk and
 * Nuij's smooth zoom (as MapLibre's flyTo), out to travel and back in to land.
 */
export const camera = (pos: number, width: number, height: number) => {
  const k = Math.floor(pos);
  const f = pos - k;
  const [a, b] = [route(k), route(k + 1)];
  const za = zoomFor(a, width, height);
  const u1 = Math.hypot(b.cx - a.cx, b.cy - a.cy);
  if (!f || !u1) return { x: a.cx, y: a.cy, zoom: za };

  const size = Math.max(width, height);
  const w0 = size / (TILE * 2 ** za);
  const w1 = size / (TILE * 2 ** zoomFor(b, width, height));
  const rho2 = RHO * RHO;
  const r = (i: 0 | 1) => {
    const q =
      (w1 * w1 - w0 * w0 + (i ? -1 : 1) * rho2 * rho2 * u1 * u1) /
      (2 * (i ? w1 : w0) * rho2 * u1);
    return Math.log(Math.sqrt(q * q + 1) - q);
  };
  const r0 = r(0);
  const s = (f * (r(1) - r0)) / RHO;
  const w = (w0 * Math.cosh(r0)) / Math.cosh(RHO * s + r0);
  const u =
    (w0 * (Math.cosh(r0) * Math.tanh(RHO * s + r0) - Math.sinh(r0))) /
    rho2 /
    u1;
  return {
    x: a.cx + (b.cx - a.cx) * u,
    y: a.cy + (b.cy - a.cy) * u,
    zoom: za + Math.log2(w0 / w),
  };
};
