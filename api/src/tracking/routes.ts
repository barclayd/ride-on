import { Hono } from 'hono';
import { z } from 'zod';
import { AppError } from '../errors.ts';
import { monitoringCapabilities } from '../monitoring/routes.ts';
import type { ComparisonContext } from '../recommendations/service.ts';
import { readJsonBody, validateInput } from '../request.ts';
import type { RouteStore } from '../routes/store.ts';
import type { Bindings, Env } from '../types.ts';
import type { UserStore } from '../users/model.ts';
import type { Snapshot } from './model.ts';
import { refreshTracking } from './refresh.ts';
import {
  accountTracking,
  createTracking,
  createTrackingSchema,
  editTracking,
  editTrackingSchema,
  getTracking,
  publicTracking,
  stopTracking,
  type TrackingRow,
  trackingNotFound,
} from './store.ts';

const pageSchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(20).default(10),
  cursor: z.string().max(1024).optional(),
});
const readCursor = (cursor: string | undefined, filter: string) => {
  if (!cursor) return null;
  try {
    const parsed = z
      .strictObject({ at: z.iso.datetime(), id: z.uuid(), filter: z.string() })
      .parse(JSON.parse(atob(cursor)));
    if (parsed.filter !== filter) throw new Error('Different filters');
    return parsed;
  } catch {
    throw new AppError(
      400,
      'INVALID_CURSOR',
      'Use the returned cursor with the same filters.',
    );
  }
};
export const trackingRoutes = (
  now: () => Date,
  routes: (env: Env) => RouteStore,
  users: (env: Env) => UserStore,
  dependencies: ComparisonContext['dependencies'],
) => {
  const app = new Hono<Bindings>();
  app.post('/tracked-rides', async (c) => {
    const key = validateInput(z.uuid(), c.req.header('Idempotency-Key'));
    const input = validateInput(
      createTrackingSchema,
      await readJsonBody(c, z.unknown()),
      'VALIDATION',
    );
    const owner = c.get('ownerId');
    const result = await createTracking(
      c.env.ROUTES_DB,
      owner,
      key,
      input,
      now().toISOString(),
    );
    let row = result.row;
    if (result.created) {
      try {
        row = await refreshTracking(
          row.id,
          {
            env: c.env,
            ownerId: owner,
            signal: c.req.raw.signal,
            now,
            startedAt: now(),
            dependencies,
          },
          routes(c.env),
          users(c.env),
        );
      } catch {
        const current = await getTracking(c.env.ROUTES_DB, owner, row.id);
        if (!current) throw trackingNotFound();
        row = current;
      }
    }
    c.header('Location', `/tracked-rides/${row.id}`);
    return c.json(
      {
        ride: publicTracking(
          row,
          now().toISOString(),
          monitoringCapabilities(c.env),
        ),
        outcome: result.outcome,
        replayed: result.replayed,
        replacedTrackedRideId: result.replacedId,
        ...(await accountTracking(c.env.ROUTES_DB, owner, now().toISOString())),
      },
      result.created ? 201 : 200,
    );
  });
  app.get('/tracked-rides', async (c) => {
    const query = validateInput(
      pageSchema.extend({
        state: z.enum(['active', 'inactive', 'all']).default('active'),
        routeId: z.uuid().optional(),
      }),
      c.req.query(),
    );
    const filter = JSON.stringify([query.state, query.routeId ?? null]);
    const cursor = readCursor(query.cursor, filter);
    const owner = c.get('ownerId'),
      at = now().toISOString();
    const clauses = ['p.owner_id = ?'];
    const values: (string | number)[] = [owner];
    if (query.state !== 'all') {
      clauses.push(
        query.state === 'active'
          ? "(p.state = 'active' AND p.finish_at > ?)"
          : "(p.state = 'inactive' OR p.finish_at <= ?)",
      );
      values.push(at);
    }
    if (query.routeId) {
      clauses.push('p.route_id = ?');
      values.push(query.routeId);
    }
    if (cursor) {
      clauses.push('(p.created_at < ? OR (p.created_at = ? AND p.id > ?))');
      values.push(cursor.at, cursor.at, cursor.id);
    }
    const found = await c.env.ROUTES_DB.prepare(
      `SELECT p.*, a.assessment_json AS latest_json FROM tracked_rides p
         LEFT JOIN tracking_assessments a ON a.owner_id = p.owner_id AND a.plan_id = p.id AND a.id = p.latest_id
         WHERE ${clauses.join(' AND ')} ORDER BY p.created_at DESC,p.id LIMIT ?`,
    )
      .bind(...values, query.limit + 1)
      .all<TrackingRow>();
    const rows = found.results.slice(0, query.limit),
      last = rows.at(-1);
    return c.json({
      rides: rows.map((row) => {
        const ride = publicTracking(row, at, monitoringCapabilities(c.env));
        return {
          id: ride.id,
          routeId: ride.routeId,
          departureAt: ride.departureAt,
          finishAt: ride.finishAt,
          timeZone: ride.timeZone,
          state: ride.state,
          endedAt: ride.endedAt,
          endedReason: ride.endedReason,
          createdAt: ride.createdAt,
          version: ride.version,
          alerts: ride.alerts,
          originalScore: ride.baseline.pick.candidate.score,
          refresh: ride.refresh,
        };
      }),
      ...(await accountTracking(c.env.ROUTES_DB, owner, at)),
      capabilities: monitoringCapabilities(c.env),
      nextCursor:
        found.results.length > query.limit && last
          ? btoa(JSON.stringify({ at: last.created_at, id: last.id, filter }))
          : null,
    });
  });
  app.get('/tracked-rides/:id', async (c) => {
    const row = await getTracking(
      c.env.ROUTES_DB,
      c.get('ownerId'),
      validateInput(z.uuid(), c.req.param('id')),
    );
    if (!row) throw trackingNotFound();
    return c.json({
      ride: publicTracking(
        row,
        now().toISOString(),
        monitoringCapabilities(c.env),
      ),
      ...(await accountTracking(
        c.env.ROUTES_DB,
        c.get('ownerId'),
        now().toISOString(),
      )),
    });
  });
  app.patch('/tracked-rides/:id', async (c) => {
    const id = validateInput(z.uuid(), c.req.param('id'));
    const input = validateInput(
      editTrackingSchema,
      await readJsonBody(c, z.unknown()),
      'VALIDATION',
    );
    const owner = c.get('ownerId');
    const at = now().toISOString();
    const row = await editTracking(c.env.ROUTES_DB, owner, id, input, at);
    return c.json({
      ride: publicTracking(row, at, monitoringCapabilities(c.env)),
      ...(await accountTracking(c.env.ROUTES_DB, owner, at)),
    });
  });
  app.post('/tracked-rides/:id/refresh', async (c) => {
    const id = validateInput(z.uuid(), c.req.param('id'));
    const row = await refreshTracking(
      id,
      {
        env: c.env,
        ownerId: c.get('ownerId'),
        signal: c.req.raw.signal,
        now,
        startedAt: now(),
        dependencies,
      },
      routes(c.env),
      users(c.env),
    );
    return c.json({
      ride: publicTracking(
        row,
        now().toISOString(),
        monitoringCapabilities(c.env),
      ),
      ...(await accountTracking(
        c.env.ROUTES_DB,
        c.get('ownerId'),
        now().toISOString(),
      )),
    });
  });
  app.get('/tracked-rides/:id/assessments', async (c) => {
    const owner = c.get('ownerId'),
      id = validateInput(z.uuid(), c.req.param('id'));
    if (!(await getTracking(c.env.ROUTES_DB, owner, id)))
      throw trackingNotFound();
    const query = validateInput(pageSchema, c.req.query()),
      cursor = readCursor(query.cursor, id);
    const result =
      await c.env.ROUTES_DB.prepare(`SELECT id,created_at,assessment_json FROM tracking_assessments WHERE owner_id = ? AND plan_id = ?
      ${cursor ? 'AND (created_at < ? OR (created_at = ? AND id > ?))' : ''} ORDER BY created_at DESC,id LIMIT ?`)
        .bind(
          owner,
          id,
          ...(cursor ? [cursor.at, cursor.at, cursor.id] : []),
          query.limit + 1,
        )
        .all<{ id: string; created_at: string; assessment_json: string }>();
    const rows = result.results.slice(0, query.limit),
      last = rows.at(-1);
    return c.json({
      assessments: rows.map((r) => ({
        id: r.id,
        createdAt: r.created_at,
        assessment: JSON.parse(r.assessment_json) as Snapshot,
      })),
      nextCursor:
        result.results.length > query.limit && last
          ? btoa(
              JSON.stringify({ at: last.created_at, id: last.id, filter: id }),
            )
          : null,
    });
  });
  app.delete('/tracked-rides/:id', async (c) => {
    const id = validateInput(z.uuid(), c.req.param('id'));
    const query = validateInput(
      z.strictObject({ permanent: z.enum(['true', 'false']).default('false') }),
      c.req.query(),
    );
    await stopTracking(
      c.env.ROUTES_DB,
      c.get('ownerId'),
      id,
      now().toISOString(),
      query.permanent === 'true',
    );
    return c.body(null, 204);
  });
  return app;
};
