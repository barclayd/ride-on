import { z } from '@hono/zod-openapi';

export const geometrySchema = z.object({
  version: z.literal(1),
  encoding: z.literal('polyline6'),
  data: z.string().max(1_200_000),
  pointCount: z.number().int().min(2).max(100_000),
});
export type RideGeometry = z.infer<typeof geometrySchema>;
