// "Temperature along the ride": the temperature chip's panel (handoff v7, 24a). Pure, like format.ts.
// Air and feels like over the ride against the rider's ideal range, on a fixed 0–25°C scale so
// tiles compare, with the month's usual temperature behind them (docs/extension-api-brief-v9.md).
import type { Departure, Preferences, TemperaturePoint } from '../lib/types';
import { clock, degrees, METRIC, type Units } from './format';

const SCALE_C = 25; // ponytail: values outside 0–25°C clamp to the edge until there's a rule for widening it
const SHORT_MIN = 10; // crossings shorter than this are ignored
type Zone = 'cool' | 'in' | 'warm';
type Run = { zone: Zone; start: number; end: number; min: number; max: number };
type Point = { m: number; c: number };

// Chart positions, as percentages of the plot.
export type TemperatureEnd = {
  x: number;
  y: number;
  label: string;
  above: boolean;
  end: boolean;
};
export type TemperaturePanel = {
  warn: boolean; // feels outside the range for over half the ride: the amber chip
  label: string; // the chip's aria-label
  headline: string; // when it feels outside the range
  tone: 'warm' | 'cool' | 'even'; // feels outside the range the whole ride, or not
  usual: {
    sub: string;
    month: string;
    band: string; // SVG path
  } | null;
  air: string; // SVG paths in a 100×100 box
  feels: string | null;
  high: { y: number; label: string };
  low: { y: number; label: string };
  ends: TemperatureEnd[];
  mark: { x: number; y: number; label: string; cool: boolean } | null;
  from: string;
  to: string;
  range: string;
};

const y = (c: number) =>
  +(100 - (Math.max(0, Math.min(SCALE_C, c)) / SCALE_C) * 100).toFixed(2);
const series = (points: TemperaturePoint[], i: 1 | 2 | 3): Point[] =>
  points.flatMap((p) => (p[i] === null ? [] : [{ m: p[0], c: p[i] }]));
// Linear between points, held flat beyond the ends.
const at = (s: Point[], m: number) => {
  const next = s.findIndex((p) => p.m >= m);
  if (next < 0) return s[s.length - 1].c;
  if (next === 0) return s[0].c;
  const [a, b] = [s[next - 1], s[next]];
  return a.c + ((b.c - a.c) * (m - a.m)) / (b.m - a.m);
};
// A line that breaks where the API has no value.
const path = (points: TemperaturePoint[], i: 1 | 2, x: (m: number) => number) =>
  points
    .map((p, k) =>
      p[i] === null
        ? ''
        : `${k && points[k - 1][i] !== null ? 'L' : 'M'}${x(p[0])} ${y(p[i])}`,
    )
    .filter(Boolean)
    .join(' ');

// Minute by minute against the range, then short crossings folded into what came before.
const runsOf = (s: Point[], minutes: number, lo: number, hi: number) => {
  const zone = (c: number): Zone => (c < lo ? 'cool' : c > hi ? 'warm' : 'in');
  const raw: Run[] = [];
  for (let m = 0; m < minutes; m++) {
    const c = at(s, m);
    const z = zone(c);
    const last = raw.at(-1);
    if (last?.zone === z) {
      last.end = m + 1;
      last.min = Math.min(last.min, c);
      last.max = Math.max(last.max, c);
    } else raw.push({ zone: z, start: m, end: m + 1, min: c, max: c });
  }
  const runs: Run[] = [];
  for (const r of raw) {
    const last = runs.at(-1);
    const short = r.end - r.start < SHORT_MIN;
    if (last && (short || last.zone === r.zone)) {
      last.end = r.end;
      if (last.zone === r.zone) {
        last.min = Math.min(last.min, r.min);
        last.max = Math.max(last.max, r.max);
      }
    } else if (!last && short && raw.length > 1)
      // A short start takes the zone of what follows, without its extremes.
      runs.push({ ...r, zone: raw[1].zone, min: Infinity, max: -Infinity });
    else runs.push({ ...r });
  }
  // Folding can leave neighbours in the same zone.
  return runs.reduce<Run[]>((a, r) => {
    const last = a.at(-1);
    if (last?.zone === r.zone) {
      last.end = r.end;
      last.min = Math.min(last.min, r.min);
      last.max = Math.max(last.max, r.max);
    } else a.push(r);
    return a;
  }, []);
};

const monthName = (month: number) =>
  new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: 'UTC' }).format(
    Date.UTC(2000, month - 1, 1),
  );

