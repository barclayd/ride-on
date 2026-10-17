import { Temporal } from '@js-temporal/polyfill';
import { z } from 'zod';
import { AppError } from '../errors.ts';
import { defaultSettings } from '../recommendations/input.ts';
import type { User } from './model.ts';

export const pauseInputSchema = z.strictObject({
  until: z.string().nullable(),
});
export type Pause = {
  until: string | null;
  resumesAt: string | null;
  pausedAt: string;
};
export const localToday = (at: Date, timeZone: string) =>
  Temporal.Instant.from(at.toISOString())
    .toZonedDateTimeISO(timeZone)
    .toPlainDate();

// Omitting plainTime selects the first instant of the local day, including
// zones where a clock change skips midnight. Never add fixed 24-hour periods.
export const pauseResumesAt = (until: string, timeZone: string) =>
  Temporal.PlainDate.from(until)
    .toZonedDateTime(timeZone)
    .toInstant()
    .toString({ fractionalSecondDigits: 3 });

export const validatePauseDate = (
  until: string | null,
  timeZone: string,
  at: Date,
) => {
  if (until === null) return;
  const today = localToday(at, timeZone);
  try {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(until)) throw new RangeError();
    const date = Temporal.PlainDate.from(until);
    const days = today.until(date).days;
    if (days > 0 && days <= 365) return;
  } catch {
    // Invalid calendar dates share the range error, not a JSON/type error.
  }
  throw new AppError(
    422,
    'PAUSE_DATE_OUT_OF_RANGE',
    'Choose a real date after today and at most 365 days ahead in your profile time zone.',
  );
};

export const activePause = (pause: Pause | null, at: Date): Pause | null =>
  pause && (!pause.resumesAt || pause.resumesAt > at.toISOString())
    ? pause
    : null;

// Keep expired rows readable for monitoring: a plan created during a pause
// still needs a quiet first assessment even if no job ran before it expired.
// Resolve the current profile zone in the same read; no stale UTC copy to sync.
export const readPause = async (
  db: D1Database,
  owner: string,
  timeZone?: string,
): Promise<Pause | null> => {
  const row = await db
    .prepare(`SELECT p.until_date,p.paused_at,
      json_extract(u.user_json, '$.settings.timeZone') AS time_zone
      FROM user_pauses p JOIN users u ON u.id = p.owner_id WHERE p.owner_id = ?`)
    .bind(owner)
    .first<{
      until_date: string | null;
      paused_at: string;
      time_zone: string | null;
    }>();
  return row
    ? {
        until: row.until_date,
        resumesAt: row.until_date
          ? pauseResumesAt(
              row.until_date,
              timeZone ?? row.time_zone ?? defaultSettings.timeZone,
            )
          : null,
        pausedAt: row.paused_at,
      }
    : null;
};

const interruptMonitoring = (db: D1Database, owner: string, at: Date) => [
  db
    .prepare(`UPDATE tracking_monitors SET resume_pending = 1,
      lease_token = NULL,lease_until = NULL,queued_until = NULL,next_due_at = ?
      WHERE owner_id = ? AND EXISTS (SELECT 1 FROM user_pauses WHERE owner_id = ?)`)
    .bind(at.toISOString(), owner, owner),
  db
    .prepare(`UPDATE push_deliveries SET status = 'cancelled'
      WHERE status = 'pending' AND notification_id IN
      (SELECT id FROM tracking_notifications WHERE owner_id = ?)
      AND EXISTS (SELECT 1 FROM user_pauses WHERE owner_id = ?)`)
    .bind(owner, owner),
  db
    .prepare(`UPDATE tracking_notifications SET status = 'cancelled'
      WHERE owner_id = ? AND status = 'pending'
      AND EXISTS (SELECT 1 FROM user_pauses WHERE owner_id = ?)`)
    .bind(owner, owner),
];

export const putPause = async (
  db: D1Database,
  user: User,
  until: string | null,
  at: Date,
) => {
  validatePauseDate(until, user.settings.timeZone, at);
  await db.batch([
    db
      .prepare(`INSERT INTO user_pauses(owner_id,until_date,paused_at) VALUES (?,?,?)
        ON CONFLICT(owner_id) DO UPDATE SET until_date = excluded.until_date,
        paused_at = CASE WHEN user_pauses.until_date IS NULL OR user_pauses.until_date > ?
        THEN user_pauses.paused_at ELSE excluded.paused_at END`)
      .bind(
        user.id,
        until,
        at.toISOString(),
        localToday(at, user.settings.timeZone).toString(),
      ),
    ...interruptMonitoring(db, user.id, at),
  ]);
};

export const deletePause = async (db: D1Database, owner: string, at: Date) => {
  const pause = await readPause(db, owner);
  await db.batch([
    ...(activePause(pause, at)
      ? interruptMonitoring(db, owner, at)
      : [
          // Deleting an expired row must not rebase an already resumed plan
          // again. Preserve the marker for a plan created during that pause
          // whose first scheduled job has not run yet.
          db
            .prepare(`UPDATE tracking_monitors SET resume_pending = 1,
              lease_token = NULL,lease_until = NULL,queued_until = NULL,next_due_at = ?
              WHERE owner_id = ? AND state_json IS NULL AND resume_pending = 0
              AND EXISTS (SELECT 1 FROM tracked_rides r WHERE r.owner_id = tracking_monitors.owner_id
                AND r.id = tracking_monitors.plan_id AND r.created_at < ?)`)
            .bind(at.toISOString(), owner, pause?.resumesAt ?? null),
        ]),
    db.prepare('DELETE FROM user_pauses WHERE owner_id = ?').bind(owner),
  ]);
};
