import { z } from 'zod';
import { AppError } from '../errors.ts';
import { compareTracking } from './comparison.ts';
import { boundedJson, capabilities, digest, type Snapshot } from './model.ts';

export const createTrackingSchema = z.strictObject({
  recommendationRef: z.uuid(),
  expectedTrackingVersion: z
    .number()
    .int()
    .min(0)
    .max(Number.MAX_SAFE_INTEGER - 2),
  replaceTrackedRideId: z.uuid().nullable().default(null),
});
export type TrackingRow = {
  owner_id: string;
  id: string;
  route_id: string;
  departure_at: string;
  finish_at: string;
  time_zone: string;
  created_at: string;
  state: 'active' | 'inactive';
  ended_at: string | null;
  ended_reason: string | null;
  version: number;
  baseline_json: string;
  latest_id: string | null;
  latest_json: string | null;
  last_attempt_at: string | null;
  last_success_at: string | null;
  refresh_result: string;
  refresh_reason: string | null;
  lease_token: string | null;
  lease_until: string | null;
};
type Action = {
  request_hash: string;
  plan_id: string;
  outcome: string;
  replaced_id: string | null;
};
export const trackingNotFound = () =>
  new AppError(
    404,
    'TRACKED_RIDE_NOT_FOUND',
    'The tracked ride was not found.',
  );
const conflict = () =>
  new AppError(
    409,
    'TRACKING_VERSION_CONFLICT',
    'Reload the current tracked ride and tracking version before retrying.',
  );
export const getTracking = (db: D1Database, owner: string, id: string) =>
  db
    .prepare(`SELECT p.*, a.assessment_json AS latest_json
  FROM tracked_rides p LEFT JOIN tracking_assessments a ON a.owner_id = p.owner_id AND a.plan_id = p.id AND a.id = p.latest_id
  WHERE p.owner_id = ? AND p.id = ?`)
    .bind(owner, id)
    .first<TrackingRow>();
export const isActive = (row: TrackingRow, now: string) =>
  row.state === 'active' && row.finish_at > now;
export const publicTracking = (row: TrackingRow, now: string) => {
  const baseline = JSON.parse(row.baseline_json) as Snapshot;
  const latest = row.latest_json
    ? (JSON.parse(row.latest_json) as Snapshot)
    : null;
  const expired = row.state === 'active' && row.finish_at <= now;
  const interrupted =
    row.refresh_result === 'checking' &&
    (!row.lease_until || row.lease_until <= now);
  const comparison = latest ? compareTracking(baseline, latest) : null;
  const successful =
    row.refresh_result === 'assessed' &&
    !!latest?.context.assessmentFreshUntil &&
    latest.context.assessmentFreshUntil > now &&
    !(row.lease_until && row.lease_until > now);
  return {
    id: row.id,
    routeId: row.route_id,
    departureAt: row.departure_at,
    finishAt: row.finish_at,
    timeZone: row.time_zone,
    createdAt: row.created_at,
    state: expired ? 'inactive' : row.state,
    endedAt: expired ? row.finish_at : row.ended_at,
    endedReason: expired ? 'expired' : row.ended_reason,
    version: row.version,
    baseline,
    latestAssessment: latest,
    latestAssessmentKind: latest
      ? successful
        ? 'current'
        : 'last_known'
      : null,
    comparison: successful ? comparison : null,
    lastKnownComparison: comparison
      ? { asOf: latest?.context.generatedAt, comparison }
      : null,
    refresh: {
      result:
        row.lease_until && row.lease_until > now
          ? 'in_progress'
          : interrupted
            ? 'unavailable'
            : row.refresh_result,
      reasonCode: interrupted ? 'refresh_interrupted' : row.refresh_reason,
      lastAttemptAt: row.last_attempt_at,
      lastSuccessfulAssessmentAt: row.last_success_at,
      refreshAt: latest?.context.weather.refreshAt ?? null,
      assessmentFreshUntil: latest?.context.assessmentFreshUntil ?? null,
      closed: row.departure_at <= now || !isActive(row, now),
    },
    capabilities,
  };
};
export const accountTracking = async (
  db: D1Database,
  owner: string,
  now: string,
) => {
  const account = await db
    .prepare(`SELECT a.version, p.id, p.finish_at FROM tracking_accounts a
    LEFT JOIN tracked_rides p ON p.owner_id = a.owner_id AND p.id = a.active_id WHERE a.owner_id = ?`)
    .bind(owner)
    .first<{ version: number; id: string | null; finish_at: string | null }>();
  const expired = !!account?.finish_at && account.finish_at <= now;
  return {
    trackingVersion: (account?.version ?? 0) + Number(expired),
    activeTrackedRideId: expired ? null : (account?.id ?? null),
  };
};
export const expireTracking = (db: D1Database, owner: string, now: string) =>
  db
    .prepare(`UPDATE tracked_rides
  SET state = 'inactive', ended_at = finish_at, ended_reason = 'expired', version = version + 1, lease_token = NULL, lease_until = NULL
  WHERE owner_id = ? AND state = 'active' AND finish_at <= ?`)
    .bind(owner, now);
