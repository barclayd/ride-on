import { afterAll, afterEach, expect, spyOn, test } from 'bun:test';
import { createDecipheriv, createECDH, hkdfSync } from 'node:crypto';
import { importJWK, jwtVerify } from 'jose';
import type { Device } from '../src/monitoring/apns.ts';
import { chromeEndpoint, sendWebPush } from '../src/monitoring/web-push.ts';
import type { Env } from '../src/types.ts';

const keys = () => {
  const key = createECDH('prime256v1');
  key.generateKeys();
  return key;
};
const vapid = keys(),
  receiver = keys();
const auth = Buffer.alloc(16, 23);
const env = {
  WEB_PUSH_CONFIG_JSON: JSON.stringify({
    subject: 'mailto:push@example.test',
    publicKey: vapid.getPublicKey().toString('base64url'),
    privateKey: vapid.getPrivateKey().toString('base64url'),
  }),
} as Env;
const device = {
  id: crypto.randomUUID(),
  transport: 'web_push',
  subscription_json: JSON.stringify({
    endpoint: 'https://fcm.googleapis.com/fcm/send/synthetic-token',
    expirationTime: null,
    keys: {
      p256dh: receiver.getPublicKey().toString('base64url'),
      auth: auth.toString('base64url'),
    },
  }),
} as Device;
const at = new Date();
const input = {
  id: crypto.randomUUID(),
  planId: crypto.randomUUID(),
  expiresAt: new Date(at.getTime() + 3600_000).toISOString(),
  payload: JSON.stringify({
    trackedRideId: crypto.randomUUID(),
    aps: { alert: { title: 'Ride update', body: 'Conditions improved.' } },
  }),
};
const network = spyOn(globalThis, 'fetch');
afterEach(() => network.mockClear());
afterAll(() => network.mockRestore());

test('Web Push independently decrypts with the browser keys and carries a valid VAPID signature', async () => {
  network.mockImplementation(
    Object.assign(
      async (
        url: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1],
      ) => {
        expect(url).toBe('https://fcm.googleapis.com/fcm/send/synthetic-token');
        expect(init?.redirect).toBe('manual');
        const headers = new Headers(init?.headers);
        expect(headers.get('TTL')).toBe('3600');
        expect(headers.get('Content-Encoding')).toBe('aes128gcm');
        const authorization = headers.get('Authorization') ?? '';
        const jwt = authorization.match(/t=([^, ]+)/)?.[1];
        expect(jwt).toBeDefined();
        const publicKey = vapid.getPublicKey();
        const key = await importJWK(
          {
            kty: 'EC',
            crv: 'P-256',
            x: publicKey.subarray(1, 33).toString('base64url'),
            y: publicKey.subarray(33).toString('base64url'),
          },
          'ES256',
        );
        const { payload } = await jwtVerify(jwt ?? '', key, {
          audience: 'https://fcm.googleapis.com',
        });
        expect(payload.sub).toBe('mailto:push@example.test');
        // RFC 8291/8188 decoding, independent of the sending library.
        const body = Buffer.from(await new Response(init?.body).arrayBuffer());
        const salt = body.subarray(0, 16),
          keyLength = body[20];
        expect(keyLength).toBe(65);
        const serverKey = body.subarray(21, 21 + keyLength);
        const shared = receiver.computeSecret(serverKey);
        const info = Buffer.concat([
          Buffer.from('WebPush: info\0'),
          receiver.getPublicKey(),
          serverKey,
        ]);
        const ikm = Buffer.from(hkdfSync('sha256', shared, auth, info, 32));
        const contentKey = Buffer.from(
          hkdfSync(
            'sha256',
            ikm,
            salt,
            Buffer.from('Content-Encoding: aes128gcm\0'),
            16,
          ),
        );
        const nonce = Buffer.from(
          hkdfSync(
            'sha256',
            ikm,
            salt,
            Buffer.from('Content-Encoding: nonce\0'),
            12,
          ),
        );
        const ciphertext = body.subarray(21 + keyLength);
        const decipher = createDecipheriv('aes-128-gcm', contentKey, nonce);
        decipher.setAuthTag(ciphertext.subarray(-16));
        const plain = Buffer.concat([
          decipher.update(ciphertext.subarray(0, -16)),
          decipher.final(),
        ]);
        let end = plain.length - 1;
        while (plain[end] === 0) end--;
        expect(plain[end]).toBe(2);
        expect(JSON.parse(plain.subarray(0, end).toString())).toEqual({
          ...JSON.parse(input.payload),
          installationId: device.id,
          expiresAt: input.expiresAt,
        });
        return new Response(null, { status: 201 });
      },
      { preconnect: () => {} },
    ),
  );
  expect(await sendWebPush(env, device, input, at)).toEqual({
    status: 'accepted',
    reason: null,
  });
});

test('expired, malformed and unconfigured subscriptions never make a network request', async () => {
  expect(
    (
      await sendWebPush(
        env,
        device,
        { ...input, expiresAt: at.toISOString() },
        at,
      )
    ).status,
  ).toBe('rejected');
  expect(
    (await sendWebPush(env, { ...device, subscription_json: '{}' }, input, at))
      .status,
  ).toBe('invalid_device');
  expect((await sendWebPush({} as Env, device, input, at)).status).toBe(
    'retry',
  );
  expect(network).not.toHaveBeenCalled();
});

test('push endpoint validation rejects redirects, private hosts and credentials', () => {
  for (const url of [
    'http://fcm.googleapis.com/fcm/send/a',
    'https://127.0.0.1/fcm/send/a',
    'https://fcm.googleapis.com.evil.test/fcm/send/a',
    'https://user@fcm.googleapis.com/fcm/send/a',
    'https://fcm.googleapis.com/fcm/send/a?redirect=1',
    'https://fcm.googleapis.com:444/fcm/send/a',
  ])
    expect(chromeEndpoint(url)).toBe(false);
  expect(chromeEndpoint('https://fcm.googleapis.com/wp/test:token')).toBe(true);
});

test('provider failures retain transient retries and remove invalid subscriptions', async () => {
  for (const [status, expected] of [
    [410, 'invalid_device'],
    [404, 'invalid_device'],
    [429, 'retry'],
    [503, 'retry'],
    [401, 'retry'],
    [403, 'retry'],
    [400, 'rejected'],
    [307, 'rejected'],
  ] as const) {
    network.mockResolvedValue(new Response(null, { status }));
    expect((await sendWebPush(env, device, input, at)).status).toBe(expected);
  }
});
