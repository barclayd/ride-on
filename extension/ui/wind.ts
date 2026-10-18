// "Wind along the ride": the wind pill's dropdown (design canvas boards 2–7). Pure, like format.ts.
// The bar, legend and gusts row come from ride hours; the API's wind stretches, when present, place
// each effect exactly and add the route sketch (docs/extension-api-brief-v7.md).
import type {
  Conditions,
  Departure,
  Outline,
  Preferences,
  WindEffect,
  WindStretch,
} from '../lib/types';
import {
  approx,
  clock,
  METRIC,
  NAMED_WIND_KPH,
  speed,
  type Units,
} from './format';

const EFFECTS = ['tailwind', 'crosswind', 'headwind'] as const;
const NAMES: Record<WindEffect, string> = {
  tailwind: 'Tailwind',
  crosswind: 'Crosswind',
  headwind: 'Headwind',
  light: 'Light wind',
};
const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const HEADINGS = [
  'north',
  'north-east',
  'east',
  'south-east',
  'south',
  'south-west',
  'west',
  'north-west',
];
const sector = (degrees: number) =>
  Math.round((((degrees % 360) + 360) % 360) / 45) % 8;
export const compass = (degrees: number) => POINTS[sector(degrees)];

// A part of the ride in ride order: a wind stretch, or a ride hour when the API sends none.
type Span = {
  from: number; // share of the distance before it
  share: number;
  effect: WindEffect;
  degrees: number | null;
  kph: number;
  adverse: number | null; // the largest gust against the rider
  start: string;
  end: string;
  // How much of it each effect covers: an hour can mix them, a stretch can't.
  parts: Partial<Record<WindEffect, number>>;
};

// The main effect of a summary: light under 10 km/h, else the largest share of the distance.
const effectOf = (c: Conditions): WindEffect => {
  if (c.averageWindSpeedKph < NAMED_WIND_KPH) return 'light';
  const f = c.windDistanceFractions;
  if (f) return EFFECTS.reduce((a, b) => (f[b] > f[a] ? b : a));
  const kph = {
    tailwind: c.averageTailwindKph,
    crosswind: c.averageCrosswindKph,
    headwind: c.averageHeadwindKph,
  };
  return EFFECTS.reduce((a, b) => (kph[b] > kph[a] ? b : a));
};
const partsOf = (c: Conditions): Span['parts'] => {
  const f = c.windDistanceFractions;
  return c.averageWindSpeedKph < NAMED_WIND_KPH
    ? { light: 1 }
    : f
      ? { ...f }
      : { [effectOf(c)]: 1 };
};
const fromSummary = (
  c: Conditions,
  start: string,
  end: string,
  from: number,
  share: number,
): Span => ({
  from,
  share,
  effect: effectOf(c),
  degrees: c.windFromDegrees ?? null,
  kph: c.averageWindSpeedKph,
  adverse: c.gustExposure?.maximumAdverseKph ?? null,
  start,
  end,
  parts: partsOf(c),
});

const spansOf = (b: Departure): Span[] => {
  const stretches = b.windStretches ?? [];
  const metres = stretches.at(-1)?.toM ?? 0;
  if (metres > 0)
    return stretches.map((s) => ({
      from: s.fromM / metres,
      share: (s.toM - s.fromM) / metres,
      effect: s.effect,
      degrees: s.windFromDegrees,
      kph: s.averageWindSpeedKph,
      adverse: s.maximumAdverseGustKph,
      start: s.startAt,
      end: s.endAt,
      parts: { [s.effect]: 1 },
    }));
  const hours = (b.rideHours ?? []).flatMap((h) =>
    h.conditions?.distanceKm ? [{ ...h, conditions: h.conditions }] : [],
  );
  const km = hours.reduce((sum, h) => sum + (h.conditions.distanceKm ?? 0), 0);
  if (!km) return [fromSummary(b.conditions, b.departureAt, b.finishAt, 0, 1)];
  let from = 0;
  return hours.map((h) => {
    const share = (h.conditions.distanceKm ?? 0) / km;
    const span = fromSummary(h.conditions, h.start, h.end, from, share);
    from += share;
    return span;
  });
};

