import type { Env } from '../types.ts';
import { experienceSchema } from './experience.ts';
import {
  collectRideWeather,
  DAY,
  evidenceSchema,
  weatherRouteSchema,
} from './historical-weather.ts';
import {
  evaluateLearning,
  type LearningExample,
  learnComfort,
} from './learning.ts';

export const learningSettings = async (db: D1Database, owner: string) =>
  (await db
    .prepare(
      'SELECT enabled, reset_at, version FROM ride_learning_settings WHERE owner_id = ?',
    )
    .bind(owner)
    .first<{ enabled: number; reset_at: string; version: number }>()) ?? {
    enabled: 1,
    reset_at: '',
    version: 0,
  };
export const readLearning = async (db: D1Database, owner: string) => {
  // One transactional snapshot, including preference/reset and evidence revisions.
  const result = await db.batch<Record<string, unknown>>([
    db
      .prepare(
        'SELECT enabled, reset_at, version FROM ride_learning_settings WHERE owner_id = ?',
      )
      .bind(owner),
    db
      .prepare(`SELECT r.id, r.experience_json, w.evidence_json FROM rides r JOIN ride_weather w ON w.owner_id = r.owner_id AND w.ride_id = r.id
      WHERE r.owner_id = ? AND w.experience_version = r.experience_version AND w.status = 'ready' AND r.experience_json IS NOT NULL
      AND json_extract(r.experience_json, '$.firstSubmittedAt') > COALESCE((SELECT reset_at FROM ride_learning_settings WHERE owner_id = ?), '')
      ORDER BY COALESCE(json_extract(r.experience_json, '$.timing.startedAt'), r.ridden_on), r.id LIMIT 501`)
      .bind(owner, owner),
  ]);
  const settings = result[0]?.results[0] as
    | { enabled: number; reset_at: string; version: number }
    | undefined;
  const enabled = settings?.enabled !== 0;
  const limitExceeded = (result[1]?.results.length ?? 0) > 500;
  const examples: LearningExample[] = [];
  if (enabled && !limitExceeded)
    for (const row of result[1]?.results ?? []) {
      const experience = experienceSchema.parse(
        JSON.parse(String(row.experience_json)),
      );
      const evidence = evidenceSchema.parse(
        JSON.parse(String(row.evidence_json)),
      );
      if (evidence.features)
        examples.push({
          experience,
          features: evidence.features,
          quality: evidence.quality,
          baseline: evidence.baselineComfort,
        });
    }
  return {
    ...learnComfort(examples),
    evaluation: evaluateLearning(examples),
    enabled,
    settingsVersion: settings?.version ?? 0,
    resetAt: settings?.reset_at || null,
    status: !enabled
      ? 'disabled'
      : limitExceeded
        ? 'assessment-limit'
        : 'assessed',
  };
};

/** Durable D1 work record + expiring lease. waitUntil is an accelerator; the
 * scheduled drain retries abandoned leases and delayed reanalysis. */
