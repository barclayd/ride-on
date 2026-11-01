import { z } from 'zod';

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
export const hourFloor = (time: number) => Math.floor(time / HOUR) * HOUR;
export const dateKey = (time: number) =>
  new Date(time).toISOString().slice(0, 10);
export const dayStart = (date: string) => Date.parse(`${date}T00:00:00Z`);
export const coordinate = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});
export type Coordinate = z.infer<typeof coordinate>;
export const hourSchema = z.object({
  // Accumulations cover (end - 1 hour, end]; temperature is instantaneous at end.
  end: z.iso.datetime(),
  precipitationMm: z.number().nonnegative().nullable(),
  rainMm: z.number().nonnegative().nullable(),
  snowfallCm: z.number().nonnegative().nullable(),
  referenceEt0Mm: z.number().nonnegative().nullable(),
  temperatureC: z.number().nullable(),
  basis: z.enum(['modelled-past', 'forecast']),
});
export type GroundHour = z.infer<typeof hourSchema>;
export const daySchema = z
  .object({
    date: z.iso.date(),
    retrievedAt: z.iso.datetime(),
    refreshAt: z.iso.datetime(),
    gridCoordinate: coordinate,
    hours: z.array(hourSchema).length(24),
  })
  .refine(
    (day) =>
      day.hours.every(
        (hour, index) =>
          Date.parse(hour.end) === dayStart(day.date) + index * HOUR,
      ),
    'Cache timestamps must cover exactly one UTC date.',
  );
export type GroundDay = z.infer<typeof daySchema>;
export type GroundProvider = Readonly<{
  id: string;
  model: string;
  version: string;
  attribution: { text: string; url: string; licence: string };
  fetch: (
    point: Coordinate,
    firstDate: string,
    lastDate: string,
    now: Date,
  ) => Promise<{
    gridCoordinate: Coordinate;
    hours: GroundHour[];
  }>;
}>;
export type Cell = Coordinate & { id: string };
export const requestSchema = z.strictObject({
  routeIds: z
    .array(z.uuid())
    .min(1)
    .max(12)
    .refine((ids) => new Set(ids).size === ids.length),
});
export const assessmentRequestSchema = requestSchema.extend({
  departureAt: z.iso.datetime(),
  averageSpeedKph: z.number().min(5).max(50).optional(),
});