// ponytail: a compass letter needs about a tenth of the bar to fit.
const LABELLED = 0.1;
export type WindBlock = { effect: WindEffect; share: number; label: string };
export type WindLegend = {
  effect: WindEffect;
  name: string;
  speed: string;
  share: string;
};
export type WindGusts = { warn: boolean; title: string; text: string };
export type WindPanel = {
  blocks: WindBlock[];
  legend: WindLegend[];
  gusts: WindGusts | null;
  sketch: WindSketch | null;
};

const PHRASES: Record<WindEffect, string> = {
  headwind: 'Into your face',
  crosswind: 'From the side',
  tailwind: 'From behind',
  light: 'In light wind',
};

const gustsRow = (
  c: Conditions,
  spans: Span[],
  tailShare: number,
  roundTrip: boolean | null,
  u: Units,
  prefs: Partial<Preferences>,
  timeZone: string,
): WindGusts | null => {
  const peak = c.maximumGustKph;
  if (peak === undefined) return null;
  const comfort = prefs.wind?.comfortableGustKph ?? 35;
  const limit = prefs.minimumStandards?.maximumGustKph;
  const adverse = c.gustExposure?.maximumAdverseKph;
  const overLimit = limit !== undefined && peak > limit;
  const overComfort = (adverse ?? peak) > comfort;
  const title = `Gusts up to ${speed(peak, u)}`;
  if (!overLimit && !overComfort)
    return {
      warn: false,
      title,
      text: `${tailShare > 0.5 ? 'Mostly behind you, so they help. ' : ''}${
        adverse === undefined
          ? `Within your ${speed(comfort, u)} comfort.`
          : adverse < 1
            ? 'None against you.'
            : `At most ${speed(adverse, u)} against you.`
      }`,
    };
  // Name the stretch when the gusts past comfort fall in one place: calmer gaps under 5% of
  // the ride (the API keeps short stretches) don't split it.
  const over = spans.filter((s) => s.adverse !== null && s.adverse > comfort);
  const together = over.every(
    (s, i) =>
      i === 0 || s.from - (over[i - 1].from + over[i - 1].share) < SHORT,
  );
  let where = '';
  if (overComfort && over.length && together) {
    const run = over;
    const end = run[run.length - 1];
    const worst = run.reduce((a, b) =>
      (b.adverse ?? 0) > (a.adverse ?? 0) ? b : a,
    );
    const from = run[0].from;
    const to = end.from + end.share;
    const part =
      from >= 0.5
        ? roundTrip
          ? ' on the way back'
          : ' late in the ride'
        : to <= 0.5
          ? roundTrip
            ? ' on the way out'
            : ' early in the ride'
          : '';
    where = `${PHRASES[worst.effect]}${part}, ${clock(run[0].start, timeZone)}–${clock(end.end, timeZone)}. `;
  } else if (adverse !== undefined && adverse >= 1)
    where = `Up to ${speed(adverse, u)} against you. `;
  return {
    warn: true,
    title,
    text: `${where}${
      overLimit
        ? `Over your ${speed(limit, u)} limit.`
        : `Over your ${speed(comfort, u)} comfort.`
    }`,
  };
};

