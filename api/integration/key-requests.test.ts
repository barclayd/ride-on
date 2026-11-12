import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmod, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import {
  ALICE_TOKEN,
  BOB_TOKEN,
  createHarness,
  type Harness,
} from './harness.ts';
import {
  AUTH_ORIGIN,
  closeHarness,
  cookiesFrom,
  createOAuthHarness,
} from './oauth.ts';

const input = {
  name: 'Al',
  scopes: ['preferences:read', 'routes:read', 'rides:score'],
  expiresInDays: 90,
};
const newKey = () => `ro_agent_${randomBytes(32).toString('hex')}`;
type Setup = {
  requestId: string;
  verificationUri: string;
  userCode: string;
  expiresAt: string;
};
const start = async (h: Harness, key = newKey()) => {
  const response = await h.send('/auth/api-key-requests', {
    token: key,
    body: JSON.stringify(input),
  });
  assert.equal(response.status, 201, await response.clone().text());
  return { key, ...((await response.json()) as Setup) };
};
const poll = (h: Harness, key: string) =>
  h.send('/auth/api-key-requests/status', { token: key, body: '{}' });
const decision = (
  h: Harness,
  setup: Setup,
  options: {
    accept?: boolean;
    token?: string | null;
    headers?: Record<string, string>;
    userCode?: string;
  } = {},
) =>
  h.send('/auth/api-key-requests/decision', {
    token: options.token,
    headers: options.headers,
    body: JSON.stringify({
      requestId: setup.requestId,
      userCode: options.userCode ?? setup.userCode,
      accept: options.accept ?? true,
    }),
  });
const integration = (name: string, run: (h: Harness) => Promise<void>) =>
  test(name, { timeout: 30_000 }, async () => {
    const h = await createHarness();
    try {
      await run(h);
    } finally {
      await closeHarness(h);
    }
  });

