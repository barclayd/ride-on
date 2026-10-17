import { z } from 'zod';
import { AppError } from '../errors.ts';
import type { Env } from '../types.ts';
import { athleteSchema, bridge } from './bridge.ts';
import {
  activitySchema,
  CACHE_TTL,
  type Connection,
  DAY,
  eventSchema,
  getConnection,
  type ImportJob,
  importJobSchema,
  importsEnabled,
  pageSchema,
} from './import-model.ts';
import { deliverImportPush } from './import-push.ts';
import {
  enqueueJob,
  enqueuePush,
  guardArgs,
  initializeImports,
  jobGuard,
  loadSavedRoutes,
  routeSignature,
  scheduleScan,
} from './import-store.ts';
import { matchActivity } from './matching.ts';

const queuedSchema = z.strictObject({
  kind: z.literal('strava_job'),
  id: z.uuid(),
});
const LEASE = 5 * 60_000;
const finish = (db: D1Database, job: ImportJob, at: number) =>
  db
    .prepare(`UPDATE strava_import_jobs SET completed_revision=revision,
  lease_id=NULL,lease_until=0,queued_until=0,updated_at=?,last_error=NULL WHERE id=? AND ${jobGuard}`)
    .bind(at, job.id, ...guardArgs(job, at))
    .run();
const release = (db: D1Database, job: ImportJob, at: number, error: string) =>
  db
    .prepare(`UPDATE strava_import_jobs SET lease_id=NULL,
  lease_until=0,queued_until=0,due_at=?,updated_at=?,last_error=? WHERE id=? AND lease_id=?`)
    .bind(at + 900_000, at, error, job.id, job.lease_id)
    .run();

export const acceptStravaEvent = async (env: Env, input: unknown, at: Date) => {
  if (!importsEnabled(env)) return;
  const parsed = eventSchema.safeParse(input);
  if (!parsed.success) return;
  const event = parsed.data;
  // Events are untrusted refresh hints. Reject implausible future timestamps;
  // compare resource ownership and the connection generation on every fetch.
  if (event.eventTime * 1000 > at.getTime() + 300_000) return;
  const c = await env.ROUTES_DB.prepare(
    'SELECT * FROM strava_connections WHERE athlete_id=?',
  )
    .bind(event.athleteId)
    .first<Connection>();
  if (!c || event.eventTime * 1000 < c.connected_at - 1000) return;
  await initializeImports(env.ROUTES_DB, c, at.getTime());
  const payload = event.activityId
    ? { type: 'activity' as const, activityId: event.activityId }
    : { type: 'verify' as const };
  await enqueueJob(
    env.ROUTES_DB,
    c,
    event.activityId ? `activity:${event.activityId}` : 'verify',
    payload,
    at.getTime(),
    event.eventTime,
    event.aspect === 'create' ? event.eventTime * 1000 : null,
  ).run();
};

