import { AppError } from '../errors.ts';
import {
  defaultSettings,
  resolvedRecommendationSchema,
} from '../recommendations/input.ts';
import { mergeDays } from '../recommendations/multi-day.ts';
import {
  type ComparisonContext,
  evaluateComparisons,
} from '../recommendations/service.ts';
import type { RouteStore } from '../routes/store.ts';
import type { UserStore } from '../users/model.ts';
import { contextFor, type Snapshot } from './model.ts';
import {
  getTracking,
  type InputRevision,
  isActive,
  publishRefresh,
  trackingNotFound,
} from './store.ts';

export const refreshTracking = async (
  id: string,
  context: ComparisonContext,
  routes: RouteStore,
  users: UserStore,
) => {
  const { env, ownerId: owner, now, startedAt } = context;
  const db = env.ROUTES_DB;
  const at = startedAt.toISOString();
  const row = await getTracking(db, owner, id);
  if (!row) throw trackingNotFound();
  if (!isActive(row, at))
    throw new AppError(
      409,
      'TRACKING_INACTIVE',
      'This plan is no longer active.',
    );
  if (row.departure_at <= at)
    throw new AppError(
      409,
      'REFRESH_CLOSED',
      'Forecast refresh closes at the accepted departure.',
    );
  const token = crypto.randomUUID();
  const lease = await db
    .prepare(`UPDATE tracked_rides SET lease_token = ?, lease_until = ?, last_attempt_at = ?, refresh_result = 'checking', refresh_reason = NULL
    WHERE owner_id = ? AND id = ? AND state = 'active' AND departure_at > ? AND (lease_until IS NULL OR lease_until <= ?)`)
    .bind(
      token,
      new Date(startedAt.getTime() + 60_000).toISOString(),
      at,
      owner,
      id,
      at,
      at,
    )
    .run();
  if (!lease.meta.changes)
    throw new AppError(
      409,
      'REFRESH_IN_PROGRESS',
      'A refresh is already running or the plan changed. Retry shortly.',
      { 'Retry-After': '5' },
    );
  let revision: InputRevision | null = null;
  let finishAt: string | undefined;
  try {
    const baseline = JSON.parse(row.baseline_json) as Snapshot;
    const original = baseline.context.inputs[0] ?? baseline.context.pinnedInput;
    if (!original) throw new Error('Missing tracking context.');
    const [user, loaded, history] = await Promise.all([
      users.get(owner),
      Promise.all(
        original.routeIds.map((routeId) => routes.get(owner, routeId)),
      ),
      db
        .prepare(
          'SELECT revision FROM ride_history_revisions WHERE owner_id = ?',
        )
        .bind(owner)
        .first<{ revision: number }>(),
    ]);
    revision = {
      userVersion: user?.version ?? null,
      historyRevision: history?.revision ?? 0,
      routes: original.routeIds.map((routeId, index) => ({
        id: routeId,
        version: loaded[index]?.version ?? null,
      })),
    };
    const records = loaded.filter((r) => r !== null);
    const settings = user?.settings ?? defaultSettings;
    const currentRoute = records.find(
      (r) => r.route.id === row.route_id,
    )?.route;
    if (currentRoute)
      finishAt = new Date(
        Date.parse(row.departure_at) +
          (currentRoute.distanceM / (settings.riding.averageSpeedKph / 3.6)) *
            1000,
      ).toISOString();
    const inputs = baseline.context.inputs.map((input) =>
      resolvedRecommendationSchema.parse({
        ...settings,
        routeIds: original.routeIds,
        date: input.date,
        timeZone: row.time_zone,
        riding: { ...settings.riding, window: input.riding.window },
      }),
    );
    const pinnedInput = baseline.context.pinnedInput
      ? resolvedRecommendationSchema.parse({
          ...settings,
          routeIds: original.routeIds,
          date: baseline.context.pinnedInput.date,
          timeZone: row.time_zone,
          riding: {
            ...settings.riding,
            window: baseline.context.pinnedInput.riding.window,
          },
        })
      : inputs.find((i) => i.date === baseline.pick.candidate.date);
    if (!pinnedInput) throw new Error('Missing accepted date.');
    if (!records.some((r) => r.route.id === row.route_id)) {
      await publishRefresh(
        db,
        owner,
        id,
        token,
        now().toISOString(),
        null,
        'route_unavailable',
        revision,
        finishAt,
      );
    } else {
      const shared = await evaluateComparisons(
        records.map((r) => r.route),
        inputs,
        pinnedInput,
        {
          ...context,
          pinned: {
            routeId: row.route_id,
            departureAt: row.departure_at,
            input: pinnedInput,
          },
        },
      );
      const pinned = shared.pinned?.rankings[0]?.best;
      const result = mergeDays(
        shared.comparisons.map((c) => c.result),
        Object.keys(settings.preferences.minimumStandards).length > 0,
      );
      const currentContext = contextFor(shared, inputs, records, at, result);
      if (baseline.context.pinnedInput)
        currentContext.pinnedInput = pinnedInput;
      currentContext.assessmentFreshUntil = shared.pinnedRefreshAt;
      if (records.length !== original.routeIds.length)
        currentContext.coverageComplete = false;
      await publishRefresh(
        db,
        owner,
        id,
        token,
        now().toISOString(),
        pinned
          ? {
              context: currentContext,
              pick: { routeId: row.route_id, candidate: pinned },
            }
          : null,
        shared.pinned?.unranked[0]?.status === 'no_feasible_departure'
          ? 'pinned_departure_no_longer_fits'
          : shared.pinned?.unranked[0]?.issues.includes('missing-elevation')
            ? 'missing_elevation'
            : 'forecast_unavailable',
        revision,
        finishAt,
      );
    }
  } catch {
    if (revision)
      await publishRefresh(
        db,
        owner,
        id,
        token,
        now().toISOString(),
        null,
        'refresh_failed',
        revision,
        finishAt,
      );
    else
      await db
        .prepare(`UPDATE tracked_rides SET lease_token = NULL, lease_until = NULL, refresh_result = 'unavailable',
      refresh_reason = 'refresh_failed' WHERE owner_id = ? AND id = ? AND lease_token = ? AND state = 'active'`)
        .bind(owner, id, token)
        .run();
  }
  const updated = await getTracking(db, owner, id);
  if (!updated) throw trackingNotFound();
  return updated;
};
