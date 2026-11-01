import { Hono } from 'hono';
import { z } from 'zod';
import { AppError } from '../errors.ts';
import { readJsonBody, validateInput } from '../request.ts';
import { FINAL_FORECAST_LOCAL_TIME } from '../tracking/alerts.ts';
import { getTracking, trackingNotFound } from '../tracking/store.ts';
import type { Bindings, Env } from '../types.ts';
import { PUSH_TOPIC, pushConfig } from './apns.ts';
import {
  type DeviceAlertColumns,
  deviceAlerts,
  deviceAlertsSchema,
} from './device-alerts.ts';
import { subscriptionSchema, webPushConfig } from './web-push.ts';

export const monitoringCapabilities = (env: Env) => ({
  notificationTransports: {
    apns:
      env.RIDE_MONITORING === 'enabled' &&
      Object.keys(pushConfig(env)).length > 0,
    webPush: env.RIDE_MONITORING === 'enabled' && !!webPushConfig(env),
  },
  maximumActiveRides: 1,
  alertTriggers: true,
  fixedDeparture: true,
  alertEdits: true,
  finalForecastLocalTime: FINAL_FORECAST_LOCAL_TIME,
  manualRefresh: true,
  automaticChecks: env.RIDE_MONITORING === 'enabled',
  notifications:
    env.RIDE_MONITORING === 'enabled' &&
    Object.keys(pushConfig(env)).length > 0,
});
const nativeRegistrationSchema = z.strictObject({
  token: z
    .string()
    .min(32)
    .max(1024)
    .regex(/^(?:[a-fA-F0-9]{2})+$/)
    .transform((s) => s.toLowerCase()),
  environment: z.enum(['sandbox', 'production']),
  topic: z.literal(PUSH_TOPIC),
  platform: z.enum(['ios', 'macos']),
  scope: z.enum(['all', 'tracked_rides']).default('all'),
  alerts: deviceAlertsSchema.optional(),
});
const registrationSchema = z.union([
  nativeRegistrationSchema,
  z.strictObject({
    transport: z.literal('web_push'),
    platform: z.literal('chrome'),
    subscription: subscriptionSchema,
  }),
]);
type PublicDeviceRow = DeviceAlertColumns & {
  id: string;
  environment: 'sandbox' | 'production';
  topic: string;
  platform: string;
  transport: string;
  scope: string;
};
const publicDeviceColumns =
  'id,environment,topic,platform,transport,scope,ride_alerts,final_forecast,sound';
