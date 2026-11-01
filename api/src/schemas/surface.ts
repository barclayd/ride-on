import { z } from '@hono/zod-openapi';

export const surfaceKindSchema = z.enum([
  'paved',
  'compacted',
  'gravel',
  'rough-unpaved',
  'earth',
  'dirt',
  'grass',
  'sand',
  'unpaved',
  'unknown',
  'non-cycling',
]);

/** Client evidence is located against the exact GPX, never simplified geometry. */
export const surfaceInputSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    source: z.strictObject({
      providerId: z.literal('cycle-travel'),
      method: z.literal('route-instructions'),
      formatVersion: z.union([z.literal(1), z.literal(2)]),
      mappingVersion: z.literal(1),
    }),
    geometryDistanceM: z.number().positive().max(400_000),
    sections: z
      .array(
        z.strictObject({
          fromM: z.number().nonnegative().max(400_000),
          toM: z.number().positive().max(400_000),
          surface: surfaceKindSchema,
          sourceCode: z
            .string()
            .min(1)
            .max(40)
            .regex(/^[a-zA-Z0-9:?._-]+$/),
        }),
      )
      .min(1)
      .max(5_000),
  })
  .openapi('SurfaceInput');
export type SurfaceInput = z.infer<typeof surfaceInputSchema>;
// Flatten the shape: OpenAPI allOf cannot extend a strict named object.
export const surfaceEvidenceSchema = z.strictObject({
  ...surfaceInputSchema.shape,
  sourceHash: z.string(),
  capturedAt: z.iso.datetime(),
});
export type SurfaceEvidence = z.infer<typeof surfaceEvidenceSchema>;