// Null before the API sends the trace, or without an ideal range: the tile keeps the plain chip.
export const temperaturePanel = (
  b: Departure,
  timeZone: string,
  u: Units = METRIC,
  prefs: Partial<Preferences> = {},
): TemperaturePanel | null => {
  const along = b.temperatureAlongRide;
  const comfort = prefs.temperature;
  if (!along || !comfort) return null;
  const { points, usual } = along;
  const air = series(points, 1);
  const minutes = points.at(-1)?.[0] ?? 0;
  if (air.length < 2 || minutes <= 0) return null;
  const feels = series(points, 2);
  // Judged on feels like; on air only when the provider has no feels like at all.
  const judged = feels.length ? feels : air;
  const lo = comfort.comfortMinC;
  const hi = comfort.comfortMaxC;
  const runs = runsOf(judged, minutes, lo, hi);
  const t = (c: number) => `${degrees(c, u)}${u.temperature}`;
  const span = (cs: number[]) => {
    const [a, z] = [degrees(Math.min(...cs), u), degrees(Math.max(...cs), u)];
    return `${a === z ? z : `${a}–${z}`}${u.temperature}`;
  };
  const x = (m: number) => +((m / minutes) * 100).toFixed(2);
  const departure = Date.parse(b.departureAt);
  // Crossings to the nearest 10 minutes of the clock.
  const time = (m: number) =>
    clock(
      new Date(Math.round((departure + m * 60_000) / 600_000) * 600_000),
      timeZone,
    );
  const phrase = (r: Run) =>
    r.zone === 'in'
      ? 'in your range'
      : r.zone === 'cool'
        ? `cooler than your range (down to ${t(r.min)})`
        : `warmer than your range (up to ${t(r.max)})`;
  const headline =
    runs.length === 1
      ? runs[0].zone === 'in'
        ? 'Feels in your range the whole ride'
        : `Feels ${runs[0].zone === 'cool' ? 'cooler' : 'warmer'} than your range the whole ride, ${span(judged.map((p) => p.c))}`
      : `Feels ${runs
          .map(
            (r, i) =>
              `${phrase(r)}${i < runs.length - 1 ? ` until about ${time(r.end)}` : ' to the finish'}`,
          )
          .join(', then ')}`;
  const inRange = runs
    .filter((r) => r.zone === 'in')
    .reduce((sum, r) => sum + r.end - r.start, 0);
  // The coldest feels like when the ride feels cooler at all, else the warmest.
  const cool = runs.some((r) => r.zone === 'cool');
  const extreme =
    feels.length && (cool || runs.some((r) => r.zone === 'warm'))
      ? feels.reduce((a, p) => ((cool ? p.c < a.c : p.c > a.c) ? p : a))
      : null;
  const ends = [air[0], air[air.length - 1]].map((p, i) => {
    const f = feels.length ? at(feels, p.m) : null;
    return {
      x: x(p.m),
      y: y(p.c),
      label: `${degrees(p.c, u)}°`,
      above: f === null || f < p.c,
      end: i === 1,
    };
  });
  const usualPoints = series(points, 3);
  const month = usual && monthName(usual.month);
  let usualPanel: TemperaturePanel['usual'] = null;
  if (usual && month && usualPoints.length) {
    const band = usual.bandHalfWidthC;
    usualPanel = {
      sub: `Usual for ${clock(b.departureAt, timeZone)}–${clock(b.finishAt, timeZone)} in ${month}: ${span(
        usualPoints.flatMap((p) => [p.c - band, p.c + band]),
      )}`,
      month,
      band: `${usualPoints
        .map((p, i) => `${i ? 'L' : 'M'}${x(p.m)} ${y(p.c + band)}`)
        .join(' ')} ${usualPoints
        .toReversed()
        .map((p) => `L${x(p.m)} ${y(p.c - band)}`)
        .join(' ')} Z`,
    };
  }
  return {
    warn: inRange / minutes < 0.5,
    label: `Temperature ${span(air.map((p) => p.c))}${
      feels.length ? `, feels like ${span(feels.map((p) => p.c))}` : ''
    }. Show temperature along the ride`,
    headline,
    tone: runs.length === 1 && runs[0].zone !== 'in' ? runs[0].zone : 'even',
    usual: usualPanel,
    air: path(points, 1, x),
    feels: feels.length ? path(points, 2, x) : null,
    high: { y: y(hi), label: `${degrees(hi, u)}°` },
    low: { y: y(lo), label: `${degrees(lo, u)}°` },
    ends,
    mark: extreme && {
      x: x(extreme.m),
      y: y(extreme.c),
      label: `feels ${degrees(extreme.c, u)}°`,
      cool,
    },
    from: clock(b.departureAt, timeZone),
    to: `~${clock(b.finishAt, timeZone)}`,
    range: `Your range ${degrees(lo, u)}–${degrees(hi, u)}${u.temperature}`,
  };
};
