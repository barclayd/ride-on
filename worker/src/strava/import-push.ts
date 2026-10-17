import { type Device, sendPush } from '../monitoring/apns.ts';
import type { Env } from '../types.ts';
import {
  type ActivityRow,
  DAY,
  FRESHNESS,
  type ImportJob,
} from './import-model.ts';
import { guardArgs, jobGuard } from './import-store.ts';
import type { MatchResult } from './matching.ts';

export const deliverImportPush = async (
  env: Env,
  job: ImportJob,
  activityId: string,
  now: () => Date,
) => {
  const db = env.ROUTES_DB,
    at = now().getTime();
  const activity = await db
    .prepare(`SELECT * FROM strava_activity_cache WHERE owner_id=? AND activity_id=?
    AND generation=? AND expires_at>? AND fetched_at>? AND reviewed_at IS NULL AND ${jobGuard}`)
    .bind(
      job.owner_id,
      activityId,
      job.generation,
      at,
      at - FRESHNESS,
      ...guardArgs(job, at),
    )
    .first<ActivityRow>();
  if (
    !activity ||
    activity.notification_at === null ||
    activity.notification_at + DAY <= at
  )
    return true;
  const expires = activity.notification_at + DAY;
  const match = JSON.parse(activity.match_json) as MatchResult;
  if (!['matched', 'suggested'].includes(match.status)) return true;
  const devices = await db
    .prepare('SELECT * FROM push_devices WHERE owner_id=? ORDER BY id LIMIT 20')
    .bind(job.owner_id)
    .all<Device>();
  if (!devices.results.length) return true;
  await db.batch(
    devices.results.map((d) =>
      db
        .prepare(`INSERT INTO strava_push_deliveries(id,owner_id,activity_id,device_id,device_version,status,expires_at)
    SELECT ?,?,?,?,?, 'pending',? WHERE ${jobGuard} ON CONFLICT(owner_id,activity_id,device_id) DO NOTHING`)
        .bind(
          crypto.randomUUID(),
          job.owner_id,
          activityId,
          d.id,
          d.version,
          expires,
          ...guardArgs(job, at),
        ),
    ),
  );
  let complete = true;
  for (const device of devices.results) {
    const current = now().getTime();
    // Do not deliver to a replaced device token or after a disconnect/review.
    const delivery = await db
      .prepare(`SELECT p.id FROM strava_push_deliveries p
      JOIN push_devices d ON d.id=p.device_id AND d.version=p.device_version
      JOIN strava_activity_cache a ON a.owner_id=p.owner_id AND a.activity_id=p.activity_id
      WHERE p.owner_id=? AND p.activity_id=? AND p.device_id=? AND p.status='pending' AND p.expires_at>?
      AND d.version=? AND a.reviewed_at IS NULL AND a.expires_at>? AND ${jobGuard}`)
      .bind(
        job.owner_id,
        activityId,
        device.id,
        current,
        device.version,
        current,
        ...guardArgs(job, current),
      )
      .first<{ id: string }>();
    if (!delivery) continue;
    const result = await sendPush(
      env,
      device,
      {
        id: delivery.id,
        planId: `strava-${activityId}`,
        expiresAt: new Date(activity.notification_at + DAY).toISOString(),
        payload: JSON.stringify({
          aps: {
            alert: {
              title: 'New ride logged',
              body: 'Review your Strava ride and confirm or correct the route in Ride On.',
            },
            sound: 'default',
          },
          type: 'strava_ride_match',
          activityId,
        }),
      },
      now(),
    );
    if (result.status === 'retry') {
      complete = false;
      continue;
    }
    await db
      .prepare(
        `UPDATE strava_push_deliveries SET status=? WHERE id=? AND ${jobGuard}`,
      )
      .bind(
        result.status === 'accepted' ? 'accepted' : 'rejected',
        delivery.id,
        ...guardArgs(job, now().getTime()),
      )
      .run();
    if (
      result.status === 'invalid_device' &&
      (result.invalidatedAt === undefined ||
        Date.parse(device.registered_at) <= result.invalidatedAt)
    )
      await db
        .prepare(
          'DELETE FROM push_devices WHERE id=? AND owner_id=? AND version=?',
        )
        .bind(device.id, job.owner_id, device.version)
        .run();
  }
  return complete;
};
