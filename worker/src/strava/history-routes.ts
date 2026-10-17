import { Hono } from 'hono';
import { z } from 'zod';
import { AppError } from '../errors.ts';
import { readJsonBody, validateInput } from '../request.ts';
import { createD1RouteStore } from '../routes/store.ts';
import type { Bindings } from '../types.ts';
import {
  type ActivityRow,
  DAY,
  FRESHNESS,
  getConnection,
  importsEnabled,
  presentActivity,
  presentRideDate,
  type RideHistoryRow,
  stravaId,
} from './import-model.ts';
import { publishImportJobs } from './import-service.ts';
import { initializeImports, scheduleScan } from './import-store.ts';
import { throttle } from './routes.ts';

const missing = () =>
  new AppError(404, 'NOT_FOUND', 'This ride or saved route is not available.');
const pageQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().max(300).optional(),
});
const cursorSchema = z.tuple([z.iso.date(), z.string().min(1).max(80)]);
const decodeCursor = (value?: string) => {
  if (!value) return null;
  try {
    return cursorSchema.parse(JSON.parse(atob(value)));
  } catch {
    throw new AppError(400, 'BAD_REQUEST', 'Invalid history cursor.');
  }
};
const encodeCursor = (at: string, id: string) => btoa(JSON.stringify([at, id]));
const cache = {
  mode: 'temporary' as const,
  maximumAgeDays: 7,
  maximumVerificationAgeHours: 48,
};

const retention = { mode: 'ride_date' as const, activityMetricsStored: false };
// Only fresh evidence can offer a suggestion; retained dates stay independent.
const rideSource = `WITH evidence AS (
  SELECT * FROM strava_activity_cache WHERE owner_id=? AND expires_at>? AND fetched_at>?
), ride_rows AS (
  SELECT h.*,a.match_json FROM strava_ride_history h LEFT JOIN evidence a
  ON a.activity_id=h.activity_id AND a.generation=h.generation WHERE h.owner_id=?
  UNION ALL
  SELECT owner_id,generation,activity_id,ridden_on,primary_route_id,decision,version,fetched_at,match_json
  FROM evidence a WHERE
  NOT EXISTS(SELECT 1 FROM strava_ride_history h WHERE h.owner_id=a.owner_id AND h.activity_id=a.activity_id))`;

