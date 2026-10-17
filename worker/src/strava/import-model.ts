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
const metric = z.number().finite().nonnegative().nullable();
export const activitySchema = z.discriminatedUnion('available', [
  z.object({ available: z.literal(false) }),
  z.object({
    available: z.literal(true),
    activityId: stravaId,
    startedAt: z.iso.datetime(),
    averageSpeedMps: metric,
    elevationGainM: metric,
    averagePowerWatts: metric,
    powerSource: z.enum(['meter', 'estimated']).nullable(),
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
  average_speed_mps: number | null;
  elevation_gain_m: number | null;
  average_power_watts: number | null;
  power_source: 'meter' | 'estimated' | null;
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
  averageSpeedMps: r.average_speed_mps,
  elevationGainM: r.elevation_gain_m,
  averagePowerWatts: r.average_power_watts,
  powerSource: r.power_source,
  match: JSON.parse(r.match_json) as MatchResult,
  decision: r.decision,
  primaryRouteId: r.primary_route_id,
  reviewedAt:
    r.reviewed_at === null ? null : new Date(r.reviewed_at).toISOString(),
  version: r.version,
  fetchedAt: new Date(r.fetched_at).toISOString(),
  expiresAt: new Date(r.expires_at).toISOString(),
});
