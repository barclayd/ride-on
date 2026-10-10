import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HttpResponse, http } from 'msw';
import { upload } from './client.ts';
import { ALICE_TOKEN, BOB_TOKEN } from './harness.ts';
import {
  AUTH_ORIGIN,
  CLIENT_ORIGIN,
  CLIENT_REDIRECT,
  challenge,
  closeHarness,
  cookiesFrom,
  createOAuthHarness,
} from './oauth.ts';

const integration = (
  name: string,
  run: (ctx: Awaited<ReturnType<typeof createOAuthHarness>>) => Promise<void>,
) =>
  test(name, { timeout: 20000 }, async () => {
    const ctx = await createOAuthHarness();
    try {
      await run(ctx);
    } finally {
      await closeHarness(ctx.h);
    }
  });

integration(
  'Google code exchange creates a durable session; profile migration preserves routes, preferences and selection',
  async ({ h, login }) => {
    const route = await upload(h);
    assert.equal(
      (
        await h.send('/users', {
          body: JSON.stringify({
            displayName: 'Existing rider',
            settings: { riding: { averageSpeedKph: 24 } },
          }),
        })
      ).status,
      201,
    );
    assert.equal(
      (
        await h.send('/route-selection', {
          method: 'PUT',
          body: JSON.stringify({ expectedVersion: 0, routeIds: [route.id] }),
        })
      ).status,
      200,
    );
    const session = await login();
    const me = await h.send('/auth/me', { token: session.token });
    assert.equal(
      ((await me.json()) as { ownerId: string | null }).ownerId,
      null,
    );
    const claim = await h.send('/auth/claim-profile', {
      token: session.token,
      body: JSON.stringify({ apiKey: ALICE_TOKEN }),
    });
    assert.equal(claim.status, 200, await claim.clone().text());
    assert.equal(
      (
        await h.send('/auth/claim-profile', {
          token: session.token,
          body: JSON.stringify({ apiKey: ALICE_TOKEN }),
        })
      ).status,
      200,
    );
    await h.restart();
    const profile = await h.send('/users/me', { token: session.token });
    assert.equal(profile.status, 200);
    assert.equal(
      ((await profile.json()) as { user: { displayName: string } }).user
        .displayName,
      'Existing rider',
    );
    assert.equal(
      (await h.send(`/routes/${route.id}`, { token: session.token })).status,
      200,
    );
    assert.equal(
      (await h.send(`/routes/${route.id}`, { token: BOB_TOKEN })).status,
      404,
    );
    assert.deepEqual(
      (
        (await (
          await h.send('/route-selection', { token: session.token })
        ).json()) as { selection: { routeIds: string[] } }
      ).selection.routeIds,
      [route.id],
    );
    const db = await h.runtime.getD1Database('ROUTES_DB');
    const account = await db
      .prepare('SELECT accessToken, refreshToken FROM auth_account')
      .first<{ accessToken: string; refreshToken: string }>();
    assert.ok(account?.accessToken && account.refreshToken);
    assert.notEqual(account.accessToken, 'synthetic-provider-access-token');
    assert.notEqual(account.refreshToken, 'synthetic-provider-refresh-token');
  },
);

integration(
  'Apple form_post, signed client secret and returning sign-in work without repeating the display name',
  async ({ h, login, begin }) => {
    const start = await begin('apple');
    assert.ok(
      start.response.headers
        .getSetCookie()
        .some(
          (c) =>
            c.includes('ride-on.state') &&
            c.includes('SameSite=None') &&
            c.includes('Secure'),
        ),
    );
    const first = await login('apple', {
      email: 'private@privaterelay.appleid.com',
    });
    const second = await login('apple', {
      email: 'private@privaterelay.appleid.com',
      name: '',
    });
    const one = (await (
      await h.send('/auth/me', { token: first.token })
    ).json()) as { user: { id: string } };
    const two = (await (
      await h.send('/auth/me', { token: second.token })
    ).json()) as { user: { id: string } };
    assert.equal(one.user.id, two.user.id);
  },
);

integration(
  'Apple can be explicitly linked despite private relay; same-email sign-in never links implicitly',
  async ({ h, login, begin, callback }) => {
    const google = await login();
    const collision = await begin('apple');
    const denied = await callback(collision.url, collision.cookies);
    assert.match(
      denied.response.headers.get('Location') ?? '',
      /error=account_not_linked/,
    );
    assert.equal(denied.response.headers.get('set-auth-token'), null);
    const link = await begin('apple', google.cookies, true);
    const linked = await callback(link.url, link.cookies, {
      email: 'private@privaterelay.appleid.com',
    });
    assert.equal(
      linked.response.headers.get('Location'),
      `${AUTH_ORIGIN}/auth/me`,
    );
    const apple = await login('apple', {
      email: 'private@privaterelay.appleid.com',
    });
    const one = (await (
      await h.send('/auth/me', { token: google.token })
    ).json()) as { user: { id: string } };
    const two = (await (
      await h.send('/auth/me', { token: apple.token })
    ).json()) as { user: { id: string } };
    assert.equal(one.user.id, two.user.id);
    const accounts = await h.send('/api/auth/list-accounts', {
      token: google.token,
    });
    assert.equal(((await accounts.json()) as unknown[]).length, 2);
  },
);

