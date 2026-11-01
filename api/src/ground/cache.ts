import { DAY, daySchema, type GroundDay } from './contracts.ts';

export const createGroundCache = (db: D1Database) => ({
  read: async (key: string, first: string, last: string, nowMs: number) => {
    const rows = await db
      .prepare(
        'SELECT day_json FROM ground_evidence_days WHERE cache_key = ? AND date BETWEEN ? AND ? AND retained_until > ?',
      )
      .bind(key, first, last, nowMs)
      .all<{ day_json: string }>();
    const days: GroundDay[] = [];
    for (const row of rows.results) {
      try {
        const parsed = daySchema.safeParse(JSON.parse(row.day_json));
        if (parsed.success) days.push(parsed.data);
      } catch {
        /* Corrupt evidence is a miss, never zero rainfall. */
      }
    }
    return days;
  },
  write: async (key: string, days: GroundDay[], nowMs: number) => {
    if (!days.length) return;
    await db.batch(
      days.map((day) =>
        db
          .prepare(
            'INSERT INTO ground_evidence_days (cache_key, date, day_json, retained_until) VALUES (?, ?, ?, ?) ON CONFLICT(cache_key, date) DO UPDATE SET day_json = excluded.day_json, retained_until = excluded.retained_until',
          )
          .bind(key, day.date, JSON.stringify(day), nowMs + 90 * DAY),
      ),
    );
  },
  acquire: async (key: string, nowMs: number, token: string) => {
    const row = await db
      .prepare(
        'INSERT INTO ground_evidence_leases (cache_key, token, expires_at) VALUES (?, ?, ?) ON CONFLICT(cache_key) DO UPDATE SET token = excluded.token, expires_at = excluded.expires_at WHERE ground_evidence_leases.expires_at <= ? RETURNING token',
      )
      .bind(key, token, nowMs + 30_000, nowMs)
      .first<{ token: string }>();
    return row?.token === token;
  },
  release: async (key: string, token: string) => {
    await db
      .prepare(
        'DELETE FROM ground_evidence_leases WHERE cache_key = ? AND token = ?',
      )
      .bind(key, token)
      .run();
  },
  // Atomic, deliberately conservative reservations. Failed attempts still count.
  // 400/day is well below the free service's published limits, including monthly.
  reserve: async (date: string, units: number) => {
    const row = await db
      .prepare(
        'INSERT INTO ground_evidence_usage (date, http_attempts, reserved_units) VALUES (?, 1, ?) ON CONFLICT(date) DO UPDATE SET http_attempts = http_attempts + 1, reserved_units = reserved_units + excluded.reserved_units WHERE reserved_units + excluded.reserved_units <= 400 RETURNING http_attempts',
      )
      .bind(date, units)
      .first();
    return row !== null;
  },
  prune: async (nowMs: number) => {
    await db.batch([
      db
        .prepare('DELETE FROM ground_evidence_days WHERE retained_until <= ?')
        .bind(nowMs),
      db
        .prepare('DELETE FROM ground_evidence_leases WHERE expires_at <= ?')
        .bind(nowMs),
      db
        .prepare('DELETE FROM ground_evidence_usage WHERE date < ?')
        .bind(new Date(nowMs - 90 * DAY).toISOString().slice(0, 10)),
    ]);
  },
});
export type GroundCache = ReturnType<typeof createGroundCache>;