export const windPanel = (
  b: Departure,
  outline: Outline | null,
  timeZone: string,
  u: Units = METRIC,
  prefs: Partial<Preferences> = {},
): WindPanel => {
  const spans = spansOf(b);
  // Bar: ride order, neighbours with the same effect and compass point merged; calm merges whatever its direction.
  const blocks: (WindBlock & { point: string | null })[] = [];
  for (const s of spans) {
    const point =
      s.effect === 'light' || s.degrees === null ? null : compass(s.degrees);
    const last = blocks.at(-1);
    if (last?.effect === s.effect && last.point === point)
      last.share += s.share;
    else blocks.push({ effect: s.effect, share: s.share, point, label: '' });
  }
  for (const block of blocks)
    block.label = block.point && block.share >= LABELLED ? block.point : '';
  // Legend: each effect's share of the distance and the average wind where it blows.
  const totals = new Map<WindEffect, { share: number; kph: number }>();
  for (const s of spans)
    for (const [effect, part] of Object.entries(s.parts) as [
      WindEffect,
      number,
    ][]) {
      if (!part) continue;
      const t = totals.get(effect) ?? { share: 0, kph: 0 };
      t.share += part * s.share;
      t.kph += part * s.share * s.kph;
      totals.set(effect, t);
    }
  const present = [...totals].sort((a, b) => b[1].share - a[1].share);
  const legend = present.map(([effect, t]) => ({
    effect,
    name: NAMES[effect],
    // Light wind needs no speed, and one effect needs no share: the bar shows it all the way.
    speed: effect === 'light' ? '' : speed(t.kph / t.share, u),
    share: present.length === 1 ? '' : approx(t.share),
  }));
  const sketch =
    outline && b.windStretches?.length
      ? windSketch(outline, b.windStretches, b, u)
      : null;
  return {
    blocks: blocks.map(({ point: _, ...block }) => block),
    legend,
    gusts: gustsRow(
      b.conditions,
      spans,
      totals.get('tailwind')?.share ?? 0,
      outline ? roundTripOf(outline) : null,
      u,
      prefs,
      timeZone,
    ),
    sketch,
  };
};

// ---- Route sketch (boards 7 and 13): a north-up wind ribbon and a compass key, no basemap. ----

const EARTH_M = 6_371_000;
const metresBetween = (a: [number, number], b: [number, number]) => {
  const rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad;
  const dLon = (b[1] - a[1]) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.sqrt(h));
};
// Back where it started: a loop or an out-and-back, so no finish dot.
const roundTripOf = (o: Outline) => {
  const first = o.points[0];
  const last = o.points.at(-1);
  if (!first || !last) return false;
  return (
    metresBetween([first[0], first[1]], [last[0], last[1]]) <=
    Math.max(1000, 0.05 * last[2])
  );
};
const bearing = (a: [number, number], b: [number, number]) => {
  const rad = Math.PI / 180;
  const y = Math.sin((b[1] - a[1]) * rad) * Math.cos(b[0] * rad);
  const x =
    Math.cos(a[0] * rad) * Math.sin(b[0] * rad) -
    Math.sin(a[0] * rad) * Math.cos(b[0] * rad) * Math.cos((b[1] - a[1]) * rad);
  return Math.atan2(y, x) / rad;
};

export const SKETCH = { width: 236, height: 96 };
// The outline fits right of the wind key: a compass and the words under it.
const BOX = { left: 72, right: 220, top: 10, bottom: 86 };
export const DIAL = { x: 32, y: 24, r: 19 };
const TRACK = 200; // the hover pointer's steps along the route
const KEY: Box = { left: 2, right: 62, top: 2, bottom: 92 };
const OFFSET = 3; // an out-and-back's return, drawn beside the way out like a transit map
const SHORT = 0.05; // stretches under 5% are too short to name or point along

type Point = { x: number; y: number };
type Box = { left: number; right: number; top: number; bottom: number };
// ponytail: the average glyph width of the 10px serif labels.
const LABEL_CHAR = 5.3;
type Run = { from: number; to: number; effect: WindEffect };
export type SketchLabel = Point & {
  text: string;
  anchor: 'start' | 'middle' | 'end';
};
export type WindSketch = {
  casing: string; // polyline points
  runs: { effect: WindEffect; points: string }[];
  // Where the rider is and which way they face at each 1/TRACK of the distance: the pointer the
  // wind bar moves on hover.
  track: (Point & { angle: number })[];
  start: Point & { label: SketchLabel };
  finish: (Point & { label: SketchLabel }) | null;
  wind: {
    lines: string[]; // "From SW", then "then W" when it turns
    speed: string;
    needle: number | null; // the bearing the wind blows toward, null when calm or variable
  };
  sentence: string; // for screen readers; the drawing is hidden from them
};

