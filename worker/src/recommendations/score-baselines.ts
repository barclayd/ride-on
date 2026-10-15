import { Temporal } from '@js-temporal/polyfill';
import type { Route } from '../routes/model.ts';
import { ALGORITHM_VERSION } from './engine.ts';
import type { RecommendationInput } from './input.ts';
import type { DailyResult } from './presentation.ts';

export type PreviousScore = { score: number; generatedAt: string };
type Baseline = PreviousScore & { key: string; routeId: string };
export type ScoreBaselineStore = (
  ownerId: string,
  entries: readonly Baseline[],
  now: Date,
) => Promise<ReadonlyMap<string, PreviousScore>>;

export const createScoreBaselineStore =
  (db: D1Database): ScoreBaselineStore =>
  async (ownerId, entries, now) => {
    if (!entries.length) return new Map();
    // Inserts and reads share a transaction. Concurrent requests retain the
    // earliest generation time even when they finish in the opposite order.
    const result = await db.batch<{
      comparison_key: string;
      score: number;
      generated_at: string;
    }>([
      db
        .prepare(
          'DELETE FROM recommendation_score_baselines WHERE owner_id = ? AND expires_at <= ?',
        )
        .bind(ownerId, now.getTime()),
      ...entries.map((entry) =>
        db
          .prepare(`
        INSERT INTO recommendation_score_baselines
          (owner_id, comparison_key, route_id, score, generated_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(owner_id, comparison_key) DO UPDATE SET
          score = excluded.score, generated_at = excluded.generated_at, expires_at = excluded.expires_at
        WHERE excluded.generated_at < recommendation_score_baselines.generated_at
      `)
          .bind(
            ownerId,
            entry.key,
            entry.routeId,
            entry.score,
            entry.generatedAt,
            now.getTime() + 48 * 3_600_000,
          ),
      ),
      // Bound per-owner storage even when a client varies settings on every request.
      db
        .prepare(`DELETE FROM recommendation_score_baselines WHERE owner_id = ? AND comparison_key IN (
        SELECT comparison_key FROM recommendation_score_baselines WHERE owner_id = ?
        ORDER BY generated_at DESC, comparison_key LIMIT -1 OFFSET 1000
      )`)
        .bind(ownerId, ownerId),
      db
        .prepare(`SELECT comparison_key, score, generated_at FROM recommendation_score_baselines
        WHERE owner_id = ? AND comparison_key IN (${entries.map(() => '?').join(',')})`)
        .bind(ownerId, ...entries.map((entry) => entry.key)),
    ]);
    return new Map(
      (result.at(-1)?.results ?? []).map((row) => [
        row.comparison_key,
        {
          score: row.score,
          generatedAt: row.generated_at,
        },
      ]),
    );
  };

const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
};
const fingerprint = async (value: unknown) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(JSON.stringify(canonical(value))),
      ),
    ),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');

/** Enrich only daily best candidates. Alternatives are not comparisons of that
 * day's best score. Multi-day summaries retain the same candidate objects. */
export const attachPreviousScores = async (
  comparisons: readonly { input: RecommendationInput; result: DailyResult }[],
  routes: readonly Route[],
  ownerId: string,
  now: Date,
  source: unknown,
  history: unknown,
  remember: ScoreBaselineStore,
) => {
  const routesById = new Map(routes.map((route) => [route.id, route]));
  const routeHashes = new Map(
    await Promise.all(
      routes.map(
        async (route) =>
          [
            route.id,
            await fingerprint({
              sourceHash: route.sourceHash,
              distanceM: route.distanceM,
              ascentM: route.ascentM,
              legs: route.legs,
              weatherLocations: route.weatherLocations,
            }),
          ] as const,
      ),
    ),
  );
  const entries = await Promise.all(
    comparisons.flatMap(({ input, result }) =>
      result.rankings.flatMap((ranked) => {
        const best = ranked.best;
        if (!best || !routesById.has(ranked.routeId)) return [];
        return [
          (async () => ({
            candidate: best,
            key: await fingerprint({
              algorithm: ALGORITHM_VERSION,
              route: routeHashes.get(ranked.routeId),
              routeId: ranked.routeId,
              viewedOn: Temporal.Instant.from(now.toISOString())
                .toZonedDateTimeISO(input.timeZone)
                .toPlainDate()
                .toString(),
              date: input.date,
              timeZone: input.timeZone,
              preferences: input.preferences,
              riding: input.riding,
              weather: input.weather,
              forecast: input.forecast,
              source,
              history,
              // A passing departure or changing coverage must not masquerade as a
              // weather-driven improvement. The best slot may move within this set.
              slots: [...ranked.assessedDepartures].sort((a, b) =>
                a.departureAt.localeCompare(b.departureAt),
              ),
            }),
            routeId: ranked.routeId,
            score: best.score,
            generatedAt: now.toISOString(),
          }))(),
        ];
      }),
    ),
  );
  if (!entries.length) return;
  try {
    const previous = await remember(ownerId, entries, now);
    for (const entry of entries) {
      const earlier = previous.get(entry.key);
      entry.candidate.previous =
        earlier && earlier.generatedAt < entry.generatedAt ? earlier : null;
    }
  } catch {
    // A missing trend must never discard an otherwise usable recommendation.
    console.warn('Score baseline storage unavailable.');
  }
};
