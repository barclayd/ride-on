import { Temporal } from '@js-temporal/polyfill';
import { Hono } from 'hono';
import { z } from 'zod';
import { AppError } from '../errors.ts';
import { readJsonBody, validateInput } from '../request.ts';
import { importGpx } from '../routes/gpx.ts';
import type { Bindings } from '../types.ts';
import {
  correctRideSchema,
  createRide,
  createRideSchema,
  getRide,
  listRides,
  publicRide,
  rideDate,
} from './store.ts';

const notFound = () =>
  new AppError(404, 'RIDE_NOT_FOUND', 'The ride was not found.');
const checkDate = (date: string, zone: string, now: Date) => {
  const today = Temporal.Instant.from(now.toISOString())
    .toZonedDateTimeISO(zone)
    .toPlainDate();
  if (Temporal.PlainDate.compare(date, today) > 0)
    throw new AppError(400, 'FUTURE_RIDE', 'Choose today or a past date.');
};
export const rideRoutes = (now: () => Date) => {
  const app = new Hono<Bindings>();
  app.post('/rides', async (c) => {
    const key = validateInput(z.uuid(), c.req.header('Idempotency-Key'));
    const input = await readJsonBody(c, createRideSchema);
    const timestamp = now();
    checkDate(input.riddenOn, input.timeZone, timestamp);
    const hash = Array.from(
      new Uint8Array(
        await crypto.subtle.digest(
          'SHA-256',
          new TextEncoder().encode(JSON.stringify(input)),
        ),
      ),
      (b) => b.toString(16).padStart(2, '0'),
    ).join('');
    const result = await createRide(
      c.env.ROUTES_DB,
      c.get('ownerId'),
      key,
      hash,
      input,
      timestamp.toISOString(),
    );
    if (result.deleted)
      throw new AppError(
        409,
        'RIDE_UNDONE',
        'This logging action was undone. Use a new idempotency key for a new ride.',
      );
    if (!result.row)
      throw result.routeExists
        ? new AppError(
            409,
            'ROUTE_VERSION_CONFLICT',
            'Read the current route version before recording a ride.',
          )
        : new AppError(404, 'ROUTE_NOT_FOUND', 'The route was not found.');
    if (result.row.request_hash !== hash)
      throw new AppError(
        409,
        'IDEMPOTENCY_CONFLICT',
        'This key was used for another logging action.',
      );
    c.header('Location', `/rides/${result.row.id}`);
    return c.json(
      { ride: publicRide(result.row), replayed: !result.created },
      result.created ? 201 : 200,
    );
  });
  app.get('/rides', async (c) => {
    const query = validateInput(
      z.strictObject({
        limit: z.coerce.number().int().min(1).max(100).default(50),
        routeId: z.uuid().optional(),
        cursor: z.string().max(512).optional(),
      }),
      c.req.query(),
    );
    let cursor: { date: string; id: string } | undefined;
    if (query.cursor) {
      try {
        const parsed = z
          .strictObject({
            date: rideDate,
            id: z.uuid(),
            routeId: z.uuid().nullable(),
          })
          .parse(JSON.parse(atob(query.cursor)));
        if (parsed.routeId !== (query.routeId ?? null))
          throw new Error('Filter mismatch');
        cursor = parsed;
      } catch {
        throw new AppError(
          400,
          'INVALID_CURSOR',
          'Use the returned cursor with the same filters.',
        );
      }
    }
    return c.json({
      ...(await listRides(
        c.env.ROUTES_DB,
        c.get('ownerId'),
        query.limit,
        query.routeId,
        cursor,
      )),
      limit: query.limit,
    });
  });
  app.get('/rides/:id', async (c) => {
    const row = await getRide(
      c.env.ROUTES_DB,
      c.get('ownerId'),
      validateInput(z.uuid(), c.req.param('id')),
    );
    if (!row) throw notFound();
    return c.json({ ride: publicRide(row) });
  });
  app.patch('/rides/:id', async (c) => {
    const id = validateInput(z.uuid(), c.req.param('id'));
    const input = await readJsonBody(c, correctRideSchema);
    const timestamp = now();
    checkDate(input.riddenOn, input.timeZone, timestamp);
    const results = await c.env.ROUTES_DB.batch([
      c.env.ROUTES_DB.prepare(`UPDATE rides SET ridden_on = ?, time_zone = ?, version = version + 1, updated_at = ?
        WHERE owner_id = ? AND id = ? AND version = ?
        RETURNING *, (source_hash IN (SELECT source_hash FROM ride_geometries WHERE owner_id = ?)) AS geometry_available`).bind(
        input.riddenOn,
        input.timeZone,
        timestamp.toISOString(),
        c.get('ownerId'),
        id,
        input.expectedVersion,
        c.get('ownerId'),
      ),
      c.env.ROUTES_DB.prepare(
        'SELECT id FROM rides WHERE owner_id = ? AND id = ?',
      ).bind(c.get('ownerId'), id),
    ]);
    if (!results[1]?.results.length) throw notFound();
    if (!results[0]?.results.length)
      throw new AppError(
        409,
        'RIDE_VERSION_CONFLICT',
        'Read the current ride before correcting it.',
      );
    const row = results[0]?.results[0] as Parameters<typeof publicRide>[0];
    return c.json({ ride: publicRide(row) });
  });
  app.put('/rides/:id/geometry', async (c) => {
    const id = validateInput(z.uuid(), c.req.param('id'));
    const input = await readJsonBody(
      c,
      z.strictObject({
        expectedVersion: z.number().int().positive(),
        gpx: z.string().min(1),
      }),
      6_000_000,
    );
    const row = await getRide(c.env.ROUTES_DB, c.get('ownerId'), id);
    if (!row) throw notFound();
    if (row.version !== input.expectedVersion)
      throw new AppError(
        409,
        'RIDE_VERSION_CONFLICT',
        'Read the current ride before enriching geometry.',
      );
    const parsed = await importGpx(input.gpx);
    if (parsed.sourceHash !== row.source_hash)
      throw new AppError(
        409,
        'ROUTE_CONTENT_MISMATCH',
        'Supply the exact GPX version recorded for this ride.',
      );
    if (!parsed.geometry)
      throw new AppError(
        422,
        'GEOMETRY_UNAVAILABLE',
        'This GPX is too sparse or large for overlap assessment.',
      );
    const result = await c.env.ROUTES_DB.batch<{ version: number }>([
      c.env.ROUTES_DB.prepare(`INSERT INTO ride_geometries (owner_id, source_hash, geometry_json)
        SELECT owner_id, source_hash, ? FROM rides WHERE owner_id = ? AND id = ? AND version = ?
        ON CONFLICT DO NOTHING`).bind(
        JSON.stringify(parsed.geometry),
        c.get('ownerId'),
        id,
        input.expectedVersion,
      ),
      c.env.ROUTES_DB.prepare(
        'SELECT version FROM rides WHERE owner_id = ? AND id = ?',
      ).bind(c.get('ownerId'), id),
    ]);
    if (!result[1]?.results.length) throw notFound();
    if (result[1].results[0]?.version !== input.expectedVersion)
      throw new AppError(
        409,
        'RIDE_VERSION_CONFLICT',
        'The ride changed during enrichment.',
      );
    return c.json({ ride: publicRide({ ...row, geometry_available: 1 }) });
  });
  app.delete('/rides/:id', async (c) => {
    const id = validateInput(z.uuid(), c.req.param('id'));
    await c.env.ROUTES_DB.prepare(
      'DELETE FROM rides WHERE owner_id = ? AND id = ?',
    )
      .bind(c.get('ownerId'), id)
      .run();
    return c.body(null, 204);
  });
  return app;
};