integration(
  'phone pairing activates only the approved scopes and account without transferring a session or secret',
  async (h) => {
    const setup = await start(h);
    assert.ok(!setup.verificationUri.includes(setup.key));
    assert.equal(
      (await h.send('/agent/v1/list_routes', { token: setup.key, body: '{}' }))
        .status,
      401,
    );
    const pending = await poll(h, setup.key);
    assert.equal(pending.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(await pending.json(), { status: 'pending' });
    const anonymous = await h.send(setup.verificationUri, { token: null });
    assert.match(await anonymous.text(), /Sign in on this phone/);
    const page = await h.send(setup.verificationUri);
    assert.match(
      page.headers.get('Content-Security-Policy') ?? '',
      /frame-ancestors 'none'/,
    );
    assert.equal(page.headers.get('Referrer-Policy'), 'no-referrer');
    const text = await page.text();
    assert.match(text, /alice@example.test/);
    assert.ok(text.includes(setup.userCode));
    assert.match(text, /id="approve-key" disabled/);
    assert.ok(!text.includes(setup.key));
    assert.ok(!text.includes(ALICE_TOKEN));
    assert.equal((await poll(h, setup.requestId)).status, 401);
    assert.equal((await decision(h, setup, { token: setup.key })).status, 401);
    assert.equal(
      (await decision(h, setup, { userCode: '0000-0000' })).status,
      400,
    );
    assert.equal((await decision(h, setup)).status, 200);
    const completed = await poll(h, setup.key);
    const data = (await completed.json()) as {
      status: string;
      credential: { id: string; scopes: string[] };
      account: { email: string };
    };
    assert.equal(data.status, 'approved');
    assert.deepEqual(data.credential.scopes, input.scopes);
    assert.equal(data.account.email, 'alice@example.test');
    assert.ok(!JSON.stringify(data).includes(setup.key));
    assert.ok(!JSON.stringify(data).includes(ALICE_TOKEN));
    assert.equal(
      (await h.send('/agent/v1/list_routes', { token: setup.key, body: '{}' }))
        .status,
      200,
    );
    assert.equal(
      (await h.send('/agent/v1/add_route', { token: setup.key, body: '{}' }))
        .status,
      403,
    );
    assert.equal(
      (await h.send('/auth/api-keys', { token: setup.key })).status,
      401,
    );
    assert.equal((await decision(h, setup, { token: BOB_TOKEN })).status, 400);
    assert.equal((await decision(h, setup)).status, 200);
    const db = await h.runtime.getD1Database('ROUTES_DB');
    const rows = await db.prepare('SELECT * FROM agent_key_requests').all();
    assert.ok(!JSON.stringify(rows.results).includes(setup.key));
    assert.equal(
      (
        await db
          .prepare('SELECT COUNT(*) AS n FROM agent_api_keys')
          .first<{ n: number }>()
      )?.n,
      1,
    );
    await h.send(`/auth/api-keys/${data.credential.id}`, { method: 'DELETE' });
    assert.equal((await poll(h, setup.key)).status, 400);
    assert.equal(
      (await h.send('/agent/v1/list_routes', { token: setup.key, body: '{}' }))
        .status,
      401,
    );
  },
);

integration(
  'pairing rejects expired, denied, unbound and stale approvals and immutable-field changes',
  async (h) => {
    const db = await h.runtime.getD1Database('ROUTES_DB');
    const stale = await start(h);
    await db
      .prepare('UPDATE auth_session SET createdAt = ? WHERE userId = ?')
      .bind(new Date(Date.now() - 700_000).toISOString(), 'alice')
      .run();
    assert.equal((await decision(h, stale)).status, 403);
    assert.match(
      await (await h.send(stale.verificationUri)).text(),
      /Sign in on this phone/,
    );
    await db
      .prepare('UPDATE auth_session SET createdAt = ? WHERE userId = ?')
      .bind(new Date().toISOString(), 'alice')
      .run();
    await db
      .prepare('DELETE FROM auth_user_owners WHERE auth_user_id = ?')
      .bind('bob')
      .run();
    assert.equal((await decision(h, stale, { token: BOB_TOKEN })).status, 403);
    assert.equal(
      (
        await h.send('/auth/api-key-requests', {
          token: stale.key,
          body: JSON.stringify({ ...input, scopes: ['routes:write'] }),
        })
      ).status,
      409,
    );
    await db
      .prepare('UPDATE agent_key_requests SET expires_at = ? WHERE id = ?')
      .bind(Date.now() - 1, stale.requestId)
      .run();
    assert.equal((await decision(h, stale)).status, 400);
    assert.deepEqual(await (await poll(h, stale.key)).json(), {
      status: 'expired',
    });
    const denied = await start(h);
    assert.equal((await decision(h, denied, { accept: false })).status, 200);
    assert.equal((await decision(h, denied)).status, 400);
    assert.deepEqual(await (await poll(h, denied.key)).json(), {
      status: 'denied',
    });
    assert.equal(
      (
        await db
          .prepare('SELECT COUNT(*) AS n FROM agent_api_keys')
          .first<{ n: number }>()
      )?.n,
      0,
    );
  },
);

integration(
  'parallel approvals create exactly one key and preserve the account limit',
  async (h) => {
    const setup = await start(h);
    const outcomes = await Promise.all(
      Array.from({ length: 4 }, () => decision(h, setup)),
    );
    assert.ok(outcomes.every((response) => response.status === 200));
    const db = await h.runtime.getD1Database('ROUTES_DB');
    assert.equal(
      (
        await db
          .prepare('SELECT COUNT(*) AS n FROM agent_api_keys')
          .first<{ n: number }>()
      )?.n,
      1,
    );
    for (let index = 0; index < 19; index++)
      assert.equal(
        (await h.send('/auth/api-keys', { body: JSON.stringify(input) }))
          .status,
        201,
      );
    const extra = await start(h);
    assert.equal((await decision(h, extra)).status, 409);
    assert.deepEqual(await (await poll(h, extra.key)).json(), {
      status: 'pending',
    });
    assert.equal(
      (
        await db
          .prepare('SELECT COUNT(*) AS n FROM agent_api_keys')
          .first<{ n: number }>()
      )?.n,
      20,
    );
  },
);

integration(
  'setup starts and polling are bounded and reject unsupported fields',
  async (h) => {
    const setup = await start(h);
    assert.equal(
      (
        await h.send('/auth/api-key-requests', {
          token: newKey(),
          body: JSON.stringify({ ...input, userId: 'bob' }),
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await h.send('/auth/api-key-requests', {
          token: newKey(),
          body: JSON.stringify({ ...input, scopes: ['admin'] }),
        })
      ).status,
      400,
    );
    await start(h);
    await start(h);
    assert.equal(
      (
        await h.send('/auth/api-key-requests', {
          token: newKey(),
          body: JSON.stringify(input),
        })
      ).status,
      429,
    );
    for (let index = 0; index < 30; index++)
      assert.equal((await poll(h, setup.key)).status, 200);
    const limited = await poll(h, setup.key);
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get('Retry-After'), '60');
  },
);

test('phone Apple login returns to its setup and cookie approval enforces origin', {
  timeout: 30_000,
}, async () => {
  const { h, callback } = await createOAuthHarness();
  try {
    const setup = await start(h);
    const begin = await h.send('/api/auth/sign-in/social', {
      token: null,
      headers: { Origin: AUTH_ORIGIN },
      body: JSON.stringify({
        provider: 'apple',
        callbackURL: setup.verificationUri,
        errorCallbackURL: setup.verificationUri,
        disableRedirect: true,
      }),
    });
    assert.equal(begin.status, 200);
    const result = await callback(
      ((await begin.json()) as { url: string }).url,
      cookiesFrom(begin.headers),
    );
    assert.equal(
      result.response.headers.get('Location'),
      setup.verificationUri,
    );
    const me = await h.send('/auth/me', {
      token: null,
      headers: { Cookie: result.cookies },
    });
    const user = (await me.json()) as { user: { id: string } };
    const db = await h.runtime.getD1Database('ROUTES_DB');
    await db
      .prepare(
        'INSERT INTO auth_user_owners(auth_user_id, owner_id) VALUES (?, ?)',
      )
      .bind(user.user.id, 'rider')
      .run();
    assert.equal(
      (
        await decision(h, setup, {
          token: null,
          headers: { Cookie: result.cookies },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await decision(h, setup, {
          token: null,
          headers: { Cookie: result.cookies, Origin: 'https://evil.example' },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await decision(h, setup, {
          token: null,
          headers: { Cookie: result.cookies, Origin: AUTH_ORIGIN },
        })
      ).status,
      200,
    );
    assert.equal((await poll(h, setup.key)).status, 200);
  } finally {
    await closeHarness(h);
  }
});

integration(
  'phone CLI resumes one private setup without a local account session or printed secret',
  async (h) => {
    const directory = await mkdtemp(join(tmpdir(), 'ride-on-phone-'));
    const out = join(directory, 'al.json');
    let origin = '';
    const server = createServer(async (request, response) => {
      const parts: Buffer[] = [];
      for await (const chunk of request) parts.push(Buffer.from(chunk));
      const result = await h.send(request.url ?? '/', {
        method: request.method,
        token: request.headers.authorization?.slice(7) ?? null,
        body: Buffer.concat(parts).toString(),
      });
      const data = (await result.json()) as Record<string, unknown>;
      if (typeof data.verificationUri === 'string')
        data.verificationUri = data.verificationUri.replace(
          AUTH_ORIGIN,
          origin,
        );
      response.writeHead(result.status, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(data));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    origin = `http://127.0.0.1:${address.port}`;
    const run = (...args: string[]) =>
      promisify(execFile)('bun', [
        'scripts/agent-keys.ts',
        'pair',
        '--out',
        out,
        '--local',
        '--local-port',
        String(address.port),
        ...args,
      ]);
    try {
      const started = await run(
        '--name',
        input.name,
        '--scopes',
        input.scopes.join(','),
        '--start-only',
      );
      const pending = JSON.parse(await readFile(`${out}.pending`, 'utf8')) as {
        key: string;
      };
      assert.equal((await stat(`${out}.pending`)).mode & 0o777, 0o600);
      assert.ok(!started.stdout.includes(pending.key));
      assert.equal(started.stderr, '');
      await chmod(`${out}.pending`, 0o644);
      await assert.rejects(run('--start-only'), /private/);
      await chmod(`${out}.pending`, 0o600);
      const resumed = await run('--start-only');
      assert.equal(resumed.stdout, started.stdout);
      const id = /request=([a-f0-9]{64})/.exec(started.stdout)?.[1];
      const code = /code: ([A-F0-9]{4}-[A-F0-9]{4})/.exec(started.stdout)?.[1];
      assert.ok(id && code);
      assert.equal(
        (
          await decision(h, {
            requestId: id,
            userCode: code,
            verificationUri: '',
            expiresAt: '',
          })
        ).status,
        200,
      );
      const finished = await run();
      const saved = JSON.parse(await readFile(out, 'utf8')) as {
        key: string;
        id: string;
      };
      assert.equal(saved.key, pending.key);
      assert.equal((await stat(out)).mode & 0o777, 0o600);
      assert.ok(!finished.stdout.includes(saved.key));
      assert.equal(finished.stderr, '');
      await assert.rejects(stat(`${out}.pending`), { code: 'ENOENT' });
      await assert.rejects(run(), /already exists/);
      assert.equal(
        (
          await h.send('/agent/v1/list_routes', {
            token: saved.key,
            body: '{}',
          })
        ).status,
        200,
      );
      const db = await h.runtime.getD1Database('ROUTES_DB');
      assert.equal(
        (
          await db
            .prepare('SELECT COUNT(*) AS n FROM agent_api_keys')
            .first<{ n: number }>()
        )?.n,
        1,
      );
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    }
  },
);

integration(
  'old links cannot be revived and competing accounts cannot rebind a request',
  async (h) => {
    const setup = await start(h);
    const db = await h.runtime.getD1Database('ROUTES_DB');
    await db
      .prepare('UPDATE agent_key_requests SET expires_at = ? WHERE id = ?')
      .bind(Date.now() - 2 * 86400_000, setup.requestId)
      .run();
    const replacement = await start(h, setup.key);
    assert.notEqual(replacement.requestId, setup.requestId);
    assert.equal((await decision(h, setup)).status, 400);
    const outcomes = await Promise.all([
      decision(h, replacement),
      decision(h, replacement, { token: BOB_TOKEN }),
    ]);
    assert.deepEqual(outcomes.map((r) => r.status).sort(), [200, 400]);
    const winner = (await (await poll(h, setup.key)).json()) as {
      account: { email: string };
    };
    const losingToken =
      winner.account.email === 'alice@example.test' ? BOB_TOKEN : ALICE_TOKEN;
    assert.equal(
      (await decision(h, replacement, { token: losingToken })).status,
      400,
    );
    // Approval remains recoverable if the computer resumes after the phone's deadline.
    await db
      .prepare('UPDATE agent_key_requests SET expires_at = ? WHERE id = ?')
      .bind(Date.now() - 60_000, replacement.requestId)
      .run();
    assert.equal((await poll(h, setup.key)).status, 200);
    assert.equal(
      (
        await db
          .prepare('SELECT COUNT(*) AS n FROM agent_api_keys')
          .first<{ n: number }>()
      )?.n,
      1,
    );
  },
);
