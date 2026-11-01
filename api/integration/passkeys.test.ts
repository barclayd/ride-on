import assert from 'node:assert/strict';
import { test } from 'node:test';
import { authenticator } from './authenticator.ts';
import {
  AUTH_ORIGIN,
  closeHarness,
  cookiesFrom,
  createOAuthHarness,
} from './oauth.ts';

type Context = Awaited<ReturnType<typeof createOAuthHarness>>;
const integration = (name: string, run: (ctx: Context) => Promise<void>) =>
  test(name, { timeout: 20000 }, async () => {
    const ctx = await createOAuthHarness();
    try {
      await run(ctx);
    } finally {
      await closeHarness(ctx.h);
    }
  });
type Overrides = {
  origin?: string;
  rpId?: string;
  challenge?: string;
  verified?: boolean;
  badSignature?: boolean;
  counter?: number;
};
const register = async (
  ctx: Context,
  device: ReturnType<typeof authenticator>,
  session: { cookies: string },
  overrides: Overrides = {},
) => {
  const options = await ctx.h.send(
    '/api/auth/passkey/generate-register-options',
    { token: null, headers: { Cookie: session.cookies, Origin: AUTH_ORIGIN } },
  );
  assert.equal(options.status, 200, await options.clone().text());
  const body = (await options.json()) as {
    challenge: string;
    rp: { id: string };
    authenticatorSelection: { userVerification: string; residentKey: string };
  };
  assert.equal(body.authenticatorSelection.userVerification, 'required');
  assert.equal(body.authenticatorSelection.residentKey, 'required');
  const cookies = cookiesFrom(options.headers, session.cookies);
  const input = {
    name: 'Test passkey',
    response: device.registration({
      challenge: body.challenge,
      rpId: body.rp.id,
      origin: AUTH_ORIGIN,
      ...overrides,
    }),
  };
  const result = await ctx.h.send('/api/auth/passkey/verify-registration', {
    token: null,
    headers: { Cookie: cookies, Origin: AUTH_ORIGIN },
    body: JSON.stringify(input),
  });
  return { result, input, cookies };
};
const authenticate = async (
  ctx: Context,
  device: ReturnType<typeof authenticator>,
  overrides: Overrides = {},
) => {
  const options = await ctx.h.send(
    '/api/auth/passkey/generate-authenticate-options',
    { token: null, headers: { Origin: AUTH_ORIGIN } },
  );
  assert.equal(options.status, 200);
  const body = (await options.json()) as {
    challenge: string;
    rpId: string;
    userVerification: string;
  };
  assert.equal(body.userVerification, 'required');
  const cookies = cookiesFrom(options.headers);
  const input = {
    response: device.authentication({
      challenge: body.challenge,
      rpId: body.rpId,
      origin: AUTH_ORIGIN,
      ...overrides,
    }),
  };
  const result = await ctx.h.send('/api/auth/passkey/verify-authentication', {
    token: null,
    headers: { Cookie: cookies, Origin: AUTH_ORIGIN },
    body: JSON.stringify(input),
  });
  return { result, input, cookies };
};

integration(
  'WebAuthn registration and a signed assertion access the same cycling profile after restart',
  async (ctx) => {
    const google = await ctx.login();
    assert.equal(
      (
        await ctx.h.send('/users', {
          token: google.token,
          body: JSON.stringify({ displayName: 'Passkey rider' }),
        })
      ).status,
      201,
    );
    const device = authenticator();
    const registered = await register(ctx, device, google);
    assert.equal(
      registered.result.status,
      200,
      await registered.result.clone().text(),
    );
    const passkey = (await registered.result.json()) as { id: string };
    await ctx.h.restart();
    const signed = await authenticate(ctx, device);
    assert.equal(signed.result.status, 200, await signed.result.clone().text());
    const token = signed.result.headers.get('set-auth-token');
    assert.ok(token);
    const profile = await ctx.h.send('/users/me', { token });
    assert.equal(
      ((await profile.json()) as { user: { displayName: string } }).user
        .displayName,
      'Passkey rider',
    );
    assert.equal(
      (
        await ctx.h.send('/api/auth/passkey/update-passkey', {
          token,
          body: JSON.stringify({ id: passkey.id, name: 'My phone' }),
        })
      ).status,
      200,
    );
    const listed = (await (
      await ctx.h.send('/api/auth/passkey/list-user-passkeys', { token })
    ).json()) as { id: string; name: string }[];
    assert.equal(listed[0]?.name, 'My phone');
    assert.equal(
      (
        await ctx.h.send('/api/auth/passkey/delete-passkey', {
          token,
          body: JSON.stringify({ id: passkey.id }),
        })
      ).status,
      200,
    );
    assert.notEqual(
      (await authenticate(ctx, device, { counter: 2 })).result.status,
      200,
    );
  },
);

