import { z } from 'zod';
import { meanWindFrom } from './wind-direction.ts';

const instant = z.iso
  .datetime({ offset: true })
  .transform((value) => new Date(value).toISOString());
export const windStretchSchema = z
  .strictObject({
    fromM: z.number().nonnegative(),
    toM: z.number().positive(),
    startAt: instant,
    endAt: instant,
    effect: z.enum(['light', 'headwind', 'tailwind', 'crosswind']),
    windFromDegrees: z.number().int().min(0).max(359).nullable(),
    averageWindSpeedKph: z.number().nonnegative(),
    maximumAdverseGustKph: z.number().nonnegative(),
  })
  .refine((s) => s.fromM < s.toM && s.startAt < s.endAt);
export const windStretchesSchema = z
  .array(windStretchSchema)
  .max(1000)
  .refine(
    (stretches) =>
      stretches.every((s, i) => {
        const previous = stretches[i - 1];
        return previous
          ? previous.toM === s.fromM && previous.endAt === s.startAt
          : s.fromM === 0;
      }),
    'Wind stretches must cover a contiguous route from zero.',
  );
export type WindStretch = z.infer<typeof windStretchSchema>;
type Row = {
  fromM: number;
  toM: number;
  distanceM: number;
  windSpeedKph: number;
  windFromDegrees: number;
  headwindKph: number;
  crosswindKph: number;
  adverseGustKph: number;
};
const effectFor = (r: Row): WindStretch['effect'] =>
  r.windSpeedKph < 10
    ? 'light'
    : r.crosswindKph > Math.abs(r.headwindKph)
      ? 'crosswind'
      : r.headwindKph > 0
        ? 'headwind'
        : 'tailwind';
const sectorFor = (r: Row) =>
  Math.floor((((r.windFromDegrees % 360) + 360 + 22.5) % 360) / 45);
const round = (v: number) => Math.round(v * 100) / 100;

/** Preserve every wind-effect boundary, including brief adverse sections.
 * Rows are the same complete observations that determine overall conditions. */
export const windStretchesFor = (
  rows: readonly Row[],
  distanceM: number,
  departure: number,
  durationMs: number,
): WindStretch[] => {
  if (
    !rows.length ||
    rows.length > 1000 ||
    rows[0]?.fromM !== 0 ||
    rows.at(-1)?.toM !== distanceM ||
    rows.some(
      (r, i) => r.toM <= r.fromM || (i > 0 && rows[i - 1]?.toM !== r.fromM),
    )
  )
    return [];
  const groups: {
    effect: WindStretch['effect'];
    sector: number;
    rows: Row[];
  }[] = [];
  for (const row of rows) {
    const effect = effectFor(row);
    const sector = sectorFor(row);
    const previous = groups.at(-1);
    if (
      previous?.effect === effect &&
      (effect === 'light' || previous.sector === sector)
    )
      previous.rows.push(row);
    else groups.push({ effect, sector, rows: [row] });
  }
  const time = (m: number) =>
    new Date(departure + (durationMs * m) / distanceM).toISOString();
  return groups.flatMap((g) => {
    const first = g.rows[0],
      last = g.rows.at(-1);
    if (!first || !last) return [];
    const length = last.toM - first.fromM;
    return [
      {
        fromM: first.fromM,
        toM: last.toM,
        startAt: time(first.fromM),
        endAt: time(last.toM),
        effect: g.effect,
        windFromDegrees: meanWindFrom(g.rows),
        averageWindSpeedKph: round(
          g.rows.reduce((n, r) => n + r.windSpeedKph * r.distanceM, 0) / length,
        ),
        maximumAdverseGustKph: round(
          Math.max(...g.rows.map((r) => r.adverseGustKph)),
        ),
      },
    ];
  });
};
