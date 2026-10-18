import { z } from 'zod';

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
export type RouteSelectionStore = Readonly<{
  get: (ownerId: string) => Promise<RouteSelection>;
  update: (
    ownerId: string,
    selection: RouteSelection,
    expectedVersion: number,
  ) => Promise<boolean>;
}>;

export const createD1RouteSelectionStore = (
  db: D1Database,
): RouteSelectionStore => ({
  get: async (ownerId) => {
    const row = await db
      .prepare('SELECT selection_json FROM route_selections WHERE owner_id = ?')
      .bind(ownerId)
      .first<{ selection_json: string }>();
    return row
      ? selectionSchema.parse(JSON.parse(row.selection_json))
      : { version: 0, routeIds: [], updatedAt: null };
  },
  update: async (ownerId, selection, expectedVersion) => {
    // RETURNING counts the selection itself, independently of cleanup triggers.
    // D1 meta.changes includes their deletes and is not a reliable CAS result.
    const result =
      expectedVersion === 0
        ? await db
            .prepare(
              'INSERT INTO route_selections (owner_id, version, selection_json) VALUES (?, ?, ?) ON CONFLICT(owner_id) DO NOTHING RETURNING owner_id',
            )
            .bind(ownerId, selection.version, JSON.stringify(selection))
            .first<{ owner_id: string }>()
        : await db
            .prepare(
              'UPDATE route_selections SET version = ?, selection_json = ? WHERE owner_id = ? AND version = ? RETURNING owner_id',
            )
            .bind(
              selection.version,
              JSON.stringify(selection),
              ownerId,
              expectedVersion,
            )
            .first<{ owner_id: string }>();
    return result !== null;
  },
});
