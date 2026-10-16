import { z } from 'zod';
import { ALGORITHM_VERSION } from '../recommendations/engine.ts';
import { forecastRefreshSeconds } from '../recommendations/freshness.ts';
import { createD1RouteStore } from '../routes/store.ts';
import { digest, type Snapshot } from '../tracking/model.ts';
import { refreshTracking } from '../tracking/refresh.ts';
import { getTracking, type TrackingRow } from '../tracking/store.ts';
import type { Env } from '../types.ts';
import { createD1UserStore } from '../users/model.ts';
import { type Device, sendPush } from './apns.ts';
import { pushPayload } from './message.ts';
import {
  type Alert,
  acceptAlert,
  decide,
  INTERVAL_MS,
  initialState,
  type MonitorState,
} from './policy.ts';

export const jobSchema = z.strictObject({
  ownerId: z.string().min(1).max(256),
  planId: z.uuid(),
});
type Job = z.infer<typeof jobSchema>;
type Monitor = { state_json: string | null; input_revision: string | null };
type Event = {
  id: string;
  decision_json: string;
  payload_json: string;
  input_revision: string;
  assessment_id: string | null;
  expires_at: string;
  accepted_at: string | null;
};
const after = (at: Date, ms: number) =>
  new Date(at.getTime() + ms).toISOString();
const active = (row: TrackingRow | null, at: string): row is TrackingRow =>
  !!row && row.state === 'active' && row.departure_at > at;