const publicDevice = ({
  ride_alerts,
  final_forecast,
  sound,
  ...device
}: PublicDeviceRow) => ({
  ...device,
  alerts: deviceAlerts({ ride_alerts, final_forecast, sound }),
});
const deviceResponse = (env: Env, device: PublicDeviceRow) => ({
  device: publicDevice(device),
  deliveryConfigured:
    device.transport === 'web_push'
      ? !!webPushConfig(env)
      : !!pushConfig(env)[device.environment],
});
export const notificationRoutes = (now: () => Date) => {
  const app = new Hono<Bindings>();
  app.get('/push-devices/config', (c) =>
    c.json({
      webPush: {
        publicKey: webPushConfig(c.env)?.publicKey ?? null,
        configured: !!webPushConfig(c.env),
      },
      apns: {
        sandbox: !!pushConfig(c.env).sandbox,
        production: !!pushConfig(c.env).production,
      },
      automaticChecks: c.env.RIDE_MONITORING === 'enabled',
      deviceAlerts: true,
    }),
  );
  app.put('/push-devices/:id', async (c) => {
    const id = validateInput(z.uuid(), c.req.param('id'));
    const parsed = await readJsonBody(c, registrationSchema);
    const input =
      'subscription' in parsed
        ? {
            token: parsed.subscription.endpoint,
            environment: 'production' as const,
            topic: 'web-push',
            platform: parsed.platform,
            transport: 'web_push',
            scope: 'tracked_rides',
            subscription: JSON.stringify(parsed.subscription),
          }
        : { ...parsed, transport: 'apns', subscription: null };
    if ('subscription' in parsed) {
      try {
        await crypto.subtle.importKey(
          'raw',
          Uint8Array.from(
            atob(
              parsed.subscription.keys.p256dh
                .replaceAll('-', '+')
                .replaceAll('_', '/'),
            ),
            (c) => c.charCodeAt(0),
          ),
          { name: 'ECDH', namedCurve: 'P-256' },
          false,
          [],
        );
      } catch {
        throw new AppError(
          400,
          'INVALID_SUBSCRIPTION',
          'Invalid push encryption key.',
        );
      }
      if (
        parsed.subscription.expirationTime !== null &&
        parsed.subscription.expirationTime <= now().getTime()
      )
        throw new AppError(
          400,
          'INVALID_SUBSCRIPTION',
          'The push subscription has expired.',
        );
    }
    const owner = c.get('ownerId'),
      db = c.env.ROUTES_DB;
    const alerts = 'alerts' in parsed ? parsed.alerts : undefined;
    const result = await db
      .prepare(`INSERT INTO push_devices(id,owner_id,token,environment,topic,platform,registered_at,transport,subscription_json,scope,ride_alerts,final_forecast,sound)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? WHERE
      NOT EXISTS (SELECT 1 FROM push_devices WHERE id = ? AND owner_id <> ?)
      AND NOT EXISTS (SELECT 1 FROM push_devices WHERE environment = ? AND topic = ? AND token = ? AND id <> ?)
      AND ((SELECT COUNT(*) FROM push_devices WHERE owner_id = ?) < 20 OR EXISTS (SELECT 1 FROM push_devices WHERE id = ? AND owner_id = ?))
      ON CONFLICT(id) DO UPDATE SET token = excluded.token, environment = excluded.environment, topic = excluded.topic,
      platform = excluded.platform, registered_at = excluded.registered_at, transport = excluded.transport, subscription_json = excluded.subscription_json, scope = excluded.scope,
      ride_alerts = CASE WHEN ? THEN excluded.ride_alerts ELSE push_devices.ride_alerts END,
      final_forecast = CASE WHEN ? THEN excluded.final_forecast ELSE push_devices.final_forecast END,
      sound = CASE WHEN ? THEN excluded.sound ELSE push_devices.sound END,
      version = push_devices.version + CASE WHEN push_devices.token <> excluded.token OR push_devices.environment <> excluded.environment OR push_devices.topic <> excluded.topic OR push_devices.transport <> excluded.transport OR push_devices.scope <> excluded.scope OR COALESCE(push_devices.subscription_json,'') <> COALESCE(excluded.subscription_json,'') THEN 1 ELSE 0 END
      WHERE push_devices.owner_id = excluded.owner_id`)
      .bind(
        id,
        owner,
        input.token,
        input.environment,
        input.topic,
        input.platform,
        now().toISOString(),
        input.transport,
        input.subscription,
        input.scope,
        Number(alerts?.rideAlerts ?? true),
        Number(alerts?.finalForecast ?? true),
        Number(alerts?.sound ?? true),
        id,
        owner,
        input.environment,
        input.topic,
        input.token,
        id,
        owner,
        id,
        owner,
        Number(!!alerts),
        Number(!!alerts),
        Number(!!alerts),
      )
      .run();
    if (!result.meta.changes)
      throw new AppError(
        409,
        'DEVICE_REGISTRATION_CONFLICT',
        'Unregister the previous installation or remove an unused device before registering this device.',
      );
    // Old-token attempts must not be delivered to a different installation/version.
    await db
      .prepare(`UPDATE push_deliveries SET status = 'cancelled' WHERE device_id = ? AND status = 'pending'
      AND device_version <> (SELECT version FROM push_devices WHERE id = ?)`)
      .bind(id, id)
      .run();
    const device = await db
      .prepare(
        `SELECT ${publicDeviceColumns} FROM push_devices WHERE id = ? AND owner_id = ?`,
      )
      .bind(id, owner)
      .first<PublicDeviceRow>();
    if (!device)
      throw new AppError(404, 'DEVICE_NOT_FOUND', 'Device not found.');
    return c.json(deviceResponse(c.env, device));
  });
  app.patch('/push-devices/:id', async (c) => {
    const id = validateInput(z.uuid(), c.req.param('id'));
    const { alerts } = await readJsonBody(
      c,
      z.strictObject({ alerts: deviceAlertsSchema }),
    );
    const device = await c.env.ROUTES_DB.prepare(`
      UPDATE push_devices SET ride_alerts = ?,final_forecast = ?,sound = ?
      WHERE id = ? AND owner_id = ? AND transport = 'apns'
      RETURNING ${publicDeviceColumns}`)
      .bind(
        Number(alerts.rideAlerts),
        Number(alerts.finalForecast),
        Number(alerts.sound),
        id,
        c.get('ownerId'),
      )
      .first<PublicDeviceRow>();
    if (!device)
      throw new AppError(404, 'DEVICE_NOT_FOUND', 'Device not found.');
    return c.json(deviceResponse(c.env, device));
  });
  app.get('/push-devices', async (c) => {
    const devices = await c.env.ROUTES_DB.prepare(
      `SELECT ${publicDeviceColumns},registered_at AS registeredAt FROM push_devices WHERE owner_id = ? ORDER BY id LIMIT 20`,
    )
      .bind(c.get('ownerId'))
      .all<PublicDeviceRow>();
    return c.json({
      devices: devices.results.map(publicDevice),
      capabilities: monitoringCapabilities(c.env),
    });
  });
  app.delete('/push-devices/:id', async (c) => {
    const id = validateInput(z.uuid(), c.req.param('id'));
    await c.env.ROUTES_DB.batch([
      c.env.ROUTES_DB.prepare(
        "UPDATE push_deliveries SET status = 'cancelled' WHERE device_id = ? AND status = 'pending' AND EXISTS (SELECT 1 FROM push_devices WHERE id = ? AND owner_id = ?)",
      ).bind(id, id, c.get('ownerId')),
      c.env.ROUTES_DB.prepare(
        'DELETE FROM push_devices WHERE id = ? AND owner_id = ?',
      ).bind(id, c.get('ownerId')),
    ]);
    return c.body(null, 204);
  });
  app.get('/tracked-rides/:id/notifications', async (c) => {
    const id = validateInput(z.uuid(), c.req.param('id')),
      owner = c.get('ownerId'),
      db = c.env.ROUTES_DB;
    if (!(await getTracking(db, owner, id))) throw trackingNotFound();
    const { limit, cursor } = validateInput(
      z.strictObject({
        limit: z.coerce.number().int().min(1).max(50).default(20),
        cursor: z.string().max(1024).optional(),
      }),
      c.req.query(),
    );
    let before: { at: string; id: string } | null = null;
    if (cursor) {
      try {
        before = z
          .strictObject({ at: z.iso.datetime(), id: z.uuid() })
          .parse(JSON.parse(atob(cursor)));
      } catch {
        throw new AppError(
          400,
          'INVALID_CURSOR',
          'Use the returned notification cursor.',
        );
      }
    }
    const result = await db
      .prepare(`SELECT n.id,n.created_at AS createdAt,n.expires_at AS expiresAt,n.accepted_at AS acceptedAt,n.status,n.decision_json,
      (SELECT COUNT(*) FROM push_deliveries WHERE notification_id = n.id AND status = 'accepted') AS devicesAccepted,
      (SELECT COUNT(*) FROM push_deliveries WHERE notification_id = n.id AND status = 'pending') AS devicesPending
      FROM tracking_notifications n WHERE owner_id = ? AND plan_id = ? ${before ? 'AND (created_at < ? OR (created_at = ? AND id > ?))' : ''}
      ORDER BY created_at DESC,id LIMIT ?`)
      .bind(
        owner,
        id,
        ...(before ? [before.at, before.at, before.id] : []),
        limit + 1,
      )
      .all<{ id: string; createdAt: string; decision_json: string }>();
    const page = result.results.slice(0, limit),
      last = page.at(-1);
    return c.json({
      notifications: page.map(({ decision_json, ...record }) => ({
        ...record,
        decision: JSON.parse(decision_json),
      })),
      nextCursor:
        result.results.length > limit && last
          ? btoa(JSON.stringify({ at: last.createdAt, id: last.id }))
          : null,
    });
  });
  return app;
};
