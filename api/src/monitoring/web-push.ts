import { buildPushPayload } from '@block65/webcrypto-web-push';
import { z } from 'zod';
import type { Env } from '../types.ts';
import type { Device, PushResult } from './apns.ts';

const base64Key = (bytes: number) =>
  z
    .string()
    .regex(/^[A-Za-z0-9_-]+$/)
    .refine((value) => {
      try {
        return (
          atob(value.replaceAll('-', '+').replaceAll('_', '/')).length === bytes
        );
      } catch {
        return false;
      }
    }, 'Invalid push key.');

// Chrome uses Google's push service. Never fetch arbitrary subscriber-supplied URLs.
export const chromeEndpoint = (value: string) => {
  try {
    const url = new URL(value);
    return (
      url.origin === 'https://fcm.googleapis.com' &&
      !url.username &&
      !url.password &&
      !url.hash &&
      !url.search &&
      /^\/(?:fcm\/send|wp)\/[A-Za-z0-9_:-]+$/.test(url.pathname)
    );
  } catch {
    return false;
  }
};
export const subscriptionSchema = z.strictObject({
  endpoint: z
    .string()
    .max(2048)
    .refine(chromeEndpoint, 'Unsupported Chrome push endpoint.'),
  expirationTime: z.number().finite().nonnegative().nullable().default(null),
  keys: z.strictObject({ p256dh: base64Key(65), auth: base64Key(16) }),
});
const configSchema = z.strictObject({
  subject: z
    .url()
    .max(512)
    .refine(
      (value) => value.startsWith('https://') || value.startsWith('mailto:'),
    ),
  publicKey: base64Key(65),
  privateKey: base64Key(32),
});
export const webPushConfig = (env: Env) => {
  try {
    return configSchema.parse(JSON.parse(env.WEB_PUSH_CONFIG_JSON ?? 'null'));
  } catch {
    return null;
  }
};
export const sendWebPush = async (
  env: Env,
  device: Device,
  input: { id: string; planId: string; expiresAt: string; payload: string },
  at: Date,
): Promise<PushResult> => {
  const config = webPushConfig(env);
  if (!config) return { status: 'retry', reason: 'web_push_not_configured' };
  const ttl = Math.floor((Date.parse(input.expiresAt) - at.getTime()) / 1000);
  if (!Number.isFinite(ttl) || ttl <= 0)
    return { status: 'rejected', reason: 'expired' };
  let subscription: z.infer<typeof subscriptionSchema>;
  try {
    subscription = subscriptionSchema.parse(
      JSON.parse(device.subscription_json ?? 'null'),
    );
  } catch {
    return { status: 'invalid_device', reason: 'invalid_subscription' };
  }
  if (
    subscription.expirationTime !== null &&
    subscription.expirationTime <= at.getTime()
  )
    return { status: 'invalid_device', reason: 'expired_subscription' };
  try {
    const data = JSON.stringify({
      ...JSON.parse(input.payload),
      installationId: device.id,
      expiresAt: input.expiresAt,
    });
    if (new TextEncoder().encode(data).length > 3993)
      return { status: 'rejected', reason: 'payload_too_large' };
    const request = await buildPushPayload(
      {
        data,
        options: {
          ttl,
          urgency: 'normal',
          topic: input.planId.replaceAll('-', '').slice(0, 32),
        },
      },
      subscription,
      config,
    );
    const response = await fetch(subscription.endpoint, {
      ...request,
      redirect: 'manual',
      signal: AbortSignal.timeout(8000),
    });
    await response.body?.cancel();
    if (response.status >= 200 && response.status < 300)
      return { status: 'accepted', reason: null };
    if (response.status === 404 || response.status === 410)
      return {
        status: 'invalid_device',
        reason: `web_push_${response.status}`,
      };
    return {
      status:
        response.status === 429 ||
        response.status >= 500 ||
        [401, 403].includes(response.status)
          ? 'retry'
          : 'rejected',
      reason: `web_push_${response.status}`,
    };
  } catch {
    return { status: 'retry', reason: 'web_push_unavailable' };
  }
};