integration(
  'signed state is bound to the browser; replay and attacker redirects cannot create sessions',
  async ({ h, begin, callback }) => {
    const start = await begin();
    const noCookie = await callback(start.url, '');
    assert.match(
      noCookie.response.headers.get('Location') ?? '',
      /error=state_mismatch/,
    );
    const complete = await callback(start.url, start.cookies);
    assert.ok(complete.response.headers.get('set-auth-token'));
    const replay = await h.send(complete.callbackPath, {
      token: null,
      headers: { Cookie: start.cookies },
    });
    assert.equal(replay.headers.get('set-auth-token'), null);
    assert.match(replay.headers.get('Location') ?? '', /error=/);
    const openRedirect = await h.send('/api/auth/sign-in/social', {
      token: null,
      body: JSON.stringify({
        provider: 'google',
        callbackURL: 'https://attacker.test/stolen',
      }),
      headers: { Origin: AUTH_ORIGIN },
    });
    assert.equal(openRedirect.status, 403);
  },
);

for (const invalid of [
  { audience: 'wrong-client' },
  { issuer: 'https://attacker.test' },
  { expired: true },
  { badSignature: true },
]) {
  integration(
    `provider ID token ${Object.keys(invalid)[0]} fails verification before any account or session exists`,
    async ({ h, begin, callback }) => {
      const start = await begin();
      const rejected = await callback(start.url, start.cookies, invalid);
      assert.equal(rejected.response.headers.get('set-auth-token'), null);
      assert.match(rejected.response.headers.get('Location') ?? '', /error=/);
      const db = await h.runtime.getD1Database('ROUTES_DB');
      assert.equal(
        (
          await db
            .prepare('SELECT COUNT(*) AS count FROM auth_user')
            .first<{ count: number }>()
        )?.count,
        0,
      );
    },
  );
}

integration(
  'provider outages do not leak credentials or leave a partially registered account',
  async ({ h, handlers, begin, callback, config }) => {
    h.use(
      http.post('https://oauth2.googleapis.com/token', () =>
        HttpResponse.json(
          { error: `upstream failed ${config.google.clientSecret}` },
          { status: 503 },
        ),
      ),
      ...handlers,
    );
    const start = await begin();
    const failed = await callback(start.url, start.cookies);
    assert.equal(failed.response.headers.get('set-auth-token'), null);
    assert.ok(
      !(await failed.response.text()).includes(config.google.clientSecret),
    );
    assert.ok(
      !failed.response.headers
        .get('Location')
        ?.includes(config.google.clientSecret),
    );
  },
);

