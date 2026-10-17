import { geometrySchema } from '../rides/geometry.ts';
import { digest } from '../tracking/model.ts';
import {
  CACHE_TTL,
  type Connection,
  DAY,
  type ImportJob,
  type ImportPayload,
} from './import-model.ts';
import type { MatchRoute } from './matching.ts';

export const jobGuard =
  'EXISTS (SELECT 1 FROM strava_import_jobs WHERE id = ? AND revision = ? AND lease_id = ? AND lease_until > ?)';
export const guardArgs = (job: ImportJob, at: number) =>
  [job.id, job.revision, job.lease_id, at] as const;
export const initializeImports = async (
  db: D1Database,
  connection: Connection,
  at: number,
) => {
  await db
    .prepare(`INSERT INTO strava_import_sessions(owner_id,generation,initialized_at,last_scan_at,requested_after,requested_before)
    SELECT owner_id,generation,?,0,?,? FROM strava_connections WHERE owner_id = ? AND generation = ?
    ON CONFLICT(owner_id) DO NOTHING`)
    .bind(
      at,
      Math.floor((at - 90 * DAY) / 1000),
      Math.floor(at / 1000),
      connection.owner_id,
      connection.generation,
    )
    .run();
};
export const scheduleScan = async (
  db: D1Database,
  c: Connection,
  after: number,
  before: number,
  at: number,
) => {
  const payload: ImportPayload = { type: 'scan', after, before, page: 1 };
  const results = await db.batch([
    db
      .prepare(`INSERT INTO strava_import_jobs(id,owner_id,generation,job_key,payload_json,due_at,updated_at,expires_at)
      SELECT ?,owner_id,generation,'scan',?,?,?,? FROM strava_import_sessions WHERE owner_id = ? AND generation = ?
      ON CONFLICT(owner_id,generation,job_key) DO UPDATE SET payload_json=excluded.payload_json,revision=revision+1,
      due_at=excluded.due_at,updated_at=excluded.updated_at,queued_until=0,attempts=0,last_error=NULL
      WHERE revision=completed_revision AND lease_until <= ? RETURNING id`)
      .bind(
        crypto.randomUUID(),
        JSON.stringify(payload),
        at,
        at,
        at + CACHE_TTL,
        c.owner_id,
        c.generation,
        at,
      ),
    db
      .prepare(`UPDATE strava_import_sessions SET last_scan_at=?,requested_after=?,requested_before=?
      WHERE owner_id=? AND generation=? AND EXISTS(SELECT 1 FROM strava_import_jobs WHERE owner_id=? AND generation=? AND job_key='scan' AND updated_at=? AND payload_json=?)`)
      .bind(
        at,
        after,
        before,
        c.owner_id,
        c.generation,
        c.owner_id,
        c.generation,
        at,
        JSON.stringify(payload),
      ),
  ]);
  return !!results[0]?.results.length;
};
export const enqueueJob = (
  db: D1Database,
  c: Pick<Connection, 'owner_id' | 'generation'>,
  key: string,
  payload: ImportPayload,
  at: number,
  eventTime = 0,
  notifyAt: number | null = null,
) =>
  db
    .prepare(`INSERT INTO strava_import_jobs(id,owner_id,generation,job_key,payload_json,due_at,updated_at,event_time,notify_at,expires_at)
    SELECT ?,owner_id,generation,?,?,?,?,?,?,? FROM strava_import_sessions WHERE owner_id=? AND generation=?
    ON CONFLICT(owner_id,generation,job_key) DO UPDATE SET revision=revision+1,payload_json=excluded.payload_json,
    due_at=excluded.due_at,updated_at=excluded.updated_at,queued_until=0,event_time=MAX(event_time,excluded.event_time),
    notify_at=COALESCE(notify_at,excluded.notify_at),last_error=NULL
    WHERE excluded.event_time>event_time OR (excluded.event_time=0 AND revision=completed_revision)`)
    .bind(
      crypto.randomUUID(),
      key,
      JSON.stringify(payload),
      at,
      at,
      eventTime,
      notifyAt,
      at + CACHE_TTL,
      c.owner_id,
      c.generation,
    );

export const loadSavedRoutes = async (db: D1Database, owner: string) => {
  const headers = await db
    .prepare(`SELECT id,name,version,json_extract(route_json,'$.distanceM') AS distance_m,
    COALESCE(length(json_extract(route_json,'$.geometry')),0) AS geometry_bytes
    FROM routes WHERE owner_id=? ORDER BY id LIMIT 1001`)
    .bind(owner)
    .all<{
      id: string;
      name: string;
      version: number;
      distance_m: number;
      geometry_bytes: number;
    }>();
  const routes: MatchRoute[] = [];
  let size = 0,
    complete = headers.results.length <= 1000;
  for (let offset = 0; offset < headers.results.length; offset += 20) {
    const batch = headers.results.slice(offset, offset + 20).filter((row) => {
      size += row.geometry_bytes;
      if (size > 8_000_000) {
        complete = false;
        return false;
      }
      return true;
    });
    if (!batch.length) break;
    const geometries = await db
      .prepare(`SELECT id,json_extract(route_json,'$.geometry') AS geometry FROM routes
      WHERE owner_id=? AND id IN (${batch.map(() => '?').join(',')})`)
      .bind(owner, ...batch.map((r) => r.id))
      .all<{ id: string; geometry: string | null }>();
    const byId = new Map(geometries.results.map((r) => [r.id, r.geometry]));
    for (const row of batch) {
      const raw = byId.get(row.id);
      const parsed = geometrySchema.safeParse(raw ? JSON.parse(raw) : null);
      routes.push({
        version: row.version,
        route: {
          id: row.id,
          name: row.name,
          distanceM: row.distance_m,
          geometry: parsed.success ? parsed.data : null,
        },
      });
    }
  }
  return { routes, complete };
};
export const routeSignature = async (db: D1Database, owner: string) => {
  const rows = await db
    .prepare(
      'SELECT id,version FROM routes WHERE owner_id=? ORDER BY id LIMIT 1001',
    )
    .bind(owner)
    .all<{ id: string; version: number }>();
  return digest(rows.results);
};

export const enqueuePush = (
  db: D1Database,
  c: Pick<Connection, 'owner_id' | 'generation'>,
  activityId: string,
  at: number,
) =>
  db
    .prepare(`INSERT INTO strava_import_jobs(id,owner_id,generation,job_key,payload_json,due_at,updated_at,expires_at)
    SELECT ?,owner_id,generation,?,?,?,?,? FROM strava_activity_cache WHERE owner_id=? AND generation=? AND activity_id=?
    AND notification_at>? AND reviewed_at IS NULL ON CONFLICT(owner_id,generation,job_key) DO NOTHING`)
    .bind(
      crypto.randomUUID(),
      `push:${activityId}`,
      JSON.stringify({ type: 'push', activityId }),
      at,
      at,
      at + CACHE_TTL,
      c.owner_id,
      c.generation,
      activityId,
      at - DAY,
    );