export const runImportJob = async (
  env: Env,
  id: string,
  now: () => Date = () => new Date(),
) => {
  if (!importsEnabled(env)) return;
  const db = env.ROUTES_DB,
    start = now().getTime();
  const job = await db
    .prepare(`UPDATE strava_import_jobs SET lease_id=?,lease_until=?,attempts=attempts+1
    WHERE id=? AND completed_revision<revision AND lease_until<=? AND due_at<=? AND expires_at>?
    AND (json_extract(payload_json,'$.type')='push' OR COALESCE((SELECT until_at FROM strava_import_backoff WHERE id=1),0)<=?) RETURNING *`)
    .bind(crypto.randomUUID(), start + LEASE, id, start, start, start, start)
    .first<ImportJob>();
  if (!job) return;
  const c = await getConnection(db, job.owner_id);
  if (!c || c.generation !== job.generation) return;
  try {
    const input = importJobSchema.parse(JSON.parse(job.payload_json));
    const grant = `grant=${encodeURIComponent(c.grant_id)}`;
    if (input.type === 'verify') {
      await bridge(
        env,
        `/connection/${c.athlete_id}?${grant}&verify=true`,
        athleteSchema,
      );
    } else if (input.type === 'scan') {
      const page = await bridge(
        env,
        `/import-page/${c.athlete_id}?${grant}&after=${input.after}&before=${input.before}&page=${input.page}`,
        pageSchema,
      );
      if (page.nextPage !== null && page.nextPage !== input.page + 1)
        throw new Error('Invalid page sequence');
      const at = now().getTime();
      // Child jobs contain IDs only. A crash or repeated page is harmless.
      if (page.activityIds.length)
        await db.batch(
          [...new Set(page.activityIds)].map((activityId) =>
            enqueueJob(
              db,
              c,
              `activity:${activityId}`,
              { type: 'activity', activityId },
              at,
            ),
          ),
        );
      if (page.nextPage !== null) {
        if (page.nextPage > 1000) {
          await db
            .prepare(`UPDATE strava_import_jobs SET completed_revision=revision,lease_id=NULL,lease_until=0,
            queued_until=0,last_error='import_range_too_large',updated_at=? WHERE id=? AND ${jobGuard}`)
            .bind(at, job.id, ...guardArgs(job, at))
            .run();
          return;
        }
        await db
          .prepare(`UPDATE strava_import_jobs SET payload_json=?,lease_id=NULL,lease_until=0,queued_until=0,
          due_at=?,updated_at=?,attempts=0 WHERE id=? AND ${jobGuard}`)
          .bind(
            JSON.stringify({ ...input, page: page.nextPage }),
            at,
            at,
            job.id,
            ...guardArgs(job, at),
          )
          .run();
        return;
      }
    } else if (input.type === 'push') {
      if (!(await deliverImportPush(env, job, input.activityId, now))) {
        await release(db, job, now().getTime(), 'push_unavailable');
        return;
      }
    } else {
      const activity = await bridge(
        env,
        `/import-activity/${c.athlete_id}?${grant}&activity=${input.activityId}`,
        activitySchema,
        undefined,
        8_000_000,
      );
      const at = now().getTime();
      if (!activity.available) {
        await db.batch([
          db
            .prepare(
              `DELETE FROM strava_ride_history WHERE owner_id=? AND activity_id=? AND generation=? AND ${jobGuard}`,
            )
            .bind(
              c.owner_id,
              input.activityId,
              c.generation,
              ...guardArgs(job, at),
            ),
          db
            .prepare(
              `DELETE FROM strava_activity_cache WHERE owner_id=? AND activity_id=? AND generation=? AND ${jobGuard}`,
            )
            .bind(
              c.owner_id,
              input.activityId,
              c.generation,
              ...guardArgs(job, at),
            ),
          db
            .prepare(
              `DELETE FROM strava_import_jobs WHERE owner_id=? AND generation=? AND job_key=? AND ${jobGuard}`,
            )
            .bind(
              c.owner_id,
              c.generation,
              `push:${input.activityId}`,
              ...guardArgs(job, at),
            ),
          db
            .prepare(
              `DELETE FROM strava_import_jobs WHERE id=? AND ${jobGuard}`,
            )
            .bind(job.id, ...guardArgs(job, at)),
        ]);
        return;
      } else {
        if (
          activity.activityId !== input.activityId ||
          Date.parse(activity.startedAt) > at
        )
          throw new Error('Invalid activity');
        const signature = await routeSignature(db, c.owner_id);
        const saved = await loadSavedRoutes(db, c.owner_id);
        const match = matchActivity(
          activity.points.map(([latitude, longitude]) => ({
            latitude,
            longitude,
          })),
          saved.routes,
          saved.complete,
        );
        if (signature !== (await routeSignature(db, c.owner_id)))
          throw new Error('Routes changed during assessment');
        const notification =
          job.notify_at !== null &&
          job.notify_at + DAY > at &&
          match.status === 'matched'
            ? job.notify_at
            : null;
        await db.batch([
          // Matching evidence expires independently of the minimal ride-date record.
          db
            .prepare(
              `DELETE FROM strava_activity_cache WHERE owner_id=? AND activity_id=? AND expires_at<=? AND ${jobGuard}`,
            )
            .bind(c.owner_id, input.activityId, at, ...guardArgs(job, at)),
          db
            .prepare(`INSERT INTO strava_activity_cache(owner_id,generation,activity_id,started_at,ridden_on,
            match_json,decision,primary_route_id,version,reviewed_at,first_seen_at,fetched_at,expires_at,notification_at)
            SELECT ?,?,?,?,?,?,COALESCE(h.decision,'automatic'),
            CASE WHEN h.decision IN ('confirmed','dismissed') THEN h.primary_route_id ELSE ? END,
            COALESCE(h.version,0)+1,CASE WHEN h.decision IN ('confirmed','dismissed') THEN ? ELSE NULL END,?,?,?,
            CASE WHEN h.activity_id IS NULL THEN ? ELSE NULL END
            FROM (SELECT 1) LEFT JOIN strava_ride_history h ON h.owner_id=? AND h.activity_id=? AND h.generation=? WHERE ${jobGuard}
            ON CONFLICT(owner_id,activity_id) DO UPDATE SET started_at=excluded.started_at,ridden_on=excluded.ridden_on,
            match_json=excluded.match_json,decision=excluded.decision,primary_route_id=excluded.primary_route_id,
            reviewed_at=COALESCE(strava_activity_cache.reviewed_at,excluded.reviewed_at),
            fetched_at=excluded.fetched_at,version=MAX(strava_activity_cache.version+1,excluded.version),
            notification_at=COALESCE(strava_activity_cache.notification_at,excluded.notification_at)`)
            .bind(
              c.owner_id,
              c.generation,
              input.activityId,
              activity.startedAt,
              activity.riddenOn,
              JSON.stringify(match),
              match.primaryRouteId,
              at,
              at,
              at,
              at + CACHE_TTL,
              notification,
              c.owner_id,
              input.activityId,
              c.generation,
              ...guardArgs(job, at),
            ),
          db
            .prepare(`INSERT INTO strava_ride_history(owner_id,generation,activity_id,ridden_on,primary_route_id,decision,version,verified_at)
            SELECT owner_id,generation,activity_id,ridden_on,primary_route_id,decision,version,fetched_at
            FROM strava_activity_cache a WHERE owner_id=? AND activity_id=? AND generation=? AND ${jobGuard}
            AND (primary_route_id IS NOT NULL OR decision!='automatic' OR EXISTS(SELECT 1 FROM strava_ride_history h WHERE h.owner_id=a.owner_id AND h.activity_id=a.activity_id))
            AND (primary_route_id IS NULL OR EXISTS(SELECT 1 FROM routes r WHERE r.owner_id=a.owner_id AND r.id=a.primary_route_id))
            ON CONFLICT(owner_id,activity_id) DO UPDATE SET ridden_on=excluded.ridden_on,primary_route_id=excluded.primary_route_id,
            decision=excluded.decision,version=excluded.version,verified_at=excluded.verified_at`)
            .bind(
              c.owner_id,
              input.activityId,
              c.generation,
              ...guardArgs(job, at),
            ),
        ]);
        await enqueuePush(db, c, input.activityId, at).run();
        // The activity's notification timestamp is the durable outbox. Cron
        // recovers a crash between publishing the match and enqueuing delivery.
      }
    }
    await finish(db, job, now().getTime());
  } catch (error) {
    if (error instanceof AppError && error.status === 429)
      await db
        .prepare(
          'INSERT INTO strava_import_backoff VALUES(1,?) ON CONFLICT(id) DO UPDATE SET until_at=MAX(until_at,excluded.until_at)',
        )
        .bind(now().getTime() + 900_000)
        .run();
    if (error instanceof AppError && [403, 409].includes(error.status)) {
      await db
        .prepare(
          'DELETE FROM strava_connections WHERE owner_id=? AND generation=?',
        )
        .bind(c.owner_id, c.generation)
        .run();
      return;
    }
    await release(
      db,
      job,
      now().getTime(),
      error instanceof AppError ? error.code : 'import_unavailable',
    );
  }
};

