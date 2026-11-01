import { z } from '@hono/zod-openapi';
import { geometrySchema } from './geometry.ts';
import { routeSourceSchema } from './route-sources.ts';
import { selectionSchema } from './selection.ts';
import { surfaceEvidenceSchema, surfaceInputSchema } from './surface.ts';
import { userSchema } from './users.ts';

export const errorSchema = z
  .object({
    error: z.object({ code: z.string(), message: z.string() }),
  })
  .openapi('Error');
export const healthSchema = z
  .object({
    ok: z.literal(true),
    version: z.string(),
    algorithmVersion: z.string(),
    revision: z.string().nullable(),
  })
  .openapi('Health');
export const pauseSchema = z
  .object({
    until: z.string().nullable(),
    resumesAt: z.string().nullable(),
    pausedAt: z.string(),
  })
  .openapi('Pause');
export type Pause = z.infer<typeof pauseSchema>;
export const publicUserSchema = userSchema
  .extend({
    // Keep null on this property; nullable() widens the named Pause component.
    pause: z.union([pauseSchema, z.null()]),
    weatherProviderId: z.string().nullable(),
    preferenceLevels: z.object({
      sunshine: z.string(),
      rain: z.string(),
      crosswind: z.string(),
    }),
  })
  .openapi('User');
export type PublicUser = z.infer<typeof publicUserSchema>;
export const userResponseSchema = z
  .object({ user: publicUserSchema })
  .openapi('UserResponse');
export const selectionResponseSchema = z
  .object({ selection: selectionSchema })
  .openapi('SelectionResponse');
export const surfaceSummarySchema = z
  .object({
    status: z.enum(['complete', 'partial', 'unavailable']),
    pavedM: z.number(),
    unpavedM: z.number(),
    nonCyclingM: z.number(),
    unknownM: z.number(),
    classifiedFraction: z.number(),
    unpavedFraction: z.number().nullable(),
    source: surfaceInputSchema.shape.source.nullable(),
    capturedAt: z.string().nullable(),
  })
  .openapi('SurfaceSummary');
export const routeSummarySchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    createdAt: z.string(),
    distanceM: z.number(),
    ascentM: z.number().nullable(),
    originalPointCount: z.number().int(),
    warnings: z.array(z.string()),
    geometryStatus: z.enum(['available', 'unavailable']),
    surfaceSummary: surfaceSummarySchema,
    source: routeSourceSchema.nullable(),
    version: z.number().int(),
    updatedAt: z.string(),
  })
  .openapi('RouteSummary');
export type RouteSummary = z.infer<typeof routeSummarySchema>;
export const routeResponseSchema = z
  .object({ route: routeSummarySchema })
  .openapi('RouteResponse');
export const routeListSchema = z
  .object({
    routes: z.array(routeSummarySchema),
    nextCursor: z.string().nullable(),
    limit: z.number().int(),
  })
  .openapi('RouteList');
export const importResponseSchema = routeResponseSchema
  .extend({
    outcome: z.enum(['created', 'updated', 'unchanged']),
  })
  .openapi('RouteImportResponse');
export const geometryResponseSchema = z
  .object({
    routeId: z.uuid(),
    version: z.number().int(),
    geometry: geometrySchema.nullable(),
  })
  .openapi('RouteGeometry');
export const surfaceResponseSchema = z
  .object({
    routeId: z.uuid(),
    version: z.number().int(),
    surface: surfaceEvidenceSchema.nullable(),
    summary: surfaceSummarySchema,
  })
  .openapi('RouteSurface');
export const sourceDescriptorSchema = z.object({
  id: z.string(),
  name: z.string(),
  importModes: z.tuple([z.literal('gpx-upload')]),
  accountConnection: z.literal(false),
});
export const sourcesResponseSchema = z
  .object({ sources: z.array(sourceDescriptorSchema) })
  .openapi('RouteSources');
