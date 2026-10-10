import { z } from 'zod';
import { type Route, routeSchema, routeSummary } from './model.ts';
import { type RouteSource, routeSourceSchema } from './sources.ts';

export const routeRecordSchema = z.object({
  route: routeSchema,
  source: routeSourceSchema.nullable(),
  version: z.number().int().positive(),
  updatedAt: z.iso.datetime(),
});
export type RouteRecord = z.infer<typeof routeRecordSchema>;
export const storedRouteSummary = (record: RouteRecord) => ({
  ...routeSummary(record.route),
  source: record.source,
  version: record.version,
  updatedAt: record.updatedAt,
});
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
export type RouteStore = Readonly<{
  save: (ownerId: string, route: Route) => Promise<void>;
  getMany: (
    ownerId: string,
    ids: readonly string[],
  ) => Promise<readonly Route[]>;
  list: (
    ownerId: string,
    query: ListRoutesQuery,
  ) => Promise<{
    routes: ReturnType<typeof storedRouteSummary>[];
    nextCursor: string | null;
  }>;
  get: (ownerId: string, id: string) => Promise<RouteRecord | null>;
  findSource: (
    ownerId: string,
    source: RouteSource,
  ) => Promise<RouteRecord | null>;
  createImported: (ownerId: string, record: RouteRecord) => Promise<boolean>;
  replaceImported: (
    ownerId: string,
    record: RouteRecord,
    expectedVersion: number,
  ) => Promise<boolean>;
}>;

type Row = {
  route_json: string;
  version: number;
  updated_at: string | null;
  source_provider: string | null;
  source_external_id: string | null;
};
const columns =
  'route_json, version, updated_at, source_provider, source_external_id';
const fromRow = (row: Row): RouteRecord => {
  const route = routeSchema.parse(JSON.parse(row.route_json));
  return routeRecordSchema.parse({
    route,
    version: row.version,
    updatedAt: row.updated_at ?? route.createdAt,
    source:
      row.source_provider === null
        ? null
        : {
            providerId: row.source_provider,
            externalId: row.source_external_id,
          },
  });
};

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
  list: async (ownerId, query) => {
    const filters = ['owner_id = ?'];
    const params: (string | number)[] = [ownerId];
    if (query.sourceProviderId !== undefined) {
      filters.push('source_provider = ?');
      params.push(query.sourceProviderId);
    }
    if (query.sourceExternalId !== undefined) {
      filters.push('source_external_id = ?');
      params.push(query.sourceExternalId);
    }
    if (query.cursor !== undefined) {
      // Stable ordering: source refreshes never change creation time or route ID.
      filters.push(
        '(created_at < (SELECT created_at FROM routes WHERE owner_id = ? AND id = ?) OR (created_at = (SELECT created_at FROM routes WHERE owner_id = ? AND id = ?) AND id > ?))',
      );
      params.push(ownerId, query.cursor, ownerId, query.cursor, query.cursor);
    }
    const rows = await db
      .prepare(
        `SELECT ${columns} FROM routes WHERE ${filters.join(' AND ')} ORDER BY created_at DESC, id LIMIT ?`,
      )
      .bind(...params, query.limit + 1)
      .all<Row>();
    const routes = rows.results
      .slice(0, query.limit)
      .map((row) => storedRouteSummary(fromRow(row)));
    return {
      routes,
      nextCursor:
        rows.results.length > query.limit ? (routes.at(-1)?.id ?? null) : null,
    };
  },
  get: async (ownerId, id) => {
    const row = await db
      .prepare(`SELECT ${columns} FROM routes WHERE owner_id = ? AND id = ?`)
      .bind(ownerId, id)
      .first<Row>();
    return row ? fromRow(row) : null;
  },
  findSource: async (ownerId, source) => {
    const row = await db
      .prepare(
        `SELECT ${columns} FROM routes WHERE owner_id = ? AND source_provider = ? AND source_external_id = ?`,
      )
      .bind(ownerId, source.providerId, source.externalId)
      .first<Row>();
    return row ? fromRow(row) : null;
  },
  createImported: async (ownerId, record) => {
    if (!record.source) throw new Error('Imported routes require a source.');
    const result = await db
      .prepare(
        'INSERT INTO routes (owner_id, id, name, created_at, route_json, version, updated_at, source_provider, source_external_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(owner_id, source_provider, source_external_id) DO NOTHING',
      )
      .bind(
        ownerId,
        record.route.id,
        record.route.name,
        record.route.createdAt,
        JSON.stringify(record.route),
        record.version,
        record.updatedAt,
        record.source.providerId,
        record.source.externalId,
      )
      .run();
    return result.meta.changes === 1;
  },
  replaceImported: async (ownerId, record, expectedVersion) => {
    const result = await db
      .prepare(
        'UPDATE routes SET name = ?, route_json = ?, version = ?, updated_at = ? WHERE owner_id = ? AND id = ? AND version = ?',
      )
      .bind(
        record.route.name,
        JSON.stringify(record.route),
        record.version,
        record.updatedAt,
        ownerId,
        record.route.id,
        expectedVersion,
      )
      .run();
    return result.meta.changes === 1;
  },
});
