import { Hono } from 'hono';
import { z } from 'zod';
import { AppError } from '../errors.ts';
import { readJsonBody, validateInput } from '../request.ts';
import type { Bindings } from '../types.ts';
import { createD1UserStore } from '../users/model.ts';
import {
  experienceInputSchema,
  experienceSchema,
  resolveExperience,
} from './experience.ts';
import { evidenceSchema } from './historical-weather.ts';
import { enrichRide, readLearning } from './learning-service.ts';
import { getRide, publicRide } from './store.ts';

export const experienceRoutes = (now: () => Date) => {
  const app = new Hono<Bindings>();
  app.get('/rides/:id/weather', async (c) => {
    const id = validateInput(z.uuid(), c.req.param('id'));
    if (!(await getRide(c.env.ROUTES_DB, c.get('ownerId'), id)))
      throw new AppError(404, 'RIDE_NOT_FOUND', 'The ride was not found.');
    const row = await c.env.ROUTES_DB.prepare(
      'SELECT status, reason, evidence_json, experience_version FROM ride_weather WHERE owner_id = ? AND ride_id = ?',
    )
      .bind(c.get('ownerId'), id)
      .first<{
        status: string;
        reason: string | null;
        evidence_json: string | null;
        experience_version: number;
      }>();
    return c.json({
      status: row?.status ?? 'not-requested',
      reason: row?.reason ?? null,
      experienceVersion: row?.experience_version ?? null,
      evidence: row?.evidence_json
        ? evidenceSchema.parse(JSON.parse(row.evidence_json))
        : null,
    });
  });
  app.get('/recommendations/:id', async (c) => {
    const id = validateInput(z.uuid(), c.req.param('id'));
    const row = await c.env.ROUTES_DB.prepare(
      'SELECT created_at, snapshot_json FROM recommendation_snapshots WHERE owner_id = ? AND id = ?',
    )
      .bind(c.get('ownerId'), id)
      .first<{ created_at: string; snapshot_json: string }>();
    if (!row)
      throw new AppError(
        404,
        'RECOMMENDATION_NOT_FOUND',
        'The recommendation was not found.',
      );
    return c.json({
      id,
      generatedAt: row.created_at,
      source: 'server',
      snapshot: JSON.parse(row.snapshot_json),
    });
  });
  app.put('/rides/:id/experience', async (c) => {
    const id = validateInput(z.uuid(), c.req.param('id'));
    const input = await readJsonBody(c, experienceInputSchema);
    const owner = c.get('ownerId');
    const db = c.env.ROUTES_DB;
    const row = await getRide(db, owner, id);
    if (!row)
      throw new AppError(404, 'RIDE_NOT_FOUND', 'The ride was not found.');
    const timestamp = now();
    const previous = row.experience_json
      ? experienceSchema.parse(JSON.parse(row.experience_json))
      : null;
    const user = previous ? null : await createD1UserStore(db).get(owner);
    const experience = resolveExperience(
      input,
      row,
      timestamp,
      previous,
      user?.settings.preferences,
    );
    // An identical PUT retried after a lost response is a no-op, never another
    // learning observation or an enrichment restart.
    const sameContent =
      JSON.stringify(previous?.timing ?? null) ===
        JSON.stringify(experience.timing) &&
      JSON.stringify(previous?.feedback ?? null) ===
        JSON.stringify(experience.feedback);
    if (
      row.version === input.expectedRideVersion &&
      row.experience_version === input.expectedVersion + 1 &&
      sameContent
    )
      return c.json({
        ride: publicRide(row),
        learningMode: 'shadow',
        scoringApplied: false,
      });
    const updated = await db
      .prepare(`UPDATE rides SET experience_json = ?, experience_version = experience_version + 1
      WHERE owner_id = ? AND id = ? AND version = ? AND experience_version = ? RETURNING id`)
      .bind(
        input.feedback === null && input.timing === null
          ? null
          : JSON.stringify(experience),
        owner,
        id,
        input.expectedRideVersion,
        input.expectedVersion,
      )
      .first();
    if (!updated)
      throw new AppError(
        409,
        'EXPERIENCE_VERSION_CONFLICT',
        'This ride or its feedback changed on another device. Refresh and try again.',
      );
    c.executionCtx.waitUntil(
      enrichRide(c.env, owner, id, timestamp).catch(() => {}),
    );
    const ride = await getRide(db, owner, id);
    if (!ride)
      throw new AppError(404, 'RIDE_NOT_FOUND', 'The ride was removed.');
    return c.json({
      ride: publicRide(ride),
      learningMode: 'shadow',
      scoringApplied: false,
    });
  });
  app.get('/users/me/learning', async (c) =>
    c.json(await readLearning(c.env.ROUTES_DB, c.get('ownerId'))),
  );
  app.patch('/users/me/learning', async (c) => {
    const input = await readJsonBody(
      c,
      z.strictObject({
        expectedVersion: z.number().int().nonnegative(),
        enabled: z.boolean(),
        reset: z.boolean().default(false),
      }),
    );
    const row =
      await c.env.ROUTES_DB.prepare(`INSERT INTO ride_learning_settings(owner_id, enabled, reset_at, version)
      SELECT ?, ?, ?, 1 WHERE ? = 0
      ON CONFLICT(owner_id) DO UPDATE SET enabled = excluded.enabled, reset_at = CASE WHEN ? THEN ? ELSE reset_at END, version = version + 1
      WHERE version = ? RETURNING version`)
        .bind(
          c.get('ownerId'),
          input.enabled ? 1 : 0,
          input.reset ? now().toISOString() : '',
          input.expectedVersion,
          input.reset ? 1 : 0,
          now().toISOString(),
          input.expectedVersion,
        )
        .first();
    // Existing rows require a separate CAS path (INSERT SELECT intentionally ignores nonzero versions).
    const updated =
      row ??
      (input.expectedVersion > 0
        ? await c.env.ROUTES_DB.prepare(
            'UPDATE ride_learning_settings SET enabled = ?, reset_at = CASE WHEN ? THEN ? ELSE reset_at END, version = version + 1 WHERE owner_id = ? AND version = ? RETURNING version',
          )
            .bind(
              input.enabled ? 1 : 0,
              input.reset ? 1 : 0,
              now().toISOString(),
              c.get('ownerId'),
              input.expectedVersion,
            )
            .first()
        : null);
    if (!updated)
      throw new AppError(
        409,
        'LEARNING_VERSION_CONFLICT',
        'Tailored Rides changed on another device. Refresh and try again.',
      );
    return c.json(await readLearning(c.env.ROUTES_DB, c.get('ownerId')));
  });
  return app;
};
