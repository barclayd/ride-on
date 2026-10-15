import { Temporal } from '@js-temporal/polyfill';
import data from './haduk-grid.json' with { type: 'json' };

export const climateSource = {
  version: data.version,
  referencePeriod: data.referencePeriod,
  statistic: data.statistic,
  attribution: data.attribution,
  source: data.source,
  licence: data.licence,
};

// Immutable, coarse spatial index of bundled data. No user or request state.
const bucket = (latitude: number, longitude: number) =>
  `${Math.floor(latitude * 4)},${Math.floor(longitude * 4)}`;
const cellsByBucket = new Map<string, (typeof data.cells)[number][]>();
for (const cell of data.cells) {
  const xs = cell.ring.map((p) => p[0] ?? NaN);
  const ys = cell.ring.map((p) => p[1] ?? NaN);
  for (
    let y = Math.floor(Math.min(...ys) * 4);
    y <= Math.floor(Math.max(...ys) * 4);
    y++
  )
    for (
      let x = Math.floor(Math.min(...xs) * 4);
      x <= Math.floor(Math.max(...xs) * 4);
      x++
    ) {
      const key = `${y},${x}`;
      const cells = cellsByBucket.get(key) ?? [];
      cells.push(cell);
      cellsByBucket.set(key, cells);
    }
}

/** Containment, not nearest station: do not invent normals outside coverage. */
export const monthlyClimateAt = (coordinate: {
  latitude: number;
  longitude: number;
}) => {
  const { latitude: y, longitude: x } = coordinate;
  for (const cell of cellsByBucket.get(bucket(y, x)) ?? []) {
    let inside = false;
    for (let i = 0, j = cell.ring.length - 1; i < cell.ring.length; j = i++) {
      const [xi = NaN, yi = NaN] = cell.ring[i] ?? [];
      const [xj = NaN, yj = NaN] = cell.ring[j] ?? [];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
        inside = !inside;
    }
    if (inside) return cell.maximumC;
  }
  return null;
};

/** Smooth between mid-month anchors, including December/January and leap years.
 * This is a daytime seasonal reference, never an expected temperature at 8am. */
export const compileSeasonalNormal = (date: string) => {
  const day = Temporal.PlainDate.from(date);
  const anchor = day.with({ day: 15 });
  const left =
    Temporal.PlainDate.compare(day, anchor) < 0
      ? anchor.subtract({ months: 1 })
      : anchor;
  const right = left.add({ months: 1 });
  const fraction = left.until(day).days / left.until(right).days;
  return (monthly: readonly number[]) => {
    const a = monthly[left.month - 1];
    const b = monthly[right.month - 1];
    return a === undefined || b === undefined ? null : a + (b - a) * fraction;
  };
};

export const seasonalNormal = (monthly: readonly number[], date: string) =>
  compileSeasonalNormal(date)(monthly);
