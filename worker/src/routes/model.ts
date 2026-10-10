import { z } from 'zod';
import { coordinateSchema } from '../weather/validation.ts';

export const routeSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.uuid(),
  name: z.string().min(1).max(160),
  createdAt: z.iso.datetime(),
  sourceHash: z.string(),
  distanceM: z.number().positive(),
  ascentM: z.number().nonnegative().nullable(),
  originalPointCount: z.number().int().positive(),
  warnings: z.array(z.string()),
  legs: z
    .array(
      z.object({
        fromM: z.number().nonnegative(),
        toM: z.number().positive(),
        coordinate: coordinateSchema,
        bearingDegrees: z.number().min(0).max(360),
        weatherLocationId: z.string(),
      }),
    )
    .min(1)
    .max(1000),
  weatherLocations: z
    .array(
      z.object({
        id: z.string(),
        coordinate: coordinateSchema,
        distanceM: z.number().nonnegative(),
      }),
    )
    .min(2)
    .max(100),
});
export type Route = z.infer<typeof routeSchema>;
export const routeSummary = ({
  id,
  name,
  createdAt,
  distanceM,
  ascentM,
  originalPointCount,
  warnings,
}: Route) => ({
  id,
  name,
  createdAt,
  distanceM,
  ascentM,
  originalPointCount,
  warnings,
});
