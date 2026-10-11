import { Temporal } from '@js-temporal/polyfill';
import { z } from 'zod';
import { geometrySchema, type RideGeometry } from './geometry.ts';
import { ridePlanSchema } from './plan.ts';

export const rideDate = z.iso.date().refine((value) => {
  try {
    Temporal.PlainDate.from(value);
    return true;
  } catch {
    return false;
  }
}, 'Use a valid calendar date.');
export const rideTimeZone = z
  .string()
  .max(100)
  .refine((value) => {
    try {
      Temporal.Now.zonedDateTimeISO(value);
      return !/^[+-]/.test(value);
    } catch {
      return false;
    }
  }, 'Use an IANA time zone.');
export const createRideSchema = z
  .strictObject({
    routeId: z.uuid(),
    expectedRouteVersion: z.number().int().positive(),
    riddenOn: rideDate,
    timeZone: rideTimeZone,
    plan: ridePlanSchema.nullable().default(null),
  })
  .refine(
    (input) => {
      if (!input.plan) return true;
      try {
        return (
          Temporal.Instant.from(input.plan.departureAt)
            .toZonedDateTimeISO(input.timeZone)
            .toPlainDate()
            .toString() === input.riddenOn
        );
      } catch {
        return false;
      }
    },
    {
      path: ['plan', 'departureAt'],
      message: 'Plan departure must fall on riddenOn in the ride time zone.',
    },
  );
export const correctRideSchema = z.strictObject({
  expectedVersion: z.number().int().positive(),
  riddenOn: rideDate,
  timeZone: rideTimeZone,
});
export const snapshotSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  version: z.number().int().positive(),
  distanceM: z.number(),
  ascentM: z.number().nullable(),
});
type RideRow = {
  id: string;
  route_id: string;
  source_hash: string;
  route_snapshot: string;
  ridden_on: string;
  time_zone: string;
  recorded_at: string;
  updated_at: string;
  version: number;
  request_hash: string;
  plan_json: string | null;
  geometry_available: number;
};
export const publicRide = (row: RideRow) => ({
  id: row.id,
  version: row.version,
  routeId: row.route_id,
  route: snapshotSchema.parse(JSON.parse(row.route_snapshot)),
  riddenOn: row.ridden_on,
  timeZone: row.time_zone,
  recordedAt: row.recorded_at,
  updatedAt: row.updated_at,
  plan: row.plan_json ? ridePlanSchema.parse(JSON.parse(row.plan_json)) : null,
  planSource: row.plan_json ? ('client-supplied' as const) : null,
  source: { type: 'manual' as const },
  geometryBasis: 'assumed-saved-route' as const,
  geometryStatus: row.geometry_available ? 'available' : 'unavailable',
});
const columns = `r.*, EXISTS(SELECT 1 FROM ride_geometries g
  WHERE g.owner_id = r.owner_id AND g.source_hash = r.source_hash) AS geometry_available`;
export const getRide = (db: D1Database, owner: string, id: string) =>
  db
    .prepare(`SELECT ${columns} FROM rides r WHERE r.owner_id = ? AND r.id = ?`)
    .bind(owner, id)
    .first<RideRow>();

export const createRide = async (
  db: D1Database,
  owner: string,
  key: string,
  hash: string,
  input: z.infer<typeof createRideSchema>,
  timestamp: string,
) => {
  const id = crypto.randomUUID();
  // INSERT ... SELECT snapshots the checked version inside the same transaction;
  // a concurrent source refresh cannot change what the rider logs.
  const results = await db.batch<Record<string, unknown>>([
    db
      .prepare(`INSERT INTO rides
      (owner_id, id, idempotency_key, request_hash, route_id, source_hash,
       route_snapshot, ridden_on, time_zone, recorded_at, updated_at, plan_json)
      SELECT owner_id, ?, ?, ?, id, json_extract(route_json, '$.sourceHash'),
       json_object('id', id, 'name', name, 'version', version,
        'distanceM', json_extract(route_json, '$.distanceM'), 'ascentM', json_extract(route_json, '$.ascentM')),
       ?, ?, ?, ?, ? FROM routes WHERE owner_id = ? AND id = ? AND version = ?
       AND NOT EXISTS (SELECT 1 FROM ride_tombstones WHERE owner_id = ? AND idempotency_key = ?)
      ON CONFLICT(owner_id, idempotency_key) DO NOTHING`)
      .bind(
        id,
        key,
        hash,
        input.riddenOn,
        input.timeZone,
        timestamp,
        timestamp,
        input.plan ? JSON.stringify(input.plan) : null,
        owner,
        input.routeId,
        input.expectedRouteVersion,
        owner,
        key,
      ),
    db
      .prepare(
        `SELECT ${columns} FROM rides r WHERE owner_id = ? AND idempotency_key = ?`,
      )
      .bind(owner, key),
    db
      .prepare(
        'SELECT request_hash FROM ride_tombstones WHERE owner_id = ? AND idempotency_key = ?',
      )
      .bind(owner, key),
    db
      .prepare('SELECT version FROM routes WHERE owner_id = ? AND id = ?')
      .bind(owner, input.routeId),
  ]);
  const row = results[1]?.results[0] as RideRow | undefined;
  return {
    row,
    created: row?.id === id,
    deleted: !!results[2]?.results.length,
    routeExists: !!results[3]?.results.length,
  };
};