export const dispatchImports = async (
  env: Env,
  at = new Date(),
  publish?: (jobs: { body: unknown }[]) => Promise<void>,
) => {
  const db = env.ROUTES_DB,
    time = at.getTime();
  // Deletion runs even with imports disabled. API reads independently enforce expiry.
  await db.batch([
    db
      .prepare('DELETE FROM strava_activity_cache WHERE expires_at<=?')
      .bind(time),
    db.prepare('DELETE FROM strava_import_jobs WHERE expires_at<=?').bind(time),
  ]);
  if (!importsEnabled(env)) return;
  const connections = await db
    .prepare(`SELECT c.* FROM strava_connections c LEFT JOIN strava_import_sessions s ON s.owner_id=c.owner_id
    ORDER BY COALESCE(s.last_scan_at,0),c.owner_id LIMIT 50`)
    .all<Connection>();
  for (const c of connections.results) {
    await initializeImports(db, c, time);
    const session = await db
      .prepare(
        'SELECT last_scan_at,route_signature FROM strava_import_sessions WHERE owner_id=? AND generation=?',
      )
      .bind(c.owner_id, c.generation)
      .first<{ last_scan_at: number; route_signature: string }>();
    if (!session) continue;
    const signature = await routeSignature(db, c.owner_id);
    if (
      session.last_scan_at <= time - DAY ||
      session.route_signature !== signature
    ) {
      if (
        await scheduleScan(
          db,
          c,
          Math.floor((time - 90 * DAY) / 1000),
          Math.floor(time / 1000),
          time,
        )
      )
        await db
          .prepare(
            'UPDATE strava_import_sessions SET route_signature=? WHERE owner_id=? AND generation=?',
          )
          .bind(signature, c.owner_id, c.generation)
          .run();
    }
  }
  const stale = await db
    .prepare(`SELECT owner_id,generation,activity_id FROM (
      SELECT owner_id,generation,activity_id,fetched_at AS verified_at FROM strava_activity_cache WHERE expires_at>?
      UNION ALL SELECT owner_id,generation,activity_id,verified_at FROM strava_ride_history)
      GROUP BY owner_id,generation,activity_id HAVING MAX(verified_at)<=? ORDER BY MAX(verified_at),activity_id LIMIT 100`)
    .bind(time, time - DAY)
    .all<{ owner_id: string; generation: string; activity_id: string }>();
  if (stale.results.length)
    await db.batch(
      stale.results.map((r) =>
        enqueueJob(
          db,
          r,
          `activity:${r.activity_id}`,
          { type: 'activity', activityId: r.activity_id },
          time,
        ),
      ),
    );
  const pendingPush = await db
    .prepare(`SELECT a.owner_id,a.generation,a.activity_id FROM strava_activity_cache a
    WHERE a.notification_at>? AND a.reviewed_at IS NULL AND NOT EXISTS(SELECT 1 FROM strava_import_jobs j WHERE j.owner_id=a.owner_id
    AND j.generation=a.generation AND j.job_key='push:' || a.activity_id) LIMIT 100`)
    .bind(time - DAY)
    .all<{ owner_id: string; generation: string; activity_id: string }>();
  if (pendingPush.results.length)
    await db.batch(
      pendingPush.results.map((r) =>
        enqueueJob(
          db,
          r,
          `push:${r.activity_id}`,
          { type: 'push', activityId: r.activity_id },
          time,
        ),
      ),
    );
  await publishImportJobs(env, at, publish);
};