const round1 = (x: number) => Math.round(x * 10) / 10;
const pointsAttr = (ps: Point[]) =>
  ps.map((p) => `${round1(p.x)},${round1(p.y)}`).join(' ');
const meanDirection = (items: { degrees: number; weight: number }[]) => {
  const rad = Math.PI / 180;
  const x = items.reduce((s, i) => s + i.weight * Math.sin(i.degrees * rad), 0);
  const y = items.reduce((s, i) => s + i.weight * Math.cos(i.degrees * rad), 0);
  return Math.hypot(x, y) < 1e-6 ? null : (Math.atan2(x, y) / rad + 360) % 360;
};

const mergeRuns = (runs: Run[]) =>
  runs.reduce<Run[]>((out, r) => {
    const last = out.at(-1);
    if (last?.effect === r.effect) last.to = r.to;
    else out.push({ ...r });
    return out;
  }, []);
// Every stretch with its own effect, neighbours with the same effect merged.
const exactRuns = (stretches: WindStretch[]): Run[] => {
  const total = stretches.at(-1)?.toM ?? 0;
  return mergeRuns(
    stretches.map((s) => ({
      from: s.fromM / total,
      to: s.toM / total,
      effect: s.effect,
    })),
  );
};
// The sketch and the spoken route: short runs join the longer neighbour, so each part of the route
// takes the wind over most of it. The bar keeps every stretch the API sends.
const summaryRuns = (exact: Run[]): Run[] => {
  let runs = exact.map((r) => ({ ...r }));
  for (;;) {
    const short = runs
      .map((r, i) => ({ i, length: r.to - r.from }))
      .filter((r) => r.length < SHORT)
      .sort((a, b) => a.length - b.length)[0];
    if (!short || runs.length < 2) break;
    const { i } = short;
    const before = runs[i - 1];
    const after = runs[i + 1];
    const into =
      !after || (before && before.to - before.from >= after.to - after.from)
        ? i - 1
        : i + 1;
    const keep = runs[into];
    runs[into] = {
      from: Math.min(keep.from, runs[i].from),
      to: Math.max(keep.to, runs[i].to),
      effect: keep.effect,
    };
    runs = runs.filter((_, j) => j !== i);
  }
  return mergeRuns(runs);
};