const findAction = (db: D1Database, owner: string, key: string) =>
  db
    .prepare(
      'SELECT request_hash, plan_id, outcome, replaced_id FROM tracking_actions WHERE owner_id = ? AND action_key = ?',
    )
    .bind(owner, key)
    .first<Action>();
const replay = async (
  db: D1Database,
  owner: string,
  action: Action,
  hash: string,
) => {
  if (action.request_hash !== hash)
    throw new AppError(
      409,
      'IDEMPOTENCY_CONFLICT',
      'This key was used for a different tracking action.',
    );
  const row = await getTracking(db, owner, action.plan_id);
  if (!row)
    throw new AppError(
      409,
      'TRACKING_ERASED',
      'This tracking action was erased. Use a new key for a new action.',
    );
  return {
    row,
    outcome: action.outcome,
    replacedId: action.replaced_id,
    replayed: true,
    created: false,
  };
};
export const createTracking = async (
  db: D1Database,
  owner: string,
  key: string,
  input: z.infer<typeof createTrackingSchema>,
  now: string,
) => {
  const hash = await digest(input);
  const previous = await findAction(db, owner, key);
  if (previous) return replay(db, owner, previous, hash);
  const reference = await db
    .prepare(`SELECT r.candidate_json, c.context_json FROM tracking_recommendations r
    JOIN tracking_contexts c ON c.owner_id = r.owner_id AND c.id = r.context_id
    WHERE r.owner_id = ? AND r.id = ? AND r.departure_at > ? AND c.expires_at > ?`)
    .bind(owner, input.recommendationRef, now, now)
    .first<{ candidate_json: string; context_json: string }>();
  if (!reference)
    throw new AppError(
      422,
      'RECOMMENDATION_UNAVAILABLE',
      'Request a current recommendation before tracking this ride.',
    );
  const baseline: Snapshot = {
    context: JSON.parse(reference.context_json),
    pick: JSON.parse(reference.candidate_json),
  };
  const existing = await db
    .prepare(`SELECT id FROM tracked_rides WHERE owner_id = ? AND state = 'active'
    AND finish_at > ? AND route_id = ? AND departure_at = ?`)
    .bind(
      owner,
      now,
      baseline.pick.routeId,
      baseline.pick.candidate.departureAt,
    )
    .first<{ id: string }>();
  const token = crypto.randomUUID();
  const id = existing?.id ?? crypto.randomUUID();
  const guard =
    'EXISTS (SELECT 1 FROM tracking_accounts WHERE owner_id = ? AND mutation_token = ?)';
  const statements = [
    db
      .prepare(
        'INSERT INTO tracking_accounts(owner_id) VALUES (?) ON CONFLICT DO NOTHING',
      )
      .bind(owner),
    expireTracking(db, owner, now),
    existing
      ? db
          .prepare(`UPDATE tracking_accounts SET mutation_token = ? WHERE owner_id = ? AND active_id = ?
          AND NOT EXISTS (SELECT 1 FROM tracking_actions WHERE owner_id = ? AND action_key = ?)`)
          .bind(token, owner, id, owner, key)
      : db
          .prepare(`UPDATE tracking_accounts SET mutation_token = ? WHERE owner_id = ? AND version = ? AND active_id IS ?
          AND NOT EXISTS (SELECT 1 FROM tracking_actions WHERE owner_id = ? AND action_key = ?)`)
          .bind(
            token,
            owner,
            input.expectedTrackingVersion,
            input.replaceTrackedRideId,
            owner,
            key,
          ),
  ];
  if (!existing) {
    statements.push(
      db
        .prepare(`UPDATE tracked_rides SET state = 'inactive', ended_at = ?, ended_reason = 'replaced',
      version = version + 1, lease_token = NULL, lease_until = NULL WHERE owner_id = ? AND state = 'active' AND ${guard}`)
        .bind(now, owner, owner, token),
    );
    statements.push(
      db
        .prepare(`INSERT INTO tracked_rides(owner_id,id,route_id,departure_at,finish_at,time_zone,created_at,state,baseline_json)
      SELECT ?,?,?,?,?,?,?,'active',? WHERE ${guard}`)
        .bind(
          owner,
          id,
          baseline.pick.routeId,
          baseline.pick.candidate.departureAt,
          baseline.pick.candidate.finishAt,
          baseline.context.inputs[0]?.timeZone ?? 'UTC',
          now,
          boundedJson(baseline, 350_000),
          owner,
          token,
        ),
    );
  }
  const outcome = existing
    ? 'existing'
    : input.replaceTrackedRideId
      ? 'replaced'
      : 'created';
  statements.push(
    db
      .prepare(`INSERT INTO tracking_actions SELECT ?,?,?,?,?,? WHERE ${guard}`)
      .bind(
        owner,
        key,
        hash,
        id,
        outcome,
        existing ? null : input.replaceTrackedRideId,
        owner,
        token,
      ),
  );
  statements.push(
    db
      .prepare(
        'UPDATE tracking_accounts SET mutation_token = NULL WHERE owner_id = ? AND mutation_token = ?',
      )
      .bind(owner, token),
  );
  const results = await db.batch(statements);
  const action = await findAction(db, owner, key);
  if (!action) throw conflict();
  const result = await replay(db, owner, action, hash);
  const performed = results[2]?.meta.changes === 1;
  return { ...result, replayed: !performed, created: performed && !existing };
};
export const stopTracking = async (
  db: D1Database,
  owner: string,
  id: string,
  now: string,
  permanent: boolean,
) => {
  await db.batch([
    expireTracking(db, owner, now),
    permanent
      ? db
          .prepare(
            "DELETE FROM tracked_rides WHERE owner_id = ? AND id = ? AND state = 'inactive'",
          )
          .bind(owner, id)
      : db
          .prepare(`UPDATE tracked_rides SET state = 'inactive', ended_at = ?, ended_reason = 'stopped', version = version + 1,
          lease_token = NULL, lease_until = NULL WHERE owner_id = ? AND id = ? AND state = 'active'`)
          .bind(now, owner, id),
  ]);
  if (permanent && (await getTracking(db, owner, id)))
    throw new AppError(
      409,
      'TRACKING_ACTIVE',
      'Stop tracking before permanently erasing this plan.',
    );
};