export const publishImportJobs = async (
  env: Env,
  at = new Date(),
  publish?: (jobs: { body: unknown }[]) => Promise<void>,
) => {
  if (!importsEnabled(env)) return;
  const time = at.getTime();
  const jobs =
    await env.ROUTES_DB.prepare(`UPDATE strava_import_jobs SET queued_until=? WHERE id IN
    (SELECT id FROM strava_import_jobs WHERE revision>completed_revision AND due_at<=? AND queued_until<=? AND lease_until<=? AND expires_at>?
     AND (json_extract(payload_json,'$.type')='push' OR COALESCE((SELECT until_at FROM strava_import_backoff WHERE id=1),0)<=?)
     ORDER BY CASE WHEN notify_at IS NOT NULL OR job_key LIKE 'push:%' THEN 0 ELSE 1 END,due_at,id LIMIT 50) RETURNING id`)
      .bind(time + LEASE, time, time, time, time, time)
      .all<{ id: string }>();
  if (!jobs.results.length) return;
  try {
    const messages = jobs.results.map((j) => ({
      body: { kind: 'strava_job', id: j.id },
    }));
    await (
      publish ?? ((messages) => env.RIDE_MONITOR_QUEUE.sendBatch(messages))
    )(messages);
  } catch {
    // The D1 outbox remains pending; cron retries after the bounded reservation.
    console.error('Strava queue temporarily unavailable');
  }
};

export const consumeStravaMessage = async (
  body: unknown,
  env: Env,
  now: () => Date = () => new Date(),
) => {
  const job = queuedSchema.safeParse(body);
  const event = eventSchema.safeParse(body);
  if (!job.success && !event.success) return false;
  if (job.success) await runImportJob(env, job.data.id, now);
  else await acceptStravaEvent(env, body, now());
  await publishImportJobs(env, now());
  return true;
};

export const startDefaultImport = async (
  env: Env,
  c: Connection,
  at = new Date(),
) => {
  if (!importsEnabled(env)) return;
  const time = at.getTime();
  await initializeImports(env.ROUTES_DB, c, time);
  await scheduleScan(
    env.ROUTES_DB,
    c,
    Math.floor((time - 90 * DAY) / 1000),
    Math.floor(time / 1000),
    time,
  );
  await publishImportJobs(env, at);
};
