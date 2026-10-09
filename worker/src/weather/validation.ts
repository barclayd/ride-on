import { z } from 'zod';

export const utcInstant = z.iso
  .datetime()
  .refine((value) => value.endsWith('Z'));
export const coordinateSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});
const measure = z.union([
  z.object({
    quantity: z.enum(['air-temperature', 'feels-like-temperature']),
    unit: z.literal('celsius'),
  }),
  z.object({
    quantity: z.enum(['wind-speed', 'wind-gust']),
    unit: z.literal('m/s'),
  }),
  z.object({
    quantity: z.literal('wind-from-direction'),
    unit: z.literal('degrees'),
  }),
  z.object({
    quantity: z.enum(['rainfall-amount', 'precipitation-amount']),
    unit: z.literal('mm'),
  }),
  z.object({
    quantity: z.enum(['rainfall-rate', 'precipitation-rate']),
    unit: z.literal('mm/h'),
  }),
]);
export const forecastDescriptorSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('scalar'),
    measure,
    statistic: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('deterministic') }),
      z.object({
        kind: z.literal('percentile'),
        percentile: z.number().min(0).max(100),
      }),
    ]),
  }),
  z.object({
    kind: z.literal('probability'),
    unit: z.literal('fraction'),
    event: z.discriminatedUnion('kind', [
      z.object({
        kind: z.literal('threshold'),
        measure,
        comparison: z.enum(['above', 'at-or-above', 'below', 'at-or-below']),
        threshold: z.number(),
      }),
      z.object({
        kind: z.literal('occurrence'),
        phenomenon: z.enum(['rain', 'precipitation']),
        definition: z.string().min(1).max(500),
      }),
    ]),
  }),
]);

export const forecastRequestSchema = z
  .object({
    locations: z
      .array(
        z.object({
          id: z.string().min(1).max(200),
          coordinate: coordinateSchema,
        }),
      )
      .min(1)
      .max(256),
    range: z.object({ start: utcInstant, end: utcInstant }),
    required: z.array(forecastDescriptorSchema).min(1).max(32),
    maxTimeStepSeconds: z.number().positive(),
    maxLocationDistanceM: z.number().nonnegative(),
    maxAgeSeconds: z.number().positive(),
  })
  .refine((request) => {
    const duration =
      Date.parse(request.range.end) - Date.parse(request.range.start);
    return (
      duration > 0 &&
      duration <= 7 * 24 * 60 * 60 * 1000 &&
      new Set(request.locations.map((location) => location.id)).size ===
        request.locations.length
    );
  });
