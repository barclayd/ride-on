import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { type Encodable, Encoder, type Mesg } from '@garmin/fitsdk';
import { HttpResponse } from 'msw';
import { agentScopes } from '../src/identity/mcp.ts';
import { fingerprint } from '../src/recommendations/fingerprint.ts';
import { replayScore } from '../src/recommendations/replay.ts';
import type { evaluateComparisons } from '../src/recommendations/service.ts';
import { hourlyForecast, metOffice, routeGpx } from './fixtures.ts';
import {
  ALICE_TOKEN,
  BOB_TOKEN,
  createHarness,
  type Harness,
  RIDE_DATE,
} from './harness.ts';
import { AUTH_ORIGIN, closeHarness, createOAuthHarness } from './oauth.ts';

const integration = (name: string, run: (h: Harness) => Promise<void>) =>
  test(name, { timeout: 30_000 }, async () => {
    const h = await createHarness();
    try {
      await run(h);
    } finally {
      await closeHarness(h);
    }
  });
const keyInput = { name: 'Al', scopes: [...agentScopes] };
const issue = async (
  h: Harness,
  token = ALICE_TOKEN,
  scopes: readonly string[] = agentScopes,
) => {
  const response = await h.send('/auth/api-keys', {
    token,
    body: JSON.stringify({ name: 'Al', scopes }),
  });
  assert.equal(response.status, 201, await response.clone().text());
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  return (await response.json()) as {
    key: string;
    id: string;
    prefix: string;
    scopes: string[];
    expiresAt: string;
  };
};
const call = (
  h: Harness,
  key: string,
  operation: string,
  input: unknown = {},
) =>
  h.send(`/agent/v1/${operation}`, { token: key, body: JSON.stringify(input) });

integration(
  'account API keys are hashed, listed privately, revocable and expire',
  async (h) => {
    const alice = await issue(h);
    assert.match(alice.key, /^ro_agent_[a-f0-9]{64}$/);
    assert.equal(alice.prefix, alice.key.slice(0, 17));
    assert.deepEqual(alice.scopes, agentScopes);
    assert.ok(
      new Date(alice.expiresAt).getTime() > Date.now() + 89 * 86400_000,
    );
    const db = await h.runtime.getD1Database('ROUTES_DB');
    const row = await db
      .prepare('SELECT * FROM agent_api_keys WHERE id = ?')
      .bind(alice.id)
      .first();
    assert.equal(
      row?.token_hash,
      createHash('sha256').update(alice.key).digest('hex'),
    );
    assert.ok(!JSON.stringify(row).includes(alice.key));
    let list = await h.send('/auth/api-keys');
    const listed = (await list.json()) as {
      keys: Record<string, unknown>[];
      nextCursor: string | null;
    };
    assert.equal(listed.keys[0]?.id, alice.id);
    assert.equal(listed.keys[0]?.key, undefined);
    assert.equal(listed.keys[0]?.token_hash, undefined);
    assert.equal(listed.keys[0]?.lastUsedAt, null);
    assert.equal((await call(h, alice.key, 'list_routes')).status, 200);
    list = await h.send('/auth/api-keys');
    assert.ok(
      ((await list.json()) as { keys: { lastUsedAt: string }[] }).keys[0]
        ?.lastUsedAt,
    );
    assert.deepEqual(
      (
        (await (
          await h.send('/auth/api-keys', { token: BOB_TOKEN })
        ).json()) as { keys: unknown[] }
      ).keys,
      [],
    );
    assert.equal(
      (
        await h.send(`/auth/api-keys/${alice.id}`, {
          token: BOB_TOKEN,
          method: 'DELETE',
        })
      ).status,
      404,
    );
    assert.equal((await call(h, alice.key, 'list_routes')).status, 200);
    assert.equal(
      (await h.send(`/auth/api-keys/${alice.id}`, { method: 'DELETE' })).status,
      204,
    );
    assert.equal(
      (await h.send(`/auth/api-keys/${alice.id}`, { method: 'DELETE' })).status,
      204,
    );
    assert.equal((await call(h, alice.key, 'list_routes')).status, 401);
    const expired = await issue(h);
    await db
      .prepare('UPDATE agent_api_keys SET expires_at = ? WHERE id = ?')
      .bind(Date.now() - 1, expired.id)
      .run();
    assert.equal((await call(h, expired.key, 'list_routes')).status, 401);
    const deleted = await issue(h, BOB_TOKEN);
    await db.prepare('DELETE FROM auth_user WHERE id = ?').bind('bob').run();
    assert.equal((await call(h, deleted.key, 'list_routes')).status, 401);
    assert.equal(
      await db
        .prepare('SELECT id FROM agent_api_keys WHERE id = ?')
        .bind(deleted.id)
        .first(),
      null,
    );
  },
);

