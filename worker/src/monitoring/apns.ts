import { importPKCS8, SignJWT } from 'jose';
import { z } from 'zod';
import { digest } from '../tracking/model.ts';
import type { Env } from '../types.ts';
import { readBoundedJson } from '../weather/http.ts';

export const PUSH_TOPIC = 'com.danbarclay.rideon';
const credentialSchema = z.strictObject({
  teamId: z.string().regex(/^[A-Z0-9]{10}$/),
  keyId: z.string().regex(/^[A-Z0-9]{10}$/),
  privateKey: z.string().min(100).max(4096),
});
const configSchema = z.strictObject({
  sandbox: credentialSchema.optional(),
  production: credentialSchema.optional(),
});
export const pushConfig = (env: Env) => {
  try {
    return configSchema.parse(JSON.parse(env.APNS_CONFIG_JSON ?? '{}'));
  } catch {
    return {};
  }
};
export type Device = {
  id: string;
  owner_id: string;
  token: string;
  environment: 'sandbox' | 'production';
  topic: string;
  platform: 'ios' | 'macos';
  version: number;
  registered_at: string;
};
export type PushResult = {
  status: 'accepted' | 'retry' | 'invalid_device' | 'rejected';
  reason: string | null;
  invalidatedAt?: number;
};
const providerToken = async (
  db: D1Database,
  credentials: z.infer<typeof credentialSchema>,
  at: Date,
) => {
  const hash = await digest(credentials);
  const issued = Math.floor(at.getTime() / 1000);
  const current = await db
    .prepare(
      'SELECT token,issued_at FROM push_provider_tokens WHERE key_hash = ?',
    )
    .bind(hash)
    .first<{ token: string; issued_at: number }>();
  if (
    current &&
    current.issued_at > issued - 50 * 60 &&
    current.issued_at <= issued
  )
    return current.token;
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: credentials.keyId })
    .setIssuer(credentials.teamId)
    .setIssuedAt(issued)
    .sign(await importPKCS8(credentials.privateKey, 'ES256'));
  // Concurrent isolates use the winner's token, including its issue time.
  await db
    .prepare(`INSERT INTO push_provider_tokens(key_hash,token,issued_at) VALUES (?,?,?)
    ON CONFLICT(key_hash) DO UPDATE SET token = excluded.token, issued_at = excluded.issued_at
    WHERE push_provider_tokens.issued_at <= ? OR push_provider_tokens.issued_at > ?`)
    .bind(hash, token, issued, issued - 50 * 60, issued)
    .run();
  const stored = await db
    .prepare('SELECT token FROM push_provider_tokens WHERE key_hash = ?')
    .bind(hash)
    .first<{ token: string }>();
  if (!stored) throw new Error('Provider token unavailable');
  return stored.token;
};
export const sendPush = async (
  env: Env,
  device: Device,
  input: { id: string; planId: string; expiresAt: string; payload: string },
  at: Date,
): Promise<PushResult> => {
  const credentials = pushConfig(env)[device.environment];
  if (!credentials) return { status: 'retry', reason: 'push_not_configured' };
  if (new TextEncoder().encode(input.payload).length > 4096)
    return { status: 'rejected', reason: 'payload_too_large' };
  try {
    const token = await providerToken(env.ROUTES_DB, credentials, at);
    const response = await fetch(
      `https://${device.environment === 'sandbox' ? 'api.sandbox.push.apple.com' : 'api.push.apple.com'}/3/device/${device.token}`,
      {
        method: 'POST',
        redirect: 'manual',
        signal: AbortSignal.timeout(8000),
        headers: {
          authorization: `bearer ${token}`,
          'content-type': 'application/json',
          'apns-topic': device.topic,
          'apns-push-type': 'alert',
          'apns-priority': '10',
          'apns-id': input.id,
          'apns-collapse-id': input.planId,
          'apns-expiration': String(
            Math.floor(Date.parse(input.expiresAt) / 1000),
          ),
        },
        body: input.payload,
      },
    );
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      return { status: 'rejected', reason: 'unexpected_redirect' };
    }
    if (response.status === 200) {
      await response.body?.cancel();
      return { status: 'accepted', reason: null };
    }
    const parsed = z
      .object({
        reason: z.string().max(100),
        timestamp: z
          .number()
          .int()
          .nonnegative()
          .max(8_640_000_000_000_000)
          .optional(),
      })
      .safeParse(await readBoundedJson(response, 4096));
    const reason = parsed.success ? parsed.data.reason : 'invalid_response';
    if (
      [
        'BadDeviceToken',
        'DeviceTokenNotForTopic',
        'Unregistered',
        'ExpiredToken',
      ].includes(reason)
    )
      return {
        status: 'invalid_device',
        reason,
        invalidatedAt: parsed.success ? parsed.data.timestamp : undefined,
      };
    // Apple asks providers to wait at least 15 minutes after a 5xx response.
    // Credential failures also retry slowly, allowing a secret rotation to recover delivery.
    if (
      response.status >= 500 ||
      response.status === 429 ||
      response.status === 403
    )
      return { status: 'retry', reason };
    return { status: 'rejected', reason };
  } catch {
    return { status: 'retry', reason: 'transport_unavailable' };
  }
};