export const windSketch = (
  outline: Outline,
  stretches: WindStretch[],
  b: Departure,
  u: Units = METRIC,
): WindSketch | null => {
  const raw = outline.points;
  const total = raw.at(-1)?.[2] ?? 0;
  if (raw.length < 2 || total <= 0 || !stretches.length) return null;
  // North-up, metres east and north scaled alike around the middle latitude.
  const lat0 =
    ((raw.reduce((s, p) => s + p[0], 0) / raw.length) * Math.PI) / 180;
  const xs = raw.map((p) => p[1] * Math.cos(lat0));
  const ys = raw.map((p) => -p[0]);
  const [minX, maxX] = [Math.min(...xs), Math.max(...xs)];
  const [minY, maxY] = [Math.min(...ys), Math.max(...ys)];
  const w = BOX.right - BOX.left;
  const h = BOX.bottom - BOX.top;
  const scale = Math.min(
    maxX > minX ? w / (maxX - minX) : Number.POSITIVE_INFINITY,
    maxY > minY ? h / (maxY - minY) : Number.POSITIVE_INFINITY,
  );
  if (!Number.isFinite(scale)) return null;
  const left = BOX.left + (w - (maxX - minX) * scale) / 2;
  const top = BOX.top + (h - (maxY - minY) * scale) / 2;
  const fracs = raw.map((p) => p[2] / total);
  let pts: Point[] = raw.map((_, i) => ({
    x: left + (xs[i] - minX) * scale,
    y: top + (ys[i] - minY) * scale,
  }));
  // Retraced road: where the line comes back within a few pixels of where it went, shift it right.
  const near = (p: Point, a: Point, c: Point) => {
    const dx = c.x - a.x;
    const dy = c.y - a.y;
    const t = Math.max(
      0,
      Math.min(
        1,
        ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1),
      ),
    );
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)) < OFFSET;
  };
  const retraced = pts.map((p, i) =>
    pts.some(
      (a, j) =>
        j + 1 < pts.length &&
        fracs[j + 1] < fracs[i] - 0.1 &&
        near(p, a, pts[j + 1]),
    ),
  );
  pts = pts.map((p, i) => {
    if (!retraced[i]) return p;
    const a = pts[Math.max(0, i - 1)];
    const c = pts[Math.min(pts.length - 1, i + 1)];
    const length = Math.hypot(c.x - a.x, c.y - a.y) || 1;
    return {
      x: p.x - ((c.y - a.y) / length) * OFFSET,
      y: p.y + ((c.x - a.x) / length) * OFFSET,
    };
  });
  const at = (f: number): Point => {
    const i = fracs.findIndex((g) => g >= f);
    if (i <= 0) return pts[Math.max(i, 0)];
    const t = (f - fracs[i - 1]) / (fracs[i] - fracs[i - 1] || 1);
    return {
      x: pts[i - 1].x + t * (pts[i].x - pts[i - 1].x),
      y: pts[i - 1].y + t * (pts[i].y - pts[i - 1].y),
    };
  };
  const latLonAt = (f: number): [number, number] => {
    const i = fracs.findIndex((g) => g >= f);
    if (i <= 0) return [raw[0][0], raw[0][1]];
    const t = (f - fracs[i - 1]) / (fracs[i] - fracs[i - 1] || 1);
    return [
      raw[i - 1][0] + t * (raw[i][0] - raw[i - 1][0]),
      raw[i - 1][1] + t * (raw[i][1] - raw[i - 1][1]),
    ];
  };
  const runs = summaryRuns(exactRuns(stretches));
  const drawn = runs.map((r) => ({
    effect: r.effect,
    points: pointsAttr([
      at(r.from),
      ...pts.filter((_, i) => fracs[i] > r.from && fracs[i] < r.to),
      at(r.to),
    ]),
  }));
  // The heading at each step comes from a few px either side, so a wiggle doesn't spin the pointer.
  const track = Array.from({ length: TRACK + 1 }, (_, i) => {
    const f = i / TRACK;
    const p = at(f);
    const a = at(Math.max(0, f - 0.03));
    const c = at(Math.min(1, f + 0.03));
    return {
      x: round1(p.x),
      y: round1(p.y),
      angle: round1((Math.atan2(c.y - a.y, c.x - a.x) * 180) / Math.PI),
    };
  });
  // A compass needle pointing where the wind blows; the words name where it comes from, and where it turns.
  // Light wind all the way still has a direction, unless the API finds it calm or variable.
  const directed = stretches.filter(
    (s) =>
      s.windFromDegrees !== null &&
      (s.toM - s.fromM) / (stretches.at(-1)?.toM ?? 1) >= SHORT,
  );
  const named = directed.filter((s) => s.effect !== 'light');
  const mean = meanDirection(
    (named.length ? named : directed).map((s) => ({
      degrees: s.windFromDegrees as number,
      weight: s.toM - s.fromM,
    })),
  );
  const from = named.length
    ? [...new Set(named.map((s) => compass(s.windFromDegrees as number)))]
    : mean === null
      ? []
      : [compass(mean)];
  const needle = mean === null ? null : round1((mean + 180) % 360);
  const lines = named.length
    ? [`From ${from[0]}`, ...(from[1] ? [`then ${from[1]}`] : [])]
    : ['Light wind', ...(from[0] ? [`from ${from[0]}`] : [])];
  // Start and finish labels sit left of their dot, else right, clear of the wind key and route.
  const taken: Box[] = [KEY];
  // The route, sampled every 2px. Text over the haloed line reads; text over text doesn't, so
  // each sample under a label costs 20, and each px² over the wind key costs 4.
  const trail = pts.slice(1).flatMap((p, i) => {
    const a = pts[i];
    const steps = Math.max(1, Math.ceil(Math.hypot(p.x - a.x, p.y - a.y) / 2));
    return Array.from({ length: steps }, (_, k) => ({
      x: a.x + ((p.x - a.x) * k) / steps,
      y: a.y + ((p.y - a.y) * k) / steps,
    }));
  });
  // Beside the dot, else centred below or above it; failing all, wherever overlaps least.
  const label = (p: Point, text: string): SketchLabel => {
    const width = text.length * LABEL_CHAR;
    const centre = Math.min(
      Math.max(p.x, 2 + width / 2),
      SKETCH.width - 2 - width / 2,
    );
    const spots: [SketchLabel['anchor'], number, number][] = [
      ['end', p.x - 8, p.y + 3],
      ['start', p.x + 8, p.y + 3],
      ['middle', centre, p.y + 16],
      ['middle', centre, p.y - 9],
    ];
    const clash = ([anchor, x, y]: (typeof spots)[number]) => {
      const left =
        anchor === 'end' ? x - width : anchor === 'middle' ? x - width / 2 : x;
      const box = { left, right: left + width, top: y - 8, bottom: y + 2 };
      const outside =
        box.left < 2 ||
        box.right > SKETCH.width - 2 ||
        box.top < 0 ||
        box.bottom > SKETCH.height;
      const covered = trail.filter(
        (q) =>
          q.x >= box.left - 2 &&
          q.x <= box.right + 2 &&
          q.y >= box.top - 2 &&
          q.y <= box.bottom + 2,
      ).length;
      return (
        (outside ? 1e6 : 0) +
        covered * 20 +
        4 *
          taken.reduce(
            (sum, t) =>
              sum +
              Math.max(
                0,
                Math.min(t.right, box.right) - Math.max(t.left, box.left),
              ) *
                Math.max(
                  0,
                  Math.min(t.bottom, box.bottom) - Math.max(t.top, box.top),
                ),
            0,
          )
      );
    };
    const [anchor, x, y] = spots.reduce((best, spot) =>
      clash(spot) < clash(best) ? spot : best,
    );
    const left =
      anchor === 'end' ? x - width : anchor === 'middle' ? x - width / 2 : x;
    taken.push({ left, right: left + width, top: y - 8, bottom: y + 2 });
    return { x: round1(x), y: round1(y), text, anchor };
  };
  const first = pts[0];
  const last = pts.at(-1) ?? first;
  const start = {
    x: round1(first.x),
    y: round1(first.y),
    label: label(first, 'Start'),
  };
  const finish = roundTripOf(outline)
    ? null
    : {
        x: round1(last.x),
        y: round1(last.y),
        label: label(last, 'Finish'),
      };
  // "Heads north-east with the wind behind, then south across the wind, then west into the wind."
  const WITH: Record<WindEffect, string> = {
    tailwind: 'with the wind behind',
    crosswind: 'across the wind',
    headwind: 'into the wind',
    light: 'in light wind',
  };
  const legs = runs
    .map((r) => ({
      heading: HEADINGS[sector(bearing(latLonAt(r.from), latLonAt(r.to)))],
      effect: WITH[r.effect],
    }))
    .filter(
      (l, i, all) =>
        i === 0 ||
        l.heading !== all[i - 1].heading ||
        l.effect !== all[i - 1].effect,
    )
    .slice(0, 4);
  const headings = from.map((p) => HEADINGS[POINTS.indexOf(p)]).join(', then ');
  const sentence = `Heads ${legs
    .map((l) => `${l.heading} ${l.effect}`)
    .join(', then ')}. ${
    named.length
      ? `Wind from the ${headings}.`
      : from.length
        ? `Light wind from the ${headings}.`
        : 'Light wind.'
  }`;
  return {
    casing: pointsAttr(pts),
    runs: drawn,
    track,
    start,
    finish,
    wind: { lines, speed: speed(b.conditions.averageWindSpeedKph, u), needle },
    sentence,
  };
};
