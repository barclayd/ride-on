import { z } from 'zod';
import { climateSource } from '../climate/seasonal.ts';
import type { Route } from '../routes/model.ts';
import { selectionSchema } from '../routes/selection.ts';
import { ALGORITHM_VERSION } from './engine.ts';
import { fingerprint } from './fingerprint.ts';
import type { RecommendationInput } from './input.ts';
import { datesBetween, type planningDaysSchema } from './planning.ts';
import type { DailyResult } from './presentation.ts';

const scoreChangeSchema = z.object({
  by: z
    .number()
    .int()
    .refine((by) => Math.abs(by) >= 1),
  from: z.number().int().min(0).max(100),
  to: z.number().int().min(0).max(100),
  changedAt: z.iso.datetime(),
});
export type ScoreChange = z.infer<typeof scoreChangeSchema>;
export type ScoreChangeEntry = {
  routeId: string;
  planKey: string;
  contextKey: string;
  score: number;
};
type State = {
  route_id: string;
  context_key: string;
  reference_score: number;
  change_json: string | null;
  revision: string;
  evaluated_at: number;
};
export type ScoreChangeStore = (
  ownerId: string,
  entries: readonly ScoreChangeEntry[],
  now: Date,
) => Promise<ReadonlyMap<string, ScoreChange | null>>;

export const SCORE_CHANGE_RETENTION_MS = 30 * 86_400_000;
export const SCORE_CHANGE_OWNER_LIMIT = 1000;
const storedChange = (row: State) =>
  row.change_json ? scoreChangeSchema.parse(JSON.parse(row.change_json)) : null;

/** The badge and reference are separate: quiet rebases keep the historical
 * change, while sub-threshold noise does not move the reference. */
export const nextScoreChange = (
  previous: {
    contextKey: string;
    reference: number;
    change: ScoreChange | null;
  } | null,
  entry: ScoreChangeEntry,
  now: Date,
) => {
  const score = Math.round(entry.score);
  if (!previous || previous.contextKey !== entry.contextKey)
    return { reference: score, change: previous?.change ?? null };
  const by = score - previous.reference;
  return Math.abs(by) < 1
    ? { reference: previous.reference, change: previous.change }
    : {
        reference: score,
        change: {
          by,
          from: previous.reference,
          to: score,
          changedAt: now.toISOString(),
        },
      };
};

export const createScoreChangeStore =
  (db: D1Database): ScoreChangeStore =>
  async (ownerId, entries, now) => {
    const changes = new Map<string, ScoreChange | null>();
    if (!entries.length) return changes;
    // Each request has one plan. Read membership and state together, and guard
    // every write by that selection version so removal/re-add cannot revive it.
    const read = db
      .prepare(`SELECT * FROM recommendation_score_changes
      WHERE owner_id = ? AND (${entries.map(() => '(route_id = ? AND plan_key = ?)').join(' OR ')})`)
      .bind(
        ownerId,
        ...entries.flatMap((entry) => [entry.routeId, entry.planKey]),
      );
    const initial = await db.batch<State & { selection_json: string }>([
      db
        .prepare(
          'DELETE FROM recommendation_score_changes WHERE owner_id = ? AND evaluated_at <= ?',
        )
        .bind(ownerId, now.getTime() - SCORE_CHANGE_RETENTION_MS),
      db
        .prepare(
          'SELECT selection_json FROM route_selections WHERE owner_id = ?',
        )
        .bind(ownerId),
      read,
    ]);
    const selectionJson = initial[1]?.results[0]?.selection_json;
    if (!selectionJson) return changes;
    const selection = selectionSchema.parse(JSON.parse(selectionJson));
    let rows = new Map<string, State>(
      (initial[2]?.results ?? []).map((row) => [row.route_id, row]),
    );
    let pending = entries.filter((entry) =>
      selection.routeIds.includes(entry.routeId),
    );
    for (let attempt = 0; pending.length && attempt < 5; attempt++) {
      // A slower response must not overwrite evidence from a newer evaluation.
      const writes = pending.filter((entry) => {
        const row = rows.get(entry.routeId);
        if (row && row.evaluated_at > now.getTime()) {
          changes.set(entry.routeId, storedChange(row));
          return false;
        }
        return true;
      });
      if (!writes.length) {
        pending = [];
        break;
      }
      const result = await db.batch<State>([
        ...writes.map((entry) => {
          const row = rows.get(entry.routeId);
          const next = nextScoreChange(
            row
              ? {
                  contextKey: row.context_key,
                  reference: row.reference_score,
                  change: storedChange(row),
                }
              : null,
            entry,
            now,
          );
          const values = [
            entry.contextKey,
            next.reference,
            next.change ? JSON.stringify(next.change) : null,
            crypto.randomUUID(),
            now.getTime(),
          ];
          return row
            ? db
                .prepare(`UPDATE recommendation_score_changes SET context_key = ?, reference_score = ?,
                change_json = ?, revision = ?, evaluated_at = ?
                WHERE owner_id = ? AND route_id = ? AND plan_key = ? AND revision = ? AND reference_score = ?
                AND EXISTS (SELECT 1 FROM route_selections WHERE owner_id = ? AND version = ?)`)
                .bind(
                  ...values,
                  ownerId,
                  entry.routeId,
                  entry.planKey,
                  row.revision,
                  row.reference_score,
                  ownerId,
                  selection.version,
                )
            : db
                .prepare(`INSERT INTO recommendation_score_changes
                (context_key,reference_score,change_json,revision,evaluated_at,owner_id,route_id,plan_key)
                SELECT ?,?,?,?,?,?,?,? WHERE EXISTS
                  (SELECT 1 FROM route_selections WHERE owner_id = ? AND version = ?)
                ON CONFLICT(owner_id,route_id,plan_key) DO NOTHING`)
                .bind(
                  ...values,
                  ownerId,
                  entry.routeId,
                  entry.planKey,
                  ownerId,
                  selection.version,
                );
        }),
        db
          .prepare(`DELETE FROM recommendation_score_changes WHERE owner_id = ? AND (route_id,plan_key) IN (
          SELECT route_id,plan_key FROM recommendation_score_changes WHERE owner_id = ?
          ORDER BY evaluated_at DESC,route_id,plan_key LIMIT -1 OFFSET ?)`)
          .bind(ownerId, ownerId, SCORE_CHANGE_OWNER_LIMIT),
        read,
      ]);
      rows = new Map(
        (result.at(-1)?.results ?? []).map((row) => [row.route_id, row]),
      );
      pending = writes.filter((entry, index) => {
        if (result[index]?.meta.changes !== 1) return true;
        const row = rows.get(entry.routeId);
        changes.set(entry.routeId, row ? storedChange(row) : null);
        return false;
      });
    }
    if (pending.length)
      throw new Error('Score change compare-and-set exhausted.');
    return changes;
  };