const weatherDueAt = (snapshot: Snapshot, at: string) => {
  const ttl =
    forecastRefreshSeconds(
      snapshot.context.inputs.map((i) => i.date),
      new Date(at),
      snapshot.context.inputs[0]?.timeZone ?? 'UTC',
    ) * 1000;
  return Math.min(
    ...snapshot.context.weather.locations.flatMap((l) =>
      l.provenance ? [Date.parse(l.provenance.retrievedAt) + ttl] : [],
    ),
  );
};
const snapshotFor = (row: TrackingRow, at: string) => {
  const snapshot = row.latest_json
    ? (JSON.parse(row.latest_json) as Snapshot)
    : null;
  return row.refresh_result === 'assessed' &&
    snapshot?.context.assessmentFreshUntil &&
    snapshot.context.assessmentFreshUntil > at &&
    weatherDueAt(snapshot, at) > Date.parse(at)
    ? snapshot
    : null;
};
// Read current revisions even when weather is still fresh, so edits are assessed
// on the next tick without fetching forecasts earlier than their cache policy.
const inputRevision = async (
  db: D1Database,
  owner: string,
  baseline: Snapshot,
) => {
  const ids = baseline.context.inputs[0]?.routeIds ?? [];
  const [user, history, routes] = await Promise.all([
    db
      .prepare('SELECT version FROM users WHERE id = ?')
      .bind(owner)
      .first<{ version: number }>(),
    db
      .prepare('SELECT revision FROM ride_history_revisions WHERE owner_id = ?')
      .bind(owner)
      .first<{ revision: number }>(),
    db
      .prepare(
        `SELECT id,version FROM routes WHERE owner_id = ? AND id IN (${ids.map(() => '?').join(',')}) ORDER BY id`,
      )
      .bind(owner, ...ids)
      .all(),
  ]);
  return digest({
    user: user?.version ?? null,
    history: history?.revision ?? 0,
    routes: routes.results,
    algorithm: ALGORITHM_VERSION,
  });
};
const cancelPending = async (db: D1Database, owner: string, plan: string) => {
  await db.batch([
    db
      .prepare(`UPDATE push_deliveries SET status = 'cancelled' WHERE status = 'pending' AND notification_id IN
      (SELECT id FROM tracking_notifications WHERE owner_id = ? AND plan_id = ?)`)
      .bind(owner, plan),
    db
      .prepare(
        "UPDATE tracking_notifications SET status = 'superseded' WHERE owner_id = ? AND plan_id = ? AND status = 'pending'",
      )
      .bind(owner, plan),
  ]);
};
export const dispatchMonitoring = async (env: Env, at = new Date()) => {
  if (env.RIDE_MONITORING !== 'enabled') return;
  const db = env.ROUTES_DB;
  // Indexed, bounded pages. The timestamp lease recovers a failed queue send or
  // exhausted queue retries; D1 remains the source of truth, not queue ordering.
  for (let page = 0; page < 10; page++) {
    const rows = await db
      .prepare(`SELECT owner_id,plan_id FROM tracking_monitors
      WHERE next_due_at <= ? AND (queued_until IS NULL OR queued_until <= ?)
      AND (lease_until IS NULL OR lease_until <= ?) ORDER BY next_due_at,owner_id,plan_id LIMIT 50`)
      .bind(at.toISOString(), at.toISOString(), at.toISOString())
      .all<{ owner_id: string; plan_id: string }>();
    if (!rows.results.length) break;
    const claims = await db.batch(
      rows.results.map((row) =>
        db
          .prepare(`UPDATE tracking_monitors SET queued_until = ?
      WHERE owner_id = ? AND plan_id = ? AND (queued_until IS NULL OR queued_until <= ?)`)
          .bind(
            after(at, INTERVAL_MS),
            row.owner_id,
            row.plan_id,
            at.toISOString(),
          ),
      ),
    );
    const messages = rows.results.flatMap((row, index) =>
      claims[index]?.meta.changes
        ? [
            {
              body: {
                ownerId: row.owner_id,
                planId: row.plan_id,
              } satisfies Job,
            },
          ]
        : [],
    );
    if (messages.length) await env.RIDE_MONITOR_QUEUE.sendBatch(messages);
    if (rows.results.length < 50) break;
  }
  await db
    .prepare('DELETE FROM push_provider_tokens WHERE issued_at < ?')
    .bind(Math.floor(at.getTime() / 1000) - 86400)
    .run();
};
export const monitorRide = async (
  env: Env,
  job: Job,
  now: () => Date = () => new Date(),
) => {
  if (env.RIDE_MONITORING !== 'enabled') return;
  const db = env.ROUTES_DB,
    { ownerId: owner, planId: plan } = job;
  const token = crypto.randomUUID();
  const claim = await db
    .prepare(`UPDATE tracking_monitors SET lease_token = ?, lease_until = ?
    WHERE owner_id = ? AND plan_id = ? AND (lease_until IS NULL OR lease_until <= ?)`)
    .bind(token, after(now(), 5 * 60_000), owner, plan, now().toISOString())
    .run();
  if (!claim.meta.changes) return;
  const saveState = (state: MonitorState, revision: string | null) =>
    db
      .prepare(`UPDATE tracking_monitors SET state_json = ?, input_revision = ?
    WHERE owner_id = ? AND plan_id = ? AND lease_token = ?`)
      .bind(JSON.stringify(state), revision, owner, plan, token)
      .run();
  try {
    let row = await getTracking(db, owner, plan);
    if (!active(row, now().toISOString())) {
      await cancelPending(db, owner, plan);
      await db
        .prepare(
          'DELETE FROM tracking_monitors WHERE owner_id = ? AND plan_id = ? AND lease_token = ?',
        )
        .bind(owner, plan, token)
        .run();
      return;
    }
    const monitor = await db
      .prepare(
        'SELECT state_json,input_revision FROM tracking_monitors WHERE owner_id = ? AND plan_id = ?',
      )
      .bind(owner, plan)
      .first<Monitor>();
    if (!monitor) return;
    const baseline = JSON.parse(row.baseline_json) as Snapshot;
    let state: MonitorState = monitor.state_json
      ? JSON.parse(monitor.state_json)
      : await initialState(baseline, row.created_at);
    const revision = await inputRevision(db, owner, baseline);
    const latest = snapshotFor(row, now().toISOString());
    if (
      !latest ||
      monitor.input_revision !== revision ||
      !latest.context.weather.refreshAt ||
      latest.context.weather.refreshAt <= now().toISOString()
    ) {
      try {
        row = await refreshTracking(
          plan,
          {
            env,
            ownerId: owner,
            signal: AbortSignal.timeout(55_000),
            now,
            startedAt: now(),
            dependencies: {},
          },
          createD1RouteStore(db),
          createD1UserStore(db),
        );
      } catch {
        /* A concurrent manual refresh owns the existing tracking lease. */
      }
    }
    row = await getTracking(db, owner, plan);
    if (!active(row, now().toISOString())) return;
    const stableInputs =
      revision === (await inputRevision(db, owner, baseline));
    // Do not make an outage/change decision while a manual refresh or input edit is in flight.
    if (
      !stableInputs ||
      (row.lease_until && row.lease_until > now().toISOString()) ||
      row.refresh_reason === 'inputs_changed'
    )
      return;
    const current = snapshotFor(row, now().toISOString());
    const last = row.latest_json
      ? (JSON.parse(row.latest_json) as Snapshot)
      : null;
    const result = await decide({
      state,
      current,
      at: now().toISOString(),
      departure: row.departure_at,
      createdAt: row.created_at,
      timeZone: row.time_zone,
      lastSuccessAt: row.last_success_at,
      staleSince: last?.context.assessmentFreshUntil
        ? new Date(
            Math.min(
              Date.parse(last.context.assessmentFreshUntil),
              weatherDueAt(last, now().toISOString()),
            ),
          ).toISOString()
        : row.created_at,
    });
    state = result.state;
    await saveState(state, current ? revision : null);
    let event = await db
      .prepare(`SELECT n.* FROM tracking_notifications n WHERE owner_id = ? AND plan_id = ?
      AND status IN ('pending','accepted','failed')
      ORDER BY created_at DESC,rowid DESC LIMIT 1`)
      .bind(owner, plan)
      .first<Event>();
    if (
      event &&
      (event.input_revision !== revision ||
        event.expires_at <= now().toISOString() ||
        (event.assessment_id
          ? !current || event.assessment_id !== row.latest_id
          : !!current))
    ) {
      await cancelPending(db, owner, plan);
      event = null;
    }
    // Coalesce unsent changes to the current decision. A confirmed APNs acceptance
    // advances the reference once; a failed device never makes other devices repeat it.
    if (
      result.alert &&
      (!event || event.decision_json !== JSON.stringify(result.alert))
    ) {
      await cancelPending(db, owner, plan);
      const devices = await db
        .prepare(
          'SELECT * FROM push_devices WHERE owner_id = ? ORDER BY id LIMIT 20',
        )
        .bind(owner)
        .all<Device>();
      if (devices.results.length) {
        const id = crypto.randomUUID();
        const expires = current
          ? ([
              row.departure_at,
              current.context.assessmentFreshUntil ?? row.departure_at,
            ].sort()[0] ?? row.departure_at)
          : ([row.departure_at, after(now(), INTERVAL_MS)].sort()[0] ??
            row.departure_at);
        const payload = pushPayload(
          result.alert,
          {
            id: plan,
            routeName:
              baseline.context.routes.find((r) => r.id === row.route_id)
                ?.name ?? 'Your ride',
            departureAt: row.departure_at,
            timeZone: row.time_zone,
          },
          id,
        );
        const decision = JSON.stringify(result.alert);
        await db.batch([
          db
            .prepare(`INSERT INTO tracking_notifications(id,owner_id,plan_id,created_at,expires_at,assessment_id,input_revision,decision_json,payload_json)
            SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM tracking_monitors WHERE owner_id = ? AND plan_id = ? AND lease_token = ?)
            AND EXISTS (SELECT 1 FROM tracked_rides WHERE owner_id = ? AND id = ? AND state = 'active' AND departure_at > ?)`)
            .bind(
              id,
              owner,
              plan,
              now().toISOString(),
              expires,
              current ? row.latest_id : null,
              revision,
              decision,
              payload,
              owner,
              plan,
              token,
              owner,
              plan,
              now().toISOString(),
            ),
          ...devices.results.map((d) =>
            db
              .prepare(`INSERT INTO push_deliveries(notification_id,device_id,device_version,apns_id,next_attempt_at)
            SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM tracking_notifications WHERE id = ?)`)
              .bind(
                id,
                d.id,
                d.version,
                crypto.randomUUID(),
                now().toISOString(),
                id,
              ),
          ),
        ]);
        event = await db
          .prepare('SELECT * FROM tracking_notifications WHERE id = ?')
          .bind(id)
          .first<Event>();
      } else event = null;
    } else if (!result.alert && event && !event.accepted_at) {
      await cancelPending(db, owner, plan);
      event = null;
    }
    if (!event) return;
    const deliveries = await db
      .prepare(`SELECT d.*,p.* FROM push_deliveries d JOIN push_devices p ON p.id = d.device_id
      WHERE d.notification_id = ? AND d.status = 'pending' AND d.next_attempt_at <= ? AND p.owner_id = ? AND p.version = d.device_version LIMIT 20`)
      .bind(event.id, now().toISOString(), owner)
      .all<Device & { apns_id: string; attempts: number }>();
    for (const device of deliveries.results) {
      const live = await getTracking(db, owner, plan);
      const held = await db
        .prepare(
          'SELECT 1 FROM tracking_monitors WHERE owner_id = ? AND plan_id = ? AND lease_token = ? AND lease_until > ?',
        )
        .bind(owner, plan, token, now().toISOString())
        .first();
      const registered = await db
        .prepare(
          'SELECT 1 FROM push_devices WHERE id = ? AND owner_id = ? AND version = ?',
        )
        .bind(device.id, owner, device.version)
        .first();
      if (
        !held ||
        !active(live, now().toISOString()) ||
        event.expires_at <= now().toISOString() ||
        revision !== (await inputRevision(db, owner, baseline)) ||
        (event.assessment_id &&
          (!snapshotFor(live, now().toISOString()) ||
            live.latest_id !== event.assessment_id)) ||
        (!event.assessment_id && snapshotFor(live, now().toISOString()))
      )
        return;
      if (!registered) continue;
      const sent = await sendPush(
        env,
        device,
        {
          id: device.apns_id,
          planId: plan,
          expiresAt: event.expires_at,
          payload: event.payload_json,
        },
        now(),
      );
      const at = now().toISOString();
      const attempts = device.attempts + 1;
      const status =
        sent.status === 'accepted'
          ? 'accepted'
          : sent.status === 'retry'
            ? 'pending'
            : 'rejected';
      // Persist acceptance and its new reference in one transaction. Retrying an
      // ambiguous network failure may still duplicate a push; APNs isn't transactional.
      const acceptedState =
        sent.status === 'accepted' && !event.accepted_at
          ? acceptAlert(state, JSON.parse(event.decision_json) as Alert, at)
          : state;
      const statements = [
        db
          .prepare(`UPDATE push_deliveries SET status = ?,attempts = ?,next_attempt_at = ?,accepted_at = ?,reason = ?
        WHERE notification_id = ? AND device_id = ? AND device_version = ? AND status = 'pending'`)
          .bind(
            status,
            attempts,
            after(
              now(),
              Math.min(INTERVAL_MS * 2 ** Math.min(attempts - 1, 4), 3_600_000),
            ),
            sent.status === 'accepted' ? at : null,
            sent.reason,
            event.id,
            device.id,
            device.version,
          ),
      ];
      if (sent.status === 'accepted' && !event.accepted_at)
        statements.push(
          db
            .prepare(
              `UPDATE tracking_notifications SET status = 'accepted', accepted_at = ? WHERE id = ? AND status = 'pending'
              AND EXISTS (SELECT 1 FROM push_deliveries WHERE notification_id = ? AND device_id = ? AND device_version = ? AND status = 'accepted' AND accepted_at = ?)`,
            )
            .bind(at, event.id, event.id, device.id, device.version, at),
          db
            .prepare(
              `UPDATE tracking_monitors SET state_json = ? WHERE owner_id = ? AND plan_id = ? AND lease_token = ?
              AND EXISTS (SELECT 1 FROM tracking_notifications WHERE id = ? AND status = 'accepted' AND accepted_at = ?)`,
            )
            .bind(
              JSON.stringify(acceptedState),
              owner,
              plan,
              token,
              event.id,
              at,
            ),
        );
      if (sent.status === 'invalid_device')
        statements.push(
          db
            .prepare(
              'DELETE FROM push_devices WHERE id = ? AND owner_id = ? AND version = ? AND registered_at <= ?',
            )
            .bind(
              device.id,
              owner,
              device.version,
              sent.invalidatedAt === undefined
                ? at
                : new Date(sent.invalidatedAt).toISOString(),
            ),
        );
      const persisted = await db.batch(statements);
      if (sent.status === 'accepted' && persisted[0]?.meta.changes) {
        state = acceptedState;
        event.accepted_at ??= at;
      }
    }
    await db
      .prepare(`UPDATE tracking_notifications SET status = 'failed' WHERE id = ? AND status = 'pending'
      AND NOT EXISTS (SELECT 1 FROM push_deliveries WHERE notification_id = ? AND status = 'pending')`)
      .bind(event.id, event.id)
      .run();
  } finally {
    await db
      .prepare(`UPDATE tracking_monitors SET lease_token = NULL,lease_until = NULL,queued_until = NULL,next_due_at = ?
      WHERE owner_id = ? AND plan_id = ? AND lease_token = ?`)
      .bind(after(now(), INTERVAL_MS), owner, plan, token)
      .run();
  }
};
export const consumeMonitoring = async (
  batch: MessageBatch<unknown>,
  env: Env,
  now: () => Date = () => new Date(),
) => {
  for (const message of batch.messages) {
    const parsed = jobSchema.safeParse(message.body);
    if (!parsed.success) {
      message.ack();
      continue;
    }
    try {
      await monitorRide(env, parsed.data, now);
      message.ack();
    } catch {
      console.error('ride_monitor_failed');
      message.retry({ delaySeconds: 900 });
    }
  }
};