export const stravaHistoryRoutes = (now: () => Date) => {
  const app = new Hono<Bindings>();
  for (const path of ['/history/*', '/connections/strava/imports'])
    app.use(path, async (c, next) => {
      if (!importsEnabled(c.env))
        throw new AppError(
          503,
          'STRAVA_IMPORT_DISABLED',
          'Strava ride importing is not available yet.',
        );
      await next();
    });
  app.get('/connections/strava/imports', async (c) => {
    const session = await c.env.ROUTES_DB.prepare(
      'SELECT initialized_at,last_scan_at,requested_after,requested_before FROM strava_import_sessions WHERE owner_id=?',
    )
      .bind(c.get('ownerId'))
      .first();
    const jobs =
      await c.env.ROUTES_DB.prepare(`SELECT COUNT(*) AS pendingJobs, COALESCE(SUM(CASE WHEN last_error IS NOT NULL THEN 1 ELSE 0 END),0) AS retryingJobs,
      MIN(due_at) AS nextAttemptAt FROM strava_import_jobs WHERE owner_id=? AND revision>completed_revision`)
        .bind(c.get('ownerId'))
        .first();
    const errors =
      await c.env.ROUTES_DB.prepare(`SELECT last_error AS code,COUNT(*) AS jobs FROM strava_import_jobs
      WHERE owner_id=? AND last_error IS NOT NULL GROUP BY last_error LIMIT 10`)
        .bind(c.get('ownerId'))
        .all();
    return c.json({
      errors: errors.results,
      connected: !!(await getConnection(c.env.ROUTES_DB, c.get('ownerId'))),
      session,
      jobs,
      cache,
      retention,
    });
  });
  app.post('/connections/strava/imports', async (c) => {
    const input = await readJsonBody(
      c,
      z.strictObject({
        after: z.iso.datetime().optional(),
        before: z.iso.datetime().optional(),
      }),
    );
    const at = now().getTime(),
      before = input.before ? Date.parse(input.before) : at,
      after = input.after ? Date.parse(input.after) : before - 90 * DAY;
    if (
      after < 0 ||
      before > at ||
      before <= after ||
      before - after > 366 * DAY ||
      Math.floor(after / 1000) >= Math.floor(before / 1000)
    )
      throw new AppError(
        400,
        'BAD_REQUEST',
        'Choose a past interval of up to 366 days.',
      );
    const connection = await getConnection(c.env.ROUTES_DB, c.get('ownerId'));
    if (!connection)
      throw new AppError(
        409,
        'STRAVA_NOT_CONNECTED',
        'Connect Strava before importing rides.',
      );
    await throttle(c.env.ROUTES_DB, `import:${c.get('ownerId')}`, 4);
    await initializeImports(c.env.ROUTES_DB, connection, at);
    if (
      !(await scheduleScan(
        c.env.ROUTES_DB,
        connection,
        Math.floor(after / 1000),
        Math.floor(before / 1000),
        at,
      ))
    )
      throw new AppError(
        409,
        'STRAVA_IMPORT_IN_PROGRESS',
        'A history import is already in progress.',
      );
    await publishImportJobs(c.env, now());
    return c.json(
      {
        accepted: true,
        after: new Date(after).toISOString(),
        before: new Date(before).toISOString(),
        cache,
        retention,
      },
      202,
    );
  });
  app.get('/history/routes', async (c) => {
    const query = validateInput(pageQuery, c.req.query()),
      cursor = decodeCursor(query.cursor);
    const rows =
      await c.env.ROUTES_DB.prepare(`SELECT a.primary_route_id AS routeId,r.name AS routeName,COUNT(*) AS rideCount,
      MAX(a.ridden_on) AS lastRiddenOn,MIN(a.ridden_on) AS firstRiddenOn
      FROM strava_ride_history a JOIN routes r ON r.owner_id=a.owner_id AND r.id=a.primary_route_id
      WHERE a.owner_id=? AND a.decision!='dismissed'
      GROUP BY a.primary_route_id HAVING (? IS NULL OR MAX(a.ridden_on)<? OR (MAX(a.ridden_on)=? AND a.primary_route_id>?))
      ORDER BY lastRiddenOn DESC,routeId LIMIT ?`)
        .bind(
          c.get('ownerId'),
          cursor?.[0] ?? null,
          cursor?.[0] ?? null,
          cursor?.[0] ?? null,
          cursor?.[1] ?? null,
          query.limit + 1,
        )
        .all<{
          routeId: string;
          routeName: string;
          rideCount: number;
          lastRiddenOn: string;
          firstRiddenOn: string;
        }>();
    const routes = await Promise.all(
      rows.results.slice(0, query.limit).map(async (r) => {
        const latest =
          await c.env.ROUTES_DB.prepare(`SELECT * FROM strava_ride_history WHERE owner_id=? AND primary_route_id=?
        AND decision!='dismissed' ORDER BY ridden_on DESC,activity_id LIMIT 1`)
            .bind(c.get('ownerId'), r.routeId)
            .first<RideHistoryRow>();
        return {
          ...r,
          mostRecentRide: latest ? presentRideDate(latest) : null,
        };
      }),
    );
    const last = routes.at(-1);
    return c.json({
      routes,
      nextCursor:
        rows.results.length > query.limit && last
          ? encodeCursor(last.lastRiddenOn, last.routeId)
          : null,
      retention,
    });
  });
  app.get('/history/routes/:routeId/rides', async (c) => {
    const id = validateInput(z.uuid(), c.req.param('routeId'));
    if (!(await createD1RouteStore(c.env.ROUTES_DB).get(c.get('ownerId'), id)))
      throw missing();
    const query = validateInput(pageQuery, c.req.query()),
      cursor = decodeCursor(query.cursor);
    const result =
      await c.env.ROUTES_DB.prepare(`SELECT * FROM strava_ride_history WHERE owner_id=? AND primary_route_id=?
      AND decision!='dismissed' AND (? IS NULL OR ridden_on<? OR (ridden_on=? AND activity_id>?))
      ORDER BY ridden_on DESC,activity_id LIMIT ?`)
        .bind(
          c.get('ownerId'),
          id,
          cursor?.[0] ?? null,
          cursor?.[0] ?? null,
          cursor?.[0] ?? null,
          cursor?.[1] ?? null,
          query.limit + 1,
        )
        .all<RideHistoryRow>();
    const rides = result.results.slice(0, query.limit).map(presentRideDate),
      last = rides.at(-1);
    return c.json({
      routeId: id,
      rides,
      nextCursor:
        result.results.length > query.limit && last
          ? encodeCursor(last.riddenOn, last.activityId)
          : null,
      retention,
    });
  });
  app.get('/history/strava-rides', async (c) => {
    const query = validateInput(
        pageQuery.extend({ status: z.enum(['review', 'all']).default('all') }),
        c.req.query(),
      ),
      cursor = decodeCursor(query.cursor),
      at = now().getTime();
    const result =
      await c.env.ROUTES_DB.prepare(`${rideSource} SELECT * FROM ride_rows
      WHERE (?='all' OR (decision='automatic' AND primary_route_id IS NULL
        AND json_extract(match_json,'$.status')='suggested'))
      AND (? IS NULL OR ridden_on<? OR (ridden_on=? AND activity_id>?)) ORDER BY ridden_on DESC,activity_id LIMIT ?`)
        .bind(
          c.get('ownerId'),
          at,
          at - FRESHNESS,
          c.get('ownerId'),
          query.status,
          cursor?.[0] ?? null,
          cursor?.[0] ?? null,
          cursor?.[0] ?? null,
          cursor?.[1] ?? null,
          query.limit + 1,
        )
        .all<RideHistoryRow>();
    const rides = result.results.slice(0, query.limit).map(presentRideDate),
      last = rides.at(-1);
    return c.json({
      rides,
      nextCursor:
        result.results.length > query.limit && last
          ? encodeCursor(last.riddenOn, last.activityId)
          : null,
      retention,
    });
  });
  app.get('/history/strava-rides/:activityId', async (c) => {
    const id = validateInput(stravaId, c.req.param('activityId')),
      at = now().getTime();
    const row = await c.env.ROUTES_DB.prepare(
      `${rideSource} SELECT * FROM ride_rows WHERE activity_id=?`,
    )
      .bind(c.get('ownerId'), at, at - FRESHNESS, c.get('ownerId'), id)
      .first<RideHistoryRow>();
    if (!row) throw missing();
    const evidence = await c.env.ROUTES_DB.prepare(
      'SELECT * FROM strava_activity_cache WHERE owner_id=? AND activity_id=? AND expires_at>? AND fetched_at>?',
    )
      .bind(c.get('ownerId'), id, at, at - FRESHNESS)
      .first<ActivityRow>();
    return c.json({
      ride: presentRideDate(row),
      evidence: evidence ? presentActivity(evidence) : null,
      retention,
      cache,
    });
  });
  app.patch('/history/strava-rides/:activityId', async (c) => {
    const id = validateInput(stravaId, c.req.param('activityId'));
    const input = await readJsonBody(
      c,
      z.strictObject({
        expectedVersion: z.number().int().positive(),
        routeId: z.uuid().nullable(),
      }),
    );
    const at = now().getTime(),
      owner = c.get('ownerId'),
      db = c.env.ROUTES_DB;
    if (
      input.routeId !== null &&
      !(await createD1RouteStore(db).get(owner, input.routeId))
    )
      throw missing();
    // One transaction preserves corrections across concurrent imports and cache expiry.
    const result = await db.batch<RideHistoryRow>([
      db
        .prepare(`${rideSource} INSERT INTO strava_ride_history(owner_id,generation,activity_id,ridden_on,primary_route_id,decision,version,verified_at)
        SELECT owner_id,generation,activity_id,ridden_on,?,?,version+1,verified_at FROM ride_rows
        WHERE activity_id=? AND version=? AND (? IS NULL OR EXISTS(SELECT 1 FROM routes WHERE owner_id=? AND id=?))
        ON CONFLICT(owner_id,activity_id) DO UPDATE SET primary_route_id=excluded.primary_route_id,decision=excluded.decision,version=excluded.version
        RETURNING *`)
        .bind(
          owner,
          at,
          at - FRESHNESS,
          owner,
          input.routeId,
          input.routeId === null ? 'dismissed' : 'confirmed',
          id,
          input.expectedVersion,
          input.routeId,
          owner,
          input.routeId,
        ),
      db
        .prepare(`UPDATE strava_activity_cache SET primary_route_id=h.primary_route_id,decision=h.decision,version=h.version,reviewed_at=?
        FROM strava_ride_history h WHERE strava_activity_cache.owner_id=h.owner_id AND strava_activity_cache.activity_id=h.activity_id
        AND h.owner_id=? AND h.activity_id=? AND h.version=? AND changes()=1`)
        .bind(at, owner, id, input.expectedVersion + 1),
    ]);
    const row = result[0]?.results[0];
    if (!row) {
      const existing = await db
        .prepare(
          `${rideSource} SELECT version FROM ride_rows WHERE activity_id=?`,
        )
        .bind(owner, at, at - FRESHNESS, owner, id)
        .first();
      if (!existing) throw missing();
      throw new AppError(
        409,
        'STRAVA_RIDE_VERSION_CONFLICT',
        'This ride changed. Reload it before saving your choice.',
      );
    }
    return c.json({ ride: presentRideDate(row), retention });
  });
  return app;
};
