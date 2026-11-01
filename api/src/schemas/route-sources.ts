import { z } from '@hono/zod-openapi';
import { surfaceInputSchema } from './surface.ts';

export const routeSourceSchema = z.strictObject({
  providerId: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  externalId: z.string().min(1).max(200),
});
export type RouteSource = z.infer<typeof routeSourceSchema>;
export const importRouteSchema = z.strictObject({
  source: routeSourceSchema,
  gpx: z.string().min(1).max(5_000_000),
  surface: surfaceInputSchema.optional(),
  name: z.string().trim().min(1).max(160).optional(),
  expectedVersion: z
    .number()
    .int()
    .positive()
    .max(Number.MAX_SAFE_INTEGER - 1)
    .optional(),
});