export const enrichRide = async (
  env: Env,
  owner: string,
  id: string,
  now: Date,
) => {
  if (env.RIDE_LEARNING_WEATHER_MODE !== 'non-commercial') return;
  const settings = await learningSettings(env.ROUTES_DB, owner);
  if (!settings.enabled) return;
  const db = env.ROUTES_DB;
  const token = crypto.randomUUID();
  const job = await db
    .prepare(`UPDATE ride_weather SET token = ?, lease_until = ?, status = 'processing', attempts = attempts + 1
    WHERE owner_id = ? AND ride_id = ? AND lease_until <= ? AND next_attempt_at <= ? AND attempts < 3
    AND status IN ('pending', 'processing', 'ready') RETURNING experience_version, attempts`)
    .bind(
      token,
      now.getTime() + 60_000,
      owner,
      id,
      now.getTime(),
      now.getTime(),
    )
    .first<{ experience_version: number; attempts: number }>();
  if (!job) return;
  const finish = async (
    status: string,
    reason: string | null,
    evidence: unknown = null,
    next = 0,
    resetAttempts = false,
  ) => {
    await db
      .prepare(`UPDATE ride_weather SET status = ?, reason = ?, evidence_json = ?, next_attempt_at = ?, lease_until = 0, token = NULL, attempts = CASE WHEN ? THEN 0 ELSE attempts END
      WHERE owner_id = ? AND ride_id = ? AND token = ? AND experience_version = ?`)
      .bind(
        status,
        reason,
        evidence ? JSON.stringify(evidence) : null,
        next,
        resetAttempts ? 1 : 0,
        owner,
        id,
        token,
        job.experience_version,
      )
      .run();
  };
  try {
    const row = await db
      .prepare(
        'SELECT experience_json, weather_route_json FROM rides WHERE owner_id = ? AND id = ? AND experience_version = ?',
      )
      .bind(owner, id, job.experience_version)
      .first<{
        experience_json: string | null;
        weather_route_json: string | null;
      }>();
    if (!row) return;
    const experience = row.experience_json
      ? experienceSchema.parse(JSON.parse(row.experience_json))
      : null;
    if (!experience?.feedback?.includeInLearning)
      return await finish('unavailable', 'not-included');
    if (!experience.timing)
      return await finish('unavailable', 'timing-required');
    if (experience.timing.routeFollowed !== 'yes')
      return await finish('unavailable', 'route-not-confirmed');
    if (!row.weather_route_json)
      return await finish('unavailable', 'route-snapshot-unavailable');
    const end = Date.parse(experience.timing.finishedAt);
    // Never query an unfinished accumulation interval.
    if (end > Math.floor(now.getTime() / 3_600_000) * 3_600_000)
      return await finish(
        'pending',
        'waiting-for-completed-hour',
        null,
        Math.ceil(end / 3_600_000) * 3_600_000,
        true,
      );
    const evidence = await collectRideWeather(
      db,
      weatherRouteSchema.parse(JSON.parse(row.weather_route_json)),
      experience.timing,
      now,
      experience.preferenceSnapshot,
    );
    if (!evidence.features) {
      return await finish(
        job.attempts < 3 ? 'pending' : 'unavailable',
        'incomplete-weather',
        evidence,
        now.getTime() + DAY,
      );
    }
    await finish(
      'ready',
      evidence.model === 'ecmwf_ifs' ? 'reanalysis-pending' : null,
      evidence,
      evidence.model === 'ecmwf_ifs' ? end + 6 * DAY : Number.MAX_SAFE_INTEGER,
      true,
    );
  } catch (error) {
    const known =
      error instanceof Error &&
      ['sampling-limit', 'budget-exhausted', 'geometry-unavailable'].includes(
        error.message,
      )
        ? error.message
        : 'provider-unavailable';
    await finish(
      job.attempts < 3 && known !== 'sampling-limit'
        ? 'pending'
        : 'unavailable',
      known,
      null,
      now.getTime() + DAY,
    );
  }
};

export const drainRideWeather = async (env: Env, now = new Date()) => {
  if (env.RIDE_LEARNING_WEATHER_MODE === 'non-commercial') {
    await env.ROUTES_DB.prepare(
      "UPDATE ride_weather SET status = 'unavailable', reason = 'retry-exhausted', token = NULL, lease_until = 0 WHERE status = 'processing' AND attempts >= 3 AND lease_until <= ?",
    )
      .bind(now.getTime())
      .run();
    const rows =
      await env.ROUTES_DB.prepare(`SELECT w.owner_id, w.ride_id FROM ride_weather w
    WHERE w.status IN ('pending', 'processing', 'ready') AND w.next_attempt_at <= ? AND w.lease_until <= ? AND w.attempts < 3
    AND COALESCE((SELECT enabled FROM ride_learning_settings s WHERE s.owner_id = w.owner_id), 1) = 1
    ORDER BY w.next_attempt_at LIMIT 8`)
        .bind(now.getTime(), now.getTime())
        .all<{ owner_id: string; ride_id: string }>();
    for (const row of rows.results)
      await enrichRide(env, row.owner_id, row.ride_id, now);
  }
  await env.ROUTES_DB.batch([
    env.ROUTES_DB.prepare(
      'DELETE FROM ride_weather_cache WHERE expires_at < ?',
    ).bind(now.getTime()),
    env.ROUTES_DB.prepare('DELETE FROM ride_weather_usage WHERE date < ?').bind(
      new Date(now.getTime() - 90 * DAY).toISOString().slice(0, 10),
    ),
    env.ROUTES_DB.prepare(
      'DELETE FROM recommendation_snapshots WHERE created_at < ? AND NOT EXISTS (SELECT 1 FROM rides r WHERE r.owner_id = recommendation_snapshots.owner_id AND r.recommendation_id = recommendation_snapshots.id)',
    ).bind(new Date(now.getTime() - 90 * DAY).toISOString()),
  ]);
};