integration(
  'agent keys cannot escalate into app sessions, key management or MCP OAuth',
  async (h) => {
    const key = await issue(h, ALICE_TOKEN, ['routes:read']);
    for (const path of [
      '/auth/api-keys',
      '/auth/me',
      '/users/me',
      '/routes',
      '/mcp',
    ])
      assert.equal((await h.send(path, { token: key.key })).status, 401, path);
    assert.equal(
      (
        await h.send('/auth/api-keys', {
          token: key.key,
          body: JSON.stringify(keyInput),
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await h.send(`/auth/api-keys/${key.id}`, {
          token: key.key,
          method: 'DELETE',
        })
      ).status,
      401,
    );
    assert.equal((await call(h, key.key, 'get_preferences')).status, 403);
    const denied = await call(h, key.key, 'add_route', {
      file: { format: 'gpx', content: routeGpx('Candidate') },
    });
    assert.equal(denied.status, 403);
    assert.match(denied.headers.get('WWW-Authenticate') ?? '', /routes:write/);
    assert.equal(
      (
        await call(h, key.key, 'score_routes', {
          routeIds: [],
          date: RIDE_DATE,
        })
      ).status,
      403,
    );
    assert.equal((await call(h, ALICE_TOKEN, 'list_routes')).status, 401);
    assert.equal(
      (await h.send('/agent/v1/list_routes', { token: null, body: '{bad' }))
        .status,
      401,
    );
    assert.equal(
      (
        await h.send(`/agent/v1/list_routes?api_key=${key.key}`, {
          token: null,
          body: '{}',
        })
      ).status,
      401,
    );
    assert.equal(
      (await call(h, `${key.key.slice(0, -1)}g`, 'list_routes')).status,
      401,
    );
    assert.equal(
      (await call(h, key.key, 'list_routes', { userId: 'bob' })).status,
      400,
    );
    assert.equal((await call(h, key.key, 'not_a_tool')).status, 404);
  },
);

integration(
  'key issuance validates scopes, recent login, limits and pagination',
  async (h) => {
    for (const input of [
      { ...keyInput, ownerId: 'bob' },
      { ...keyInput, scopes: ['offline_access'] },
      { ...keyInput, scopes: ['routes:read', 'routes:read'] },
      { ...keyInput, scopes: [] },
      { ...keyInput, expiresInDays: 0 },
      { ...keyInput, expiresInDays: 366 },
      { ...keyInput, expiresInDays: null },
      { ...keyInput, name: ' ' },
    ])
      assert.equal(
        (await h.send('/auth/api-keys', { body: JSON.stringify(input) }))
          .status,
        400,
      );
    const db = await h.runtime.getD1Database('ROUTES_DB');
    await db
      .prepare('UPDATE auth_session SET createdAt = ? WHERE userId = ?')
      .bind(new Date(Date.now() - 660_000).toISOString(), 'bob')
      .run();
    const stale = await h.send('/auth/api-keys', {
      token: BOB_TOKEN,
      body: JSON.stringify(keyInput),
    });
    assert.equal(stale.status, 403);
    assert.equal(
      ((await stale.json()) as { error: { code: string } }).error.code,
      'RECENT_LOGIN_REQUIRED',
    );
    const issued = await Promise.all(
      Array.from({ length: 21 }, () =>
        h.send('/auth/api-keys', { body: JSON.stringify(keyInput) }),
      ),
    );
    assert.equal(issued.filter((r) => r.status === 201).length, 20);
    assert.equal(issued.filter((r) => r.status === 409).length, 1);
    const ids: string[] = [];
    let cursor: string | null = null;
    do {
      const page = (await (
        await h.send(
          `/auth/api-keys?limit=7${cursor ? `&cursor=${cursor}` : ''}`,
        )
      ).json()) as { keys: { id: string }[]; nextCursor: string | null };
      ids.push(...page.keys.map((k) => k.id));
      cursor = page.nextCursor;
    } while (cursor);
    assert.equal(new Set(ids).size, 20);
    await h.send(`/auth/api-keys/${ids[0]}`, { method: 'DELETE' });
    assert.ok((await issue(h)).key);
  },
);

integration(
  'API key rate limits admit requests atomically and reset',
  async (h) => {
    const key = await issue(h);
    const db = await h.runtime.getD1Database('ROUTES_DB');
    // A request arriving with an older timestamp must not roll a later window
    // backwards. This also keeps the concurrency assertion stable at a boundary.
    await db
      .prepare('UPDATE agent_api_keys SET request_window = ? WHERE id = ?')
      .bind(Math.floor(Date.now() / 60_000) + 1, key.id)
      .run();
    const responses = await Promise.all(
      Array.from({ length: 61 }, () => call(h, key.key, 'list_routes')),
    );
    assert.equal(responses.filter((r) => r.status === 200).length, 60);
    const limited = responses.find((r) => r.status === 429);
    assert.ok(limited);
    assert.ok(Number(limited.headers.get('Retry-After')) > 0);
    await db
      .prepare('UPDATE agent_api_keys SET request_window = 0 WHERE id = ?')
      .bind(key.id)
      .run();
    assert.equal((await call(h, key.key, 'list_routes')).status, 200);
  },
);

test('key management preserves cookie origin checks and rejects credential fallback', {
  timeout: 30_000,
}, async () => {
  const { h, login } = await createOAuthHarness();
  try {
    const account = await login();
    await h.send('/users', {
      token: account.token,
      body: JSON.stringify({ displayName: 'Alice' }),
    });
    for (const headers of [
      { Cookie: account.cookies },
      { Cookie: account.cookies, Origin: 'https://evil.test' },
    ] as Record<string, string>[])
      assert.equal(
        (
          await h.send('/auth/api-keys', {
            token: null,
            headers,
            body: JSON.stringify(keyInput),
          })
        ).status,
        403,
      );
    const created = await h.send('/auth/api-keys', {
      token: null,
      headers: { Cookie: account.cookies, Origin: AUTH_ORIGIN },
      body: JSON.stringify(keyInput),
    });
    assert.equal(created.status, 201);
    const key = (await created.json()) as { key: string; id: string };
    assert.equal(
      (
        await h.send('/auth/api-keys', {
          token: 'invalid',
          headers: { Cookie: account.cookies, Origin: AUTH_ORIGIN },
          body: JSON.stringify(keyInput),
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await h.send(`/auth/api-keys/${key.id}`, {
          token: null,
          headers: { Cookie: account.cookies, Origin: 'https://evil.test' },
          method: 'DELETE',
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await h.send('/agent/v1/list_routes', {
          token: null,
          headers: { Cookie: account.cookies },
          body: '{}',
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await h.send('/auth/api-keys', {
          token: key.key,
          headers: { Cookie: account.cookies, Origin: AUTH_ORIGIN },
          body: JSON.stringify(keyInput),
        })
      ).status,
      401,
    );
  } finally {
    await closeHarness(h);
  }
});

integration(
  'agent HTTP operations isolate accounts, score and replay GPX/FIT without saving',
  async (h) => {
    h.use(
      metOffice(({ request }) => HttpResponse.json(hourlyForecast(request))),
    );
    for (const [token, displayName, averageSpeedKph] of [
      [ALICE_TOKEN, 'Alice', 20],
      [BOB_TOKEN, 'Bob', 30],
    ] as const)
      assert.equal(
        (
          await h.send('/users', {
            token,
            body: JSON.stringify({
              displayName,
              settings: {
                weather: { mode: 'strict', providerId: 'met-office' },
                forecast: {
                  representation: 'deterministic',
                  freshnessBasis: 'model-run',
                },
                riding: { averageSpeedKph },
                preferences: { weights: { sunshine: 0 } },
              },
            }),
          })
        ).status,
        201,
      );
    const alice = await issue(h);
    const bob = await issue(h, BOB_TOKEN);
    assert.equal(
      (
        (await (await call(h, alice.key, 'get_preferences')).json()) as {
          displayName: string;
        }
      ).displayName,
      'Alice',
    );
    assert.equal(
      (
        (await (await call(h, bob.key, 'get_preferences')).json()) as {
          displayName: string;
        }
      ).displayName,
      'Bob',
    );
    const file = { format: 'gpx', content: routeGpx('Candidate') };
    const saved = await call(h, alice.key, 'add_route', { file });
    assert.equal(saved.status, 200);
    const { route } = (await saved.json()) as { route: { id: string } };
    assert.equal(
      (
        (await (await call(h, alice.key, 'add_route', { file })).json()) as {
          outcome: string;
        }
      ).outcome,
      'unchanged',
    );
    assert.equal(
      (
        await call(h, bob.key, 'score_routes', {
          routeIds: [route.id],
          date: RIDE_DATE,
        })
      ).status,
      404,
    );
    assert.deepEqual(
      (
        (await (await call(h, bob.key, 'list_routes')).json()) as {
          routes: unknown[];
        }
      ).routes,
      [],
    );
    const response = await call(h, alice.key, 'score_route_file', {
      file,
      date: RIDE_DATE,
      includeReplay: true,
    });
    assert.equal(response.status, 200, await response.clone().text());
    type Score = {
      saved: boolean;
      evidence: {
        replay: NonNullable<
          Awaited<ReturnType<typeof evaluateComparisons>>['replay']
        >;
      };
      evidenceSha256: string;
      rankings: { best: { score: number } }[];
    };
    const scored = (await response.json()) as Score;
    assert.equal(scored.saved, false);
    assert.equal(await fingerprint(scored.evidence), scored.evidenceSha256);
    const replay = scored.evidence.replay[0];
    assert.ok(replay);
    assert.equal(
      replayScore(replay).rankings[0]?.best?.score,
      scored.rankings[0]?.best.score,
    );
    const savedScore = await call(h, alice.key, 'score_routes', {
      routeIds: [route.id],
      date: RIDE_DATE,
    });
    assert.equal(savedScore.status, 200);
    assert.equal(
      ((await savedScore.json()) as Score).rankings[0]?.best.score,
      scored.rankings[0]?.best.score,
    );
    const fileOnly = await issue(h, ALICE_TOKEN, [
      'rides:score',
      'preferences:read',
    ]);
    assert.equal(
      (
        await call(h, fileOnly.key, 'score_route_file', {
          file,
          date: RIDE_DATE,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await call(h, fileOnly.key, 'score_routes', {
          routeIds: [route.id],
          date: RIDE_DATE,
        })
      ).status,
      403,
    );
    const noPreferences = await issue(h, ALICE_TOKEN, [
      'rides:score',
      'routes:read',
    ]);
    assert.equal(
      (
        await call(h, noPreferences.key, 'score_route_file', {
          file,
          date: RIDE_DATE,
        })
      ).status,
      403,
    );
    const fit = new Encoder();
    const write = <T extends Encodable<Mesg>>(message: T) =>
      fit.writeMesg(message);
    write({
      mesgNum: 0,
      type: 'course',
      manufacturer: 'development',
      product: 1,
    });
    for (const latitude of [51.5, 51.51, 51.52])
      write({
        mesgNum: 20,
        positionLat: Math.round((latitude / 180) * 2 ** 31),
        positionLong: Math.round((-0.1 / 180) * 2 ** 31),
        altitude: 10,
        heartRate: 123,
      });
    const fitFile = {
      format: 'fit',
      content: Buffer.from(fit.close()).toString('base64'),
    };
    const fitScore = await call(h, alice.key, 'score_route_file', {
      file: fitFile,
      date: RIDE_DATE,
    });
    assert.equal(fitScore.status, 200, await fitScore.clone().text());
    assert.equal(((await fitScore.json()) as Score).saved, false);
    assert.equal(
      (
        (await (await call(h, alice.key, 'list_routes')).json()) as {
          routes: unknown[];
        }
      ).routes.length,
      1,
    );
    assert.equal(
      (await call(h, alice.key, 'add_route', { file: fitFile })).status,
      200,
    );
    assert.equal(
      (
        (await (await call(h, alice.key, 'list_routes')).json()) as {
          routes: unknown[];
        }
      ).routes.length,
      2,
    );
    assert.equal(
      (
        await call(h, alice.key, 'score_routes', {
          routeIds: [route.id, route.id],
          date: RIDE_DATE,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await call(h, alice.key, 'score_route_file', {
          file,
          date: '2000-01-01',
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await call(h, alice.key, 'add_route', {
          file: { format: 'fit', content: 'not base64!' },
        })
      ).status,
      422,
    );
    assert.equal(
      (
        await h.send('/agent/v1/get_preferences', {
          token: alice.key,
          body: '{}',
          contentType: 'text/plain',
        })
      ).status,
      415,
    );
    assert.equal(
      (
        await h.send('/agent/v1/get_preferences', {
          token: alice.key,
          body: ' '.repeat(64_001),
        })
      ).status,
      413,
    );
    assert.equal(
      (
        await h.send('/users/me', {
          method: 'PATCH',
          body: JSON.stringify({
            expectedVersion: 1,
            settings: {
              riding: { averageSpeedKph: 27 },
              timeZone: 'Europe/London',
            },
          }),
        })
      ).status,
      200,
    );
    const updated = await call(h, alice.key, 'score_routes', {
      routeIds: [route.id],
      date: RIDE_DATE,
    });
    assert.equal(updated.status, 200);
    const latest = (await updated.json()) as {
      evidence: {
        preferenceVersion: number;
        settings: { riding: { averageSpeedKph: number } };
      };
    };
    assert.equal(latest.evidence.preferenceVersion, 2);
    assert.equal(latest.evidence.settings.riding.averageSpeedKph, 27);
    await h.restart({ TEST_NOW: '2026-10-20T12:00:00.000Z' });
    const ambiguous = await call(h, alice.key, 'score_route_file', {
      file,
      date: '2026-10-25',
      window: { start: '01:30', end: '03:30' },
    });
    assert.equal(ambiguous.status, 400, await ambiguous.clone().text());
    assert.equal(
      ((await ambiguous.json()) as { error: { code: string } }).error.code,
      'INVALID_INPUT',
    );
  },
);

integration(
  'internal key command creates a private file without printing secrets, lists and revokes',
  async (h) => {
    const directory = await mkdtemp(join(tmpdir(), 'ride-on-agent-key-'));
    const sessionFile = join(directory, 'session.txt');
    const keyFile = join(directory, 'key.json');
    await writeFile(sessionFile, ALICE_TOKEN, { mode: 0o600 });
    const server = createServer(async (request, response) => {
      try {
        const parts: Buffer[] = [];
        for await (const chunk of request) parts.push(Buffer.from(chunk));
        const result = await h.send(request.url ?? '/', {
          method: request.method,
          token: request.headers.authorization?.slice('Bearer '.length),
          ...(parts.length ? { body: Buffer.concat(parts).toString() } : {}),
        });
        response.writeHead(result.status, Object.fromEntries(result.headers));
        response.end(Buffer.from(await result.arrayBuffer()));
      } catch {
        response.writeHead(500);
        response.end();
      }
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const run = (...args: string[]) =>
      promisify(execFile)('bun', [
        'scripts/agent-keys.ts',
        ...args,
        '--session',
        sessionFile,
        '--local',
        '--local-port',
        String(address.port),
      ]);
    try {
      const args = [
        'create',
        '--name',
        'CLI agent',
        '--scopes',
        'routes:read',
        '--out',
        keyFile,
      ];
      const created = await run(...args);
      const stored = JSON.parse(await readFile(keyFile, 'utf8')) as {
        key: string;
        id: string;
      };
      assert.match(stored.key, /^ro_agent_/);
      assert.equal((await stat(keyFile)).mode & 0o777, 0o600);
      assert.ok(!created.stdout.includes(stored.key));
      assert.ok(!created.stdout.includes(ALICE_TOKEN));
      assert.equal(created.stderr, '');
      assert.equal((await call(h, stored.key, 'list_routes')).status, 200);
      await assert.rejects(run(...args), /EEXIST/);
      const listed = await run('list');
      assert.equal((JSON.parse(listed.stdout) as { id: string }[]).length, 1);
      assert.ok(!listed.stdout.includes(stored.key));
      await run('revoke', stored.id);
      assert.equal((await call(h, stored.key, 'list_routes')).status, 401);
      await chmod(sessionFile, 0o644);
      await assert.rejects(run('list'), /private session file/);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    }
  },
);
