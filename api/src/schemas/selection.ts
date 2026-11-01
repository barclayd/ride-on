import { z } from '@hono/zod-openapi';

export const selectedRouteIdsSchema = z
  .array(z.uuid())
  .max(12)
  .refine(
    (ids) => new Set(ids).size === ids.length,
    'Select each route at most once.',
  );
export const updateSelectionSchema = z.strictObject({
  expectedVersion: z
    .number()
    .int()
    .nonnegative()
    .max(Number.MAX_SAFE_INTEGER - 1),
  routeIds: selectedRouteIdsSchema,
});
export const selectionSchema = z.strictObject({
  version: z.number().int().nonnegative(),
  routeIds: selectedRouteIdsSchema,
  updatedAt: z.iso.datetime().nullable(),
});
export type RouteSelection = z.infer<typeof selectionSchema>;