export type InputRevision = {
  userVersion: number | null;
  routes: { id: string; version: number | null }[];
  historyRevision: number;
};
export const publishRefresh = async (
  db: D1Database,
  owner: string,
  id: string,
  token: string,
  now: string,
  snapshot: Snapshot | null,
  reason: string | null,
  revision: InputRevision,
  finishAt?: string,
) => {
  const json = snapshot ? boundedJson(snapshot, 350_000) : null;
  // Generation/check times do not create a new assessment for identical evidence.
  const hash = snapshot
    ? await digest({
        ...snapshot,
        context: { ...snapshot.context, generatedAt: null },
        pick: {
          ...snapshot.pick,
          candidate: { ...snapshot.pick.candidate, previous: null },
        },
      })
    : null;
  const assessmentId = crypto.randomUUID();
  const guard = `owner_id = ? AND id = ? AND state = 'active' AND departure_at > ? AND lease_token = ?
    AND (SELECT version FROM users WHERE id = ?) IS ?
    AND COALESCE((SELECT revision FROM ride_history_revisions WHERE owner_id = ?),0) = ?
    ${revision.routes.map(() => 'AND (SELECT version FROM routes WHERE owner_id = ? AND id = ?) IS ?').join(' ')}`;
  const params = [
    owner,
    id,
    now,
    token,
    owner,
    revision.userVersion,
    owner,
    revision.historyRevision,
    ...revision.routes.flatMap((r) => [owner, r.id, r.version]),
  ];
  const statements: D1PreparedStatement[] = [];
  if (snapshot)
    statements.push(
      db
        .prepare(`INSERT INTO tracking_assessments
    SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM tracked_rides WHERE ${guard}) ON CONFLICT DO NOTHING`)
        .bind(owner, id, assessmentId, now, hash, json, ...params),
    );
  statements.push(
    db
      .prepare(`UPDATE tracked_rides SET
    latest_id = CASE WHEN ? IS NULL THEN latest_id ELSE (SELECT id FROM tracking_assessments WHERE owner_id = ? AND plan_id = ? AND evidence_hash = ?) END,
    finish_at = COALESCE(?,finish_at), last_success_at = CASE WHEN ? IS NULL THEN last_success_at ELSE ? END,
    refresh_result = ?, refresh_reason = ?, lease_token = NULL, lease_until = NULL, version = version + 1 WHERE ${guard}`)
      .bind(
        hash,
        owner,
        id,
        hash,
        snapshot?.pick.candidate.finishAt ?? finishAt ?? null,
        hash,
        now,
        snapshot ? 'assessed' : 'unavailable',
        snapshot ? null : reason,
        ...params,
      ),
  );
  const result = await db.batch(statements);
  if (!result.at(-1)?.meta.changes) {
    await db
      .prepare(`UPDATE tracked_rides SET lease_token = NULL, lease_until = NULL, refresh_result = 'unavailable',
      refresh_reason = 'inputs_changed' WHERE owner_id = ? AND id = ? AND lease_token = ? AND state = 'active'`)
      .bind(owner, id, token)
      .run();
    return false;
  }
  return true;
};