export const listRides = async (
  db: D1Database,
  owner: string,
  limit: number,
  routeId?: string,
  cursor?: { date: string; id: string },
) => {
  const filter = routeId ? ' AND r.route_id = ?' : '';
  const values = routeId ? [owner, routeId] : [owner];
  const after = cursor
    ? ' AND (r.ridden_on < ? OR (r.ridden_on = ? AND r.id > ?))'
    : '';
  const result = await db.batch<Record<string, unknown>>([
    db
      .prepare(`SELECT ${columns} FROM rides r WHERE r.owner_id = ?${filter}${after}
      ORDER BY r.ridden_on DESC, r.id LIMIT ?`)
      .bind(
        ...values,
        ...(cursor ? [cursor.date, cursor.date, cursor.id] : []),
        limit + 1,
      ),
    db
      .prepare(
        `SELECT COUNT(*) AS rideCount, MAX(ridden_on) AS lastRiddenOn FROM rides r WHERE r.owner_id = ?${filter}`,
      )
      .bind(...values),
    db
      .prepare('SELECT revision FROM ride_history_revisions WHERE owner_id = ?')
      .bind(owner),
  ]);
  const rows = (result[0]?.results ?? []) as RideRow[];
  const last = rows[Math.min(rows.length, limit) - 1];
  return {
    rides: rows.slice(0, limit).map(publicRide),
    nextCursor:
      rows.length > limit && last
        ? btoa(
            JSON.stringify({
              date: last.ridden_on,
              id: last.id,
              routeId: routeId ?? null,
            }),
          )
        : null,
    summary: result[1]?.results[0] ?? { rideCount: 0, lastRiddenOn: null },
    historyRevision: Number(result[2]?.results[0]?.revision ?? 0),
  };
};

/** Exact-route badges must use all history, not the currently loaded UI page.
 * Indexed correlated reads stay bounded by the requested route page; geometry
 * overlap remains a separate recommendation concern. */
export const summarizeRides = async (
  db: D1Database,
  owner: string,
  routeIds: readonly string[],
) => {
  const result = await db.batch<Record<string, unknown>>([
    db
      .prepare(`SELECT r.id AS routeId,
      (SELECT COUNT(*) FROM rides h WHERE h.owner_id = r.owner_id AND h.route_id = r.id) AS rideCount,
      (SELECT json_object('id', h.id, 'riddenOn', h.ridden_on, 'timeZone', h.time_zone,
        'routeVersion', json_extract(h.route_snapshot, '$.version'))
       FROM rides h WHERE h.owner_id = r.owner_id AND h.route_id = r.id
       ORDER BY h.ridden_on DESC, h.id LIMIT 1) AS latest
      FROM routes r WHERE r.owner_id = ? AND r.id IN (SELECT value FROM json_each(?))`)
      .bind(owner, JSON.stringify(routeIds)),
    db
      .prepare('SELECT revision FROM ride_history_revisions WHERE owner_id = ?')
      .bind(owner),
  ]);
  const rows = new Map(
    (result[0]?.results ?? []).map((row) => [String(row.routeId), row]),
  );
  if (rows.size !== routeIds.length) return null;
  const latest = z.object({
    id: z.uuid(),
    riddenOn: rideDate,
    timeZone: rideTimeZone,
    routeVersion: z.number().int().positive(),
  });
  return {
    summaries: routeIds.map((routeId) => {
      const row = rows.get(routeId);
      const lastRide =
        typeof row?.latest === 'string'
          ? latest.parse(JSON.parse(row.latest))
          : null;
      return {
        routeId,
        rideCount: Number(row?.rideCount ?? 0),
        lastRiddenOn: lastRide?.riddenOn ?? null,
        lastRide,
      };
    }),
    historyRevision: Number(result[1]?.results[0]?.revision ?? 0),
  };
};

export type HistoryEntry = {
  id: string;
  sourceHash: string;
  riddenOn: string;
  timeZone: string;
};
export type HistorySnapshot = {
  revision: number;
  entries: HistoryEntry[];
  geometries: Map<string, RideGeometry>;
  limited: boolean;
};
export const readHistory = async (
  db: D1Database,
  owner: string,
  since: string,
  until: string,
): Promise<HistorySnapshot> => {
  const scope = 'owner_id = ? AND ridden_on >= ? AND ridden_on <= ?';
  const results = await db.batch<Record<string, unknown>>([
    db
      .prepare('SELECT revision FROM ride_history_revisions WHERE owner_id = ?')
      .bind(owner),
    db
      .prepare(
        `SELECT id, source_hash, ridden_on, time_zone FROM rides WHERE ${scope} ORDER BY ridden_on DESC, id LIMIT 1001`,
      )
      .bind(owner, since, until),
    db
      .prepare(`WITH relevant AS (
      SELECT g.source_hash, g.geometry_json FROM ride_geometries g
      WHERE g.owner_id = ? AND g.source_hash IN (SELECT source_hash FROM rides WHERE ${scope})
    ) SELECT source_hash,
      CASE WHEN (SELECT SUM(length(geometry_json)) FROM relevant) <= 2000000
        AND (SELECT COUNT(*) FROM relevant) <= 128 THEN geometry_json ELSE NULL END AS geometry_json
      FROM relevant LIMIT 129`)
      .bind(owner, owner, since, until),
  ]);
  const rows = results[1]?.results ?? [];
  const geometries = new Map<string, RideGeometry>();
  let limited = rows.length > 1000;
  for (const row of results[2]?.results ?? []) {
    if (typeof row.geometry_json !== 'string') {
      limited = true;
      continue;
    }
    geometries.set(
      String(row.source_hash),
      geometrySchema.parse(JSON.parse(row.geometry_json)),
    );
  }
  return {
    revision: Number(results[0]?.results[0]?.revision ?? 0),
    limited,
    geometries,
    entries: rows.slice(0, 1000).map((row) => ({
      id: String(row.id),
      sourceHash: String(row.source_hash),
      riddenOn: String(row.ridden_on),
      timeZone: String(row.time_zone),
    })),
  };
};