integration(
  'sessions isolate rider data; invalid explicit tokens cannot fall back to cookies; CSRF is rejected',
  async ({ h, login }) => {
    const alice = await login();
    const bob = await login('google', {
      subject: 'second-rider',
      email: 'other@example.test',
    });
    assert.equal(
      (
        await h.send('/users', {
          token: alice.token,
          body: JSON.stringify({ displayName: 'Alice' }),
        })
      ).status,
      201,
    );
    assert.equal((await h.send('/users/me', { token: bob.token })).status, 404);
    assert.equal(
      (
        await h.send('/users/me', {
          token: 'invalid-bearer',
          headers: { Cookie: alice.cookies },
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await h.send('/api/auth/get-session', {
          token: 'invalid-bearer',
          headers: { Cookie: alice.cookies },
        })
      ).status,
      200,
    );
    assert.equal(
      await (
        await h.send('/api/auth/get-session', {
          token: 'invalid-bearer',
          headers: { Cookie: alice.cookies },
        })
      ).json(),
      null,
    );
    for (const origin of [undefined, 'https://attacker.test']) {
      const changed = await h.send('/users/me', {
        token: null,
        method: 'PATCH',
        body: JSON.stringify({ expectedVersion: 1, displayName: 'Stolen' }),
        headers: {
          Cookie: alice.cookies,
          ...(origin ? { Origin: origin } : {}),
        },
      });
      assert.equal(changed.status, 403);
    }
    assert.equal(
      (
        await h.send('/users/me', {
          token: null,
          method: 'PATCH',
          body: JSON.stringify({ expectedVersion: 1, displayName: 'Updated' }),
          headers: { Cookie: alice.cookies, Origin: CLIENT_ORIGIN },
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await h.send('/users/me', {
          token: null,
          method: 'OPTIONS',
          headers: { Origin: CLIENT_ORIGIN },
        })
      ).headers.get('Access-Control-Allow-Origin'),
      CLIENT_ORIGIN,
    );
    assert.equal(
      (
        await h.send('/users/me', {
          token: null,
          method: 'OPTIONS',
          headers: { Origin: 'https://attacker.test' },
        })
      ).status,
      403,
    );
  },
);

integration(
  'logout and session revocation take effect immediately; expired sessions fail closed',
  async ({ h, login }) => {
    const first = await login();
    const second = await login();
    const me = (await (
      await h.send('/api/auth/get-session', { token: second.token })
    ).json()) as { session: { token: string } };
    assert.equal(
      (
        await h.send('/api/auth/revoke-session', {
          token: first.token,
          body: JSON.stringify({ token: me.session.token }),
        })
      ).status,
      200,
    );
    assert.equal(
      (await h.send('/auth/me', { token: second.token })).status,
      401,
    );
    assert.equal(
      (await h.send('/api/auth/sign-out', { token: first.token, body: '{}' }))
        .status,
      200,
    );
    assert.equal(
      (await h.send('/auth/me', { token: first.token })).status,
      401,
    );
    const expired = await login();
    const db = await h.runtime.getD1Database('ROUTES_DB');
    await db
      .prepare('UPDATE auth_session SET expiresAt = ?')
      .bind(new Date(Date.now() - 1000).toISOString())
      .run();
    assert.equal(
      (await h.send('/routes', { token: expired.token })).status,
      401,
    );
  },
);

integration(
  'profile claims are immutable and exclusive, including simultaneous claims',
  async ({ h, login }) => {
    const one = await login();
    const two = await login('google', {
      subject: 'other',
      email: 'other@example.test',
    });
    const results = await Promise.all(
      [one, two].map((session) =>
        h.send('/auth/claim-profile', {
          token: session.token,
          body: JSON.stringify({ apiKey: ALICE_TOKEN }),
        }),
      ),
    );
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    const winner = results[0]?.status === 200 ? one : two;
    assert.equal(
      (
        await h.send('/auth/claim-profile', {
          token: winner.token,
          body: JSON.stringify({ apiKey: BOB_TOKEN }),
        })
      ).status,
      409,
    );
    const fresh = await login('google', {
      subject: 'fresh',
      email: 'fresh@example.test',
    });
    assert.equal((await h.send('/routes', { token: fresh.token })).status, 200);
    assert.equal(
      (
        await h.send('/auth/claim-profile', {
          token: fresh.token,
          body: JSON.stringify({ apiKey: BOB_TOKEN }),
        })
      ).status,
      409,
    );
    const db = await h.runtime.getD1Database('ROUTES_DB');
    await db
      .prepare('UPDATE auth_session SET createdAt = ?')
      .bind(new Date(Date.now() - 700_000).toISOString())
      .run();
    assert.equal(
      (
        await h.send('/auth/claim-profile', {
          token: winner.token,
          body: JSON.stringify({ apiKey: ALICE_TOKEN }),
        })
      ).status,
      403,
    );
  },
);

integration(
  'extension handoff requires PKCE and exact redirect; a code can be redeemed once even concurrently',
  async ({ h, callback }) => {
    const verifier = 'client-verifier-with-43-characters-at-least-123456789';
    const start = await h.send('/auth/browser/start', {
      token: null,
      body: JSON.stringify({
        provider: 'google',
        redirectUri: CLIENT_REDIRECT,
        codeChallenge: challenge(verifier),
        state: 'client-state-123456789',
      }),
    });
    assert.equal(start.status, 201);
    const { authorizationUrl } = (await start.json()) as {
      authorizationUrl: string;
    };
    const authorize = await h.send(authorizationUrl, { token: null });
    assert.equal(authorize.status, 302);
    const oauth = await callback(
      authorize.headers.get('Location') ?? '',
      cookiesFrom(authorize.headers),
    );
    const complete = await h.send(
      oauth.response.headers.get('Location') ?? '',
      { token: null, headers: { Cookie: oauth.cookies } },
    );
    assert.equal(complete.status, 302, await complete.clone().text());
    const destination = new URL(complete.headers.get('Location') ?? '');
    assert.equal(destination.origin + destination.pathname, CLIENT_REDIRECT);
    assert.equal(
      destination.searchParams.get('state'),
      'client-state-123456789',
    );
    assert.equal(destination.searchParams.has('token'), false);
    assert.equal(complete.headers.get('Referrer-Policy'), 'no-referrer');
    const body = {
      code: destination.searchParams.get('code'),
      codeVerifier: verifier,
      redirectUri: CLIENT_REDIRECT,
    };
    assert.equal(
      (
        await h.send('/auth/browser/exchange', {
          token: null,
          body: JSON.stringify({
            ...body,
            codeVerifier:
              'wrong-verifier-with-43-characters-at-least-123456789',
          }),
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await h.send('/auth/browser/exchange', {
          token: null,
          body: JSON.stringify({
            ...body,
            redirectUri: 'https://attacker.test',
          }),
        })
      ).status,
      400,
    );
    const results = await Promise.all(
      [1, 2].map(() =>
        h.send('/auth/browser/exchange', {
          token: null,
          body: JSON.stringify(body),
        }),
      ),
    );
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 400]);
    const success = results.find((r) => r.status === 200);
    assert.ok(success);
    const session = (await success.json()) as { token: string };
    assert.equal(
      (await h.send('/routes', { token: session.token })).status,
      200,
    );
  },
);

integration(
  'disabled providers, unregistered redirects, oversized auth and unused auth features are rejected',
  async ({ h, config }) => {
    await h.restart({
      AUTH_CONFIG_JSON: JSON.stringify({ ...config, google: undefined }),
    });
    assert.equal(
      (
        await h.send('/api/auth/sign-in/social', {
          token: null,
          body: JSON.stringify({ provider: 'google' }),
          headers: { Origin: AUTH_ORIGIN },
        })
      ).status,
      503,
    );
    assert.equal(
      (
        await h.send('/auth/browser/start', {
          token: null,
          body: JSON.stringify({
            provider: 'apple',
            redirectUri: 'https://attacker.test',
            codeChallenge: challenge('test'),
            state: 'client-state-123456789',
          }),
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await h.send('/api/auth/sign-in/social', {
          token: null,
          body: 'x'.repeat(65000),
          headers: { Origin: AUTH_ORIGIN },
        })
      ).status,
      413,
    );
    assert.equal(
      (await h.send('/api/auth/sign-in/email', { token: null, body: '{}' }))
        .status,
      404,
    );
    assert.equal(
      (await h.send('/api/auth/get-access-token', { token: null, body: '{}' }))
        .status,
      404,
    );
    assert.equal((await h.send('/routes')).status, 200);
  },
);

integration(
  'login rate limits persist across Worker restarts',
  async ({ h }) => {
    const body = JSON.stringify({
      provider: 'google',
      redirectUri: CLIENT_REDIRECT,
      codeChallenge: challenge('test'),
      state: 'client-state-123456789',
    });
    for (let i = 0; i < 30; i++)
      assert.equal(
        (await h.send('/auth/browser/start', { token: null, body })).status,
        201,
      );
    await h.restart();
    const blocked = await h.send('/auth/browser/start', { token: null, body });
    assert.equal(blocked.status, 429);
    assert.equal(blocked.headers.get('Retry-After'), '60');
  },
);

integration(
  'expired browser flows and a pre-existing session cannot complete a new handoff',
  async ({ h, login }) => {
    const previous = await login();
    const db = await h.runtime.getD1Database('ROUTES_DB');
    await db
      .prepare('UPDATE auth_session SET createdAt = ?')
      .bind(new Date(Date.now() - 60000).toISOString())
      .run();
    const start = await h.send('/auth/browser/start', {
      token: null,
      body: JSON.stringify({
        provider: 'google',
        redirectUri: CLIENT_REDIRECT,
        codeChallenge: challenge('test'),
        state: 'client-state-123456789',
      }),
    });
    const { authorizationUrl } = (await start.json()) as {
      authorizationUrl: string;
    };
    const authorize = await h.send(authorizationUrl, { token: null });
    const id = new URL(authorizationUrl).searchParams.get('request');
    const complete = await h.send(`/auth/browser/complete?request=${id}`, {
      token: null,
      headers: { Cookie: cookiesFrom(authorize.headers, previous.cookies) },
    });
    assert.equal(complete.status, 400);
    await db
      .prepare('UPDATE auth_browser_flows SET expires_at = ?')
      .bind(Date.now() - 1)
      .run();
    assert.equal((await h.send(authorizationUrl, { token: null })).status, 400);
  },
);

integration(
  'provider unlink cannot remove the final OAuth recovery method',
  async ({ h, login }) => {
    const session = await login();
    const result = await h.send('/api/auth/unlink-account', {
      token: session.token,
      body: JSON.stringify({ providerId: 'google' }),
    });
    assert.equal(result.status, 400);
    assert.equal(
      (await h.send('/auth/me', { token: session.token })).status,
      200,
    );
  },
);
