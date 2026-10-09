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

export type RouteStore = Readonly<{
  save: (ownerId: string, route: Route) => Promise<void>;
  getMany: (
    ownerId: string,
    ids: readonly string[],
  ) => Promise<readonly Route[]>;
  list: (
    ownerId: string,
  ) => Promise<readonly ReturnType<typeof routeSummary>[]>;
}>;

export const createD1RouteStore = (db: D1Database): RouteStore => ({
  save: async (ownerId, route) => {
    await db
      .prepare(
        'INSERT INTO routes (owner_id, id, name, created_at, route_json) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(
        ownerId,
        route.id,
        route.name,
        route.createdAt,
        JSON.stringify(route),
      )
      .run();
  },
  getMany: async (ownerId, ids) => {
    if (!ids.length) return [];
    const rows = await db
      .prepare(
        `SELECT route_json FROM routes WHERE owner_id = ? AND id IN (${ids.map(() => '?').join(',')})`,
      )
      .bind(ownerId, ...ids)
      .all<{ route_json: string }>();
    return rows.results.map((row) =>
      routeSchema.parse(JSON.parse(row.route_json)),
    );
  },
  list: async (ownerId) => {
    const rows = await db
      .prepare(
        'SELECT route_json FROM routes WHERE owner_id = ? ORDER BY created_at DESC, id LIMIT 100',
      )
      .bind(ownerId)
      .all<{ route_json: string }>();
    return rows.results.map((row) =>
      routeSummary(routeSchema.parse(JSON.parse(row.route_json))),
    );
  },
});
