import { z } from '@hono/zod-openapi';
import { routeSourceSchema } from './route-sources.ts';

export const listRoutesSchema = z
  .strictObject({
    limit: z.coerce.number().int().min(1).max(100).default(100),
    cursor: z.uuid().optional(),
    sourceProviderId: routeSourceSchema.shape.providerId.optional(),
    sourceExternalId: routeSourceSchema.shape.externalId.optional(),
  })
  .refine(
    (q) => !q.sourceExternalId || q.sourceProviderId !== undefined,
    'sourceExternalId requires sourceProviderId.',
  );
export type ListRoutesQuery = z.infer<typeof listRoutesSchema>;

export const pauseInputSchema = z.strictObject({
  until: z.string().nullable(),
});