integration(
  'passkey registration requires recent login and is bound to the initiating user',
  async (ctx) => {
    assert.equal(
      (
        await ctx.h.send('/api/auth/passkey/generate-register-options', {
          token: null,
        })
      ).status,
      401,
    );
    const alice = await ctx.login();
    const bob = await ctx.login('google', {
      subject: 'bob',
      email: 'bob@example.test',
    });
    const device = authenticator();
    const options = await ctx.h.send(
      '/api/auth/passkey/generate-register-options',
      { token: alice.token },
    );
    const values = (await options.json()) as {
      challenge: string;
      rp: { id: string };
    };
    const confused = await ctx.h.send('/api/auth/passkey/verify-registration', {
      token: bob.token,
      headers: { Cookie: cookiesFrom(options.headers), Origin: AUTH_ORIGIN },
      body: JSON.stringify({
        response: device.registration({
          challenge: values.challenge,
          rpId: values.rp.id,
          origin: AUTH_ORIGIN,
        }),
      }),
    });
    assert.equal(confused.status, 401);
    const registered = await register(ctx, device, alice);
    assert.equal(registered.result.status, 200);
    const passkey = (await registered.result.json()) as { id: string };
    assert.notEqual(
      (
        await ctx.h.send('/api/auth/passkey/delete-passkey', {
          token: bob.token,
          body: JSON.stringify({ id: passkey.id }),
        })
      ).status,
      200,
    );
    assert.deepEqual(
      await (
        await ctx.h.send('/api/auth/passkey/list-user-passkeys', {
          token: bob.token,
        })
      ).json(),
      [],
    );
    const db = await ctx.h.runtime.getD1Database('ROUTES_DB');
    await db
      .prepare('UPDATE auth_session SET createdAt = ?')
      .bind(new Date(Date.now() - 700000).toISOString())
      .run();
    assert.equal(
      (
        await ctx.h.send('/api/auth/passkey/generate-register-options', {
          token: alice.token,
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await ctx.h.send('/api/auth/passkey/delete-passkey', {
          token: alice.token,
          body: JSON.stringify({ id: passkey.id }),
        })
      ).status,
      403,
    );
  },
);

for (const invalid of [
  { origin: 'https://attacker.test' },
  { rpId: 'attacker.test' },
  { challenge: 'wrong-challenge' },
  { verified: false },
]) {
  integration(
    `WebAuthn registration rejects ${Object.keys(invalid)[0]} without saving a credential`,
    async (ctx) => {
      const session = await ctx.login();
      const result = await register(ctx, authenticator(), session, invalid);
      assert.notEqual(result.result.status, 200);
      assert.deepEqual(
        await (
          await ctx.h.send('/api/auth/passkey/list-user-passkeys', {
            token: session.token,
          })
        ).json(),
        [],
      );
    },
  );
}

integration(
  'passkey assertions verify origin, RP ID, challenge, signature and user verification; challenges are single-use',
  async (ctx) => {
    const session = await ctx.login();
    const device = authenticator();
    assert.equal((await register(ctx, device, session)).result.status, 200);
    for (const invalid of [
      { origin: 'https://attacker.test' },
      { rpId: 'attacker.test' },
      { challenge: 'wrong-challenge' },
      { badSignature: true },
      { verified: false },
    ]) {
      const rejected = await authenticate(ctx, device, invalid);
      assert.notEqual(rejected.result.status, 200);
      assert.equal(rejected.result.headers.get('set-auth-token'), null);
    }
    const signed = await authenticate(ctx, device);
    assert.equal(signed.result.status, 200);
    const replay = await ctx.h.send('/api/auth/passkey/verify-authentication', {
      token: null,
      headers: { Cookie: signed.cookies, Origin: AUTH_ORIGIN },
      body: JSON.stringify(signed.input),
    });
    assert.equal(replay.status, 400);
    assert.equal(replay.headers.get('set-auth-token'), null);
    assert.notEqual(
      (await authenticate(ctx, device, { counter: 1 })).result.status,
      200,
    );
  },
);

integration(
  'expired WebAuthn challenges cannot create a session',
  async (ctx) => {
    const session = await ctx.login();
    const device = authenticator();
    assert.equal((await register(ctx, device, session)).result.status, 200);
    const response = await ctx.h.send(
      '/api/auth/passkey/generate-authenticate-options',
      { token: null },
    );
    const options = (await response.json()) as {
      challenge: string;
      rpId: string;
    };
    const db = await ctx.h.runtime.getD1Database('ROUTES_DB');
    await db
      .prepare('UPDATE auth_verification SET expiresAt = ?')
      .bind(new Date(Date.now() - 1000).toISOString())
      .run();
    const denied = await ctx.h.send('/api/auth/passkey/verify-authentication', {
      token: null,
      headers: { Cookie: cookiesFrom(response.headers), Origin: AUTH_ORIGIN },
      body: JSON.stringify({
        response: device.authentication({ ...options, origin: AUTH_ORIGIN }),
      }),
    });
    assert.equal(denied.status, 400);
    assert.equal(denied.headers.get('set-auth-token'), null);
  },
);
