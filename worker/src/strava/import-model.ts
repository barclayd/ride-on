import { z } from 'zod';
import type { Env } from '../types.ts';
import { configured } from './bridge.ts';
import type { MatchResult } from './matching.ts';

export const DAY = 86_400_000;
export const CACHE_TTL = 7 * DAY;
export const FRESHNESS = 2 * DAY;
export const importsEnabled = (env: Env) =>
  configured(env) && String(env.STRAVA_IMPORT_ENABLED) === 'true';
export const stravaId = z
  .string()
  .regex(/^[1-9][0-9]{0,15}$/)
  .refine((v) => Number.isSafeInteger(Number(v)));
export const eventSchema = z
  .strictObject({
    kind: z.literal('strava_event'),
    athleteId: stravaId,
    activityId: stravaId.nullable(),
    aspect: z.enum(['create', 'update', 'delete', 'revoke']),
    eventTime: z.number().int().positive(),
  })
  .refine((e) => (e.aspect === 'revoke') === (e.activityId === null));
export const importJobSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('scan'),
    after: z.number().int().nonnegative(),
    before: z.number().int().positive(),
    page: z.number().int().min(1).max(1000),
  }),
  z.strictObject({ type: z.literal('activity'), activityId: stravaId }),
  z.strictObject({ type: z.literal('verify') }),
  z.strictObject({ type: z.literal('push'), activityId: stravaId }),
]);
export type ImportPayload = z.infer<typeof importJobSchema>;
export const pageSchema = z.object({
  activityIds: z.array(stravaId).max(30),
  nextPage: z.number().int().min(2).max(10000).nullable(),
});
export const activitySchema = z.discriminatedUnion('available', [
  z.object({ available: z.literal(false) }),
  z.object({
    available: z.literal(true),
    activityId: stravaId,
    startedAt: z.iso.datetime(),
    riddenOn: z.iso.date(),
    points: z
      .array(
        z.tuple([
          z.number().finite().min(-90).max(90),
          z.number().finite().min(-180).max(180),
        ]),
      )
      .max(100_000),
  }),
]);
export type Connection = {
  owner_id: string;
  athlete_id: string;
  grant_id: string;
  generation: string;
  connected_at: number;
  scopes: string;
};
export const getConnection = (db: D1Database, owner: string) =>
  db
    .prepare('SELECT * FROM strava_connections WHERE owner_id = ?')
    .bind(owner)
    .first<Connection>();
export type ImportJob = {
  id: string;
  owner_id: string;
  generation: string;
  job_key: string;
  payload_json: string;
  revision: number;
  completed_revision: number;
  event_time: number;
  notify_at: number | null;
  lease_id: string;
  lease_until: number;
  due_at: number;
  attempts: number;
};
export type ActivityRow = {
  owner_id: string;
  generation: string;
  activity_id: string;
  started_at: string;
  ridden_on: string;
  match_json: string;
  decision: 'automatic' | 'confirmed' | 'dismissed';
  primary_route_id: string | null;
  reviewed_at: number | null;
  version: number;
  fetched_at: number;
  first_seen_at: number;
  expires_at: number;
  notification_at: number | null;
};
export const presentActivity = (r: ActivityRow) => ({
  activityId: r.activity_id,
  source: 'strava' as const,
  stravaUrl: `https://www.strava.com/activities/${r.activity_id}`,
  startedAt: r.started_at,
  riddenOn: r.ridden_on,
  match: JSON.parse(r.match_json) as MatchResult,
  decision: r.decision,
  primaryRouteId: r.primary_route_id,
  reviewedAt:
    r.reviewed_at === null ? null : new Date(r.reviewed_at).toISOString(),
  version: r.version,
  fetchedAt: new Date(r.fetched_at).toISOString(),
  expiresAt: new Date(r.expires_at).toISOString(),
});

export type RideHistoryRow = Pick<
  ActivityRow,
  | 'owner_id'
  | 'generation'
  | 'activity_id'
  | 'ridden_on'
  | 'primary_route_id'
  | 'decision'
  | 'version'
> & { verified_at: number; match_json?: string | null };
export const presentRideDate = (r: RideHistoryRow) => {
  const match = r.match_json ? (JSON.parse(r.match_json) as MatchResult) : null;
  const status =
    r.decision === 'dismissed'
      ? ('dismissed' as const)
      : r.primary_route_id !== null
        ? ('logged' as const)
        : match?.status === 'suggested'
          ? ('suggested' as const)
          : match?.status === 'unmatched'
            ? ('unmatched' as const)
            : ('unavailable' as const);
  return {
    activityId: r.activity_id,
    source: 'strava' as const,
    riddenOn: r.ridden_on,
    status,
    primaryRouteId: r.primary_route_id,
    suggestedRouteId:
      status === 'suggested' ? (match?.candidates[0]?.routeId ?? null) : null,
    decision: r.decision,
    version: r.version,
  };
};