/** Presets retain their names; all explicit selections compare their original
 * dates, before clipping past dates or the provider horizon. */
export const scoreChangePlanKey = (
  days: z.infer<typeof planningDaysSchema>,
  window: RecommendationInput['riding']['window'],
) =>
  fingerprint({
    days:
      days.kind === 'preset'
        ? days
        : {
            kind: 'dates',
            dates:
              days.kind === 'range'
                ? datesBetween(days.start, days.end)
                : days.dates,
          },
    window,
  });

export const rememberScoreChanges = async (
  evaluation: Pick<DailyResult, 'rankings' | 'unranked'>,
  routes: readonly Route[],
  days: z.infer<typeof planningDaysSchema>,
  input: RecommendationInput,
  source: unknown,
  history: unknown,
  ownerId: string,
  now: Date,
  remember: ScoreChangeStore,
  fixed?: { routeId: string; trackedRideId: string; departureAt: string },
): Promise<ReadonlyMap<string, ScoreChange | null>> => {
  try {
    const planKey = await scoreChangePlanKey(days, input.riding.window);
    const routesById = new Map(routes.map((route) => [route.id, route]));
    const entries = await Promise.all(
      [...evaluation.rankings, ...evaluation.unranked].flatMap((ranked) => {
        const route = routesById.get(ranked.routeId);
        const best = ranked.best;
        if (!best || !route) return [];
        return [
          (async () => ({
            routeId: route.id,
            planKey,
            score: Math.round(best.score),
            contextKey: await fingerprint({
              algorithm: ALGORITHM_VERSION,
              climateVersion:
                input.preferences.temperature.seasonalTolerance ===
                'cooler-winters'
                  ? climateSource.version
                  : null,
              route: {
                sourceHash: route.sourceHash,
                distanceM: route.distanceM,
                ascentM: route.ascentM,
                legs: route.legs,
                weatherLocations: route.weatherLocations,
              },
              timeZone: input.timeZone,
              preferences: input.preferences,
              riding: input.riding,
              weather: input.weather,
              forecast: input.forecast,
              source,
              history,
              fixedDeparture:
                fixed?.routeId === ranked.routeId ? fixed : undefined,
              slots: [...ranked.assessedDepartures].sort((a, b) =>
                a.departureAt.localeCompare(b.departureAt),
              ),
            }),
          }))(),
        ];
      }),
    );
    return await remember(ownerId, entries, now);
  } catch {
    console.warn('Score change storage unavailable.');
    return new Map();
  }
};
