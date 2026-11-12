import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
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
import {
  AUTH_ORIGIN,
  challenge,
  closeHarness,
  cookiesFrom,
  createOAuthHarness,
} from './oauth.ts';

const resource = `${AUTH_ORIGIN}/mcp`;
const allScopes = [...agentScopes, 'offline_access'].join(' ');
const verifier = 'a'.repeat(43);
const register = async (h: Harness) => {
  const response = await h.send('/api/auth/oauth2/register', {
    token: null,
    body: JSON.stringify({
      client_name: 'Test agent <script>',
      redirect_uris: ['http://127.0.0.1:8765/callback'],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    }),
  });
  assert.equal(response.status, 201, await response.clone().text());
  return (await response.json()) as { client_id: string };
};
const authorize = async (
  h: Harness,
  clientId: string,
  token: string | null,
  scope = allScopes,
) => {
  const query = new URLSearchParams({
    client_id: clientId,
    redirect_uri: 'http://127.0.0.1:8765/callback',
    response_type: 'code',
    prompt: 'consent',
    code_challenge: challenge(verifier),
    code_challenge_method: 'S256',
    state: 'independent-agent-state',
    scope,
    resource,
  });
  const response = await h.send(`/api/auth/oauth2/authorize?${query}`, {
    token,
    contentType: 'text/html',
    headers: { Accept: 'text/html', 'x-test-navigation': '1' },
  });
  assert.equal(response.status, 302, await response.clone().text());
  return new URL(response.headers.get('Location') ?? '', AUTH_ORIGIN);
};
const consent = async (
  h: Harness,
  url: URL,
  token: string | null,
  accept = true,
  headers: Record<string, string> = {},
) => {
  const response = await h.send('/api/auth/oauth2/consent', {
    token,
    headers: { Origin: AUTH_ORIGIN, ...headers },
    body: JSON.stringify({ accept, oauth_query: url.search.slice(1) }),
  });
  assert.equal(response.status, 200, await response.clone().text());
  return new URL(((await response.json()) as { url: string }).url);
};
const exchange = (
  h: Harness,
  clientId: string,
  code: string,
  codeVerifier = verifier,
) =>
  h.send('/api/auth/oauth2/token', {
    token: null,
    contentType: 'application/x-www-form-urlencoded',
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      code_verifier: codeVerifier,
      redirect_uri: 'http://127.0.0.1:8765/callback',
      resource,
    }).toString(),
  });
const delegate = async (h: Harness, token = ALICE_TOKEN, scope = allScopes) => {
  const client = await register(h);
  const url = await authorize(h, client.client_id, token, scope);
  assert.equal(url.pathname, '/auth/agents/consent');
  const callback = await consent(h, url, token);
  assert.equal(callback.searchParams.get('state'), 'independent-agent-state');
  const response = await exchange(
    h,
    client.client_id,
    callback.searchParams.get('code') ?? '',
  );
  assert.equal(response.status, 200, await response.clone().text());
  return {
    ...client,
    ...((await response.json()) as {
      access_token: string;
      refresh_token: string;
    }),
  };
};
const mcpClient = async (h: Harness, token: string, modern = false) => {
  const client = new Client(
    { name: 'ride-on-integration', version: '1' },
    modern
      ? {
          versionNegotiation: { mode: { pin: '2026-07-28' } },
        }
      : {},
  );
  const transport = new StreamableHTTPClientTransport(new URL(resource), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
    fetch: async (input, init) => {
      const request = new Request(input, init);
      const response = await h.runtime.dispatchFetch(request.url, {
        method: request.method,
        headers: Object.fromEntries(request.headers),
        body: request.body ? await request.text() : undefined,
      });
      return new Response(await response.arrayBuffer(), {
        status: response.status,
        headers: Object.fromEntries(response.headers),
      });
    },
  });
  await client.connect(transport);
  return client;
};
const call = async (
  client: Client,
  params: { name: string; arguments: Record<string, unknown> },
) =>
  (await client.callTool(params)) as {
    structuredContent?: Record<string, unknown>;
    isError?: boolean;
    _meta?: Record<string, unknown>;
  };
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
  'OAuth discovery, PKCE, signed consent, code replay and audience binding',
  async (h) => {
    const unauthenticated = await h.send('/mcp', { token: null });
    assert.equal(unauthenticated.status, 401);
    assert.match(
      unauthenticated.headers.get('WWW-Authenticate') ?? '',
      /oauth-protected-resource\/mcp/,
    );
    for (const path of [
      '/.well-known/oauth-protected-resource/mcp',
      '/.well-known/oauth-authorization-server/api/auth',
    ]) {
      const response = await h.send(path, { token: null });
      assert.equal(response.status, 200, await response.clone().text());
      assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
    }
    assert.equal(
      (await h.send('/mcp')).status,
      401,
      'An app session is not an agent grant',
    );
    assert.equal(
      (await h.send('/api/auth/internal/mcp-access', { body: '{}' })).status,
      404,
    );
    const { client_id } = await register(h);
    const url = await authorize(h, client_id, ALICE_TOKEN);
    const page = await h.send(url.href);
    assert.equal(page.status, 200, await page.clone().text());
    assert.match(await page.text(), /&lt;script&gt;/);
    const tampered = new URL(url);
    tampered.searchParams.set('scope', 'routes:write');
    assert.equal((await h.send(tampered.href)).status, 400);
    const callback = await consent(h, url, ALICE_TOKEN);
    const code = callback.searchParams.get('code') ?? '';
    assert.equal(
      (await exchange(h, client_id, code, 'b'.repeat(43))).status,
      400,
    );
    // Invalid verifier attempts may consume a code; start a fresh explicit consent.
    const next = await authorize(h, client_id, ALICE_TOKEN);
    const nextCallback =
      next.pathname === '/auth/agents/consent'
        ? await consent(h, next, ALICE_TOKEN)
        : next;
    const freshCode = nextCallback.searchParams.get('code') ?? '';
    assert.equal((await exchange(h, client_id, freshCode)).status, 200);
    assert.equal((await exchange(h, client_id, freshCode)).status, 400);
    const denied = await delegate(h, BOB_TOKEN, 'routes:read');
    const db = await h.runtime.getD1Database('ROUTES_DB');
    await db
      .prepare('UPDATE oauthAccessToken SET resources = ? WHERE clientId = ?')
      .bind(JSON.stringify(['https://other.test/mcp']), denied.client_id)
      .run();
    assert.equal(
      (await h.send('/mcp', { token: denied.access_token })).status,
      401,
    );
  },
);

integration(
  'MCP tools isolate riders, enforce scopes, save idempotently and score files without saving',
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
    const alice = await delegate(h);
    const bob = await delegate(h, BOB_TOKEN);
    const client = await mcpClient(h, alice.access_token);
    const other = await mcpClient(h, bob.access_token, true);
    try {
      const tools = await client.listTools();
      assert.equal(tools.tools.length, 5);
      const preferences = await call(client, {
        name: 'get_preferences',
        arguments: {},
      });
      assert.equal(preferences.structuredContent?.displayName, 'Alice');
      assert.equal(
        (await call(other, { name: 'get_preferences', arguments: {} }))
          .structuredContent?.displayName,
        'Bob',
      );
      assert.equal(
        (
          await call(client, {
            name: 'get_preferences',
            arguments: { userId: 'bob' },
          })
        ).isError,
        true,
      );
      const file = { format: 'gpx', content: routeGpx('Candidate') };
      const saved = await call(client, {
        name: 'add_route',
        arguments: { file },
      });
      assert.equal(saved.isError, undefined, JSON.stringify(saved));
      const route = saved.structuredContent?.route as { id: string };
      assert.equal(
        (await call(client, { name: 'add_route', arguments: { file } }))
          .structuredContent?.outcome,
        'unchanged',
      );
      const foreign = await call(other, {
        name: 'score_routes',
        arguments: { routeIds: [route.id], date: RIDE_DATE },
      });
      assert.equal(foreign.isError, true);
      assert.deepEqual(
        (await call(other, { name: 'list_routes', arguments: {} }))
          .structuredContent?.routes,
        [],
      );
      const candidate = await call(client, {
        name: 'score_route_file',
        arguments: { file, date: RIDE_DATE, includeReplay: true },
      });
      assert.equal(candidate.isError, undefined, JSON.stringify(candidate));
      const output = candidate.structuredContent as {
        evidence: {
          replay: NonNullable<
            Awaited<ReturnType<typeof evaluateComparisons>>['replay']
          >;
        };
        evidenceSha256: string;
        rankings: { best: { score: number } }[];
      };
      assert.ok(output.rankings[0]?.best);
      assert.equal(await fingerprint(output.evidence), output.evidenceSha256);
      const replay = output.evidence.replay[0];
      assert.ok(replay);
      const result = replayScore(replay);
      assert.equal(
        result.rankings[0]?.best?.score,
        output.rankings[0].best.score,
      );
      const directory = await mkdtemp(join(tmpdir(), 'ride-on-replay-'));
      const evidencePath = join(directory, 'assessment.json');
      try {
        await writeFile(evidencePath, JSON.stringify(output));
        const replayed = JSON.parse(
          execFileSync('bun', ['scripts/replay-mcp.ts', evidencePath], {
            encoding: 'utf8',
          }),
        );
        assert.equal(
          replayed[0].result.rankings[0].best.score,
          output.rankings[0].best.score,
        );
        await writeFile(
          evidencePath,
          JSON.stringify({ ...output, evidenceSha256: 'tampered' }),
        );
        assert.throws(
          () =>
            execFileSync('bun', ['scripts/replay-mcp.ts', evidencePath], {
              stdio: 'pipe',
            }),
          /checksum does not match/,
        );
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
      const library = (
        await call(client, { name: 'list_routes', arguments: {} })
      ).structuredContent?.routes as unknown[];
      assert.equal(library.length, 1);
      const savedScore = await call(client, {
        name: 'score_routes',
        arguments: { routeIds: [route.id], date: RIDE_DATE },
      });
      assert.equal(savedScore.isError, undefined, JSON.stringify(savedScore));
      const rankings = savedScore.structuredContent
        ?.rankings as typeof output.rankings;
      assert.equal(rankings[0]?.best.score, output.rankings[0].best.score);
      const issued = await h.send('/auth/api-keys', {
        body: JSON.stringify({ name: 'HTTP comparison', scopes: agentScopes }),
      });
      assert.equal(issued.status, 201);
      const { key } = (await issued.json()) as { key: string };
      const httpScore = await h.send('/agent/v1/score_routes', {
        token: key,
        body: JSON.stringify({ routeIds: [route.id], date: RIDE_DATE }),
      });
      assert.equal(httpScore.status, 200);
      assert.deepEqual(
        await httpScore.json(),
        savedScore.structuredContent,
        'HTTP and MCP return exactly the same scoring result',
      );
      const duplicate = await h.send('/agent/v1/add_route', {
        token: key,
        body: JSON.stringify({ file }),
      });
      assert.equal(
        ((await duplicate.json()) as { outcome: string }).outcome,
        'unchanged',
      );
      for (const path of ['/auth/api-keys', '/agent/v1/get_preferences'])
        assert.equal(
          (await h.send(path, { token: alice.access_token, body: '{}' }))
            .status,
          401,
        );

      assert.equal(
        (await h.send('/users/me', { token: alice.access_token })).status,
        401,
        'Agent credentials cannot use app APIs',
      );
    } finally {
      await client.close();
      await other.close();
    }
    const limited = await delegate(h, ALICE_TOKEN, 'routes:read');
    const reader = await mcpClient(h, limited.access_token);
    try {
      const denied = await call(reader, {
        name: 'add_route',
        arguments: { file: { format: 'gpx', content: routeGpx('No access') } },
      });
      assert.equal(denied.isError, true);
      assert.ok(denied._meta?.['mcp/www_authenticate']);
    } finally {
      await reader.close();
    }
  },
);

integration(
  'disconnect immediately stops access and refresh tokens rotate',
  async (h) => {
    const agent = await delegate(h);
    const refresh = (token: string) =>
      h.send('/api/auth/oauth2/token', {
        token: null,
        contentType: 'application/x-www-form-urlencoded',
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: agent.client_id,
          refresh_token: token,
          resource,
        }).toString(),
      });
    const refreshed = await refresh(agent.refresh_token);
    assert.equal(refreshed.status, 200, await refreshed.clone().text());
    const tokens = (await refreshed.json()) as {
      access_token: string;
      refresh_token: string;
    };
    assert.notEqual(tokens.refresh_token, agent.refresh_token);
    assert.equal(
      (await h.send('/mcp', { token: tokens.access_token })).status,
      405,
    );
    await h.send('/auth/agents/revoke', {
      token: BOB_TOKEN,
      headers: { Origin: AUTH_ORIGIN },
      body: JSON.stringify({ clientId: agent.client_id }),
    });
    assert.equal(
      (await h.send('/mcp', { token: tokens.access_token })).status,
      405,
      'Other users cannot revoke this grant',
    );
    assert.equal(
      (
        await h.send('/auth/agents/revoke', {
          headers: { Origin: AUTH_ORIGIN },
          body: JSON.stringify({ clientId: agent.client_id }),
        })
      ).status,
      200,
    );
    assert.equal(
      (await h.send('/mcp', { token: tokens.access_token })).status,
      401,
    );
    assert.equal((await refresh(tokens.refresh_token)).status, 400);
  },
);

integration(
  'expired tokens, refresh replay, cross-site requests and RFC token revocation are rejected',
  async (h) => {
    const agent = await delegate(h);
    assert.equal(
      (
        await h.send('/mcp', {
          token: agent.access_token,
          headers: { Origin: 'https://untrusted.test' },
        })
      ).status,
      403,
    );
    const db = await h.runtime.getD1Database('ROUTES_DB');
    await db
      .prepare('UPDATE oauthAccessToken SET expiresAt = ? WHERE clientId = ?')
      .bind(Date.now() - 3600_000, agent.client_id)
      .run();
    assert.equal(
      (await h.send('/mcp', { token: agent.access_token })).status,
      401,
    );
    await db
      .prepare('UPDATE oauthRefreshToken SET expiresAt = ? WHERE clientId = ?')
      .bind(Date.now() - 3600_000, agent.client_id)
      .run();
    const refresh = (clientId: string, token: string) =>
      h.send('/api/auth/oauth2/token', {
        token: null,
        contentType: 'application/x-www-form-urlencoded',
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: clientId,
          refresh_token: token,
          resource,
        }).toString(),
      });
    assert.equal(
      (await refresh(agent.client_id, agent.refresh_token)).status,
      400,
    );
    const rotating = await delegate(h);
    assert.equal(
      (await refresh(rotating.client_id, rotating.refresh_token)).status,
      200,
    );
    assert.equal(
      (await refresh(rotating.client_id, rotating.refresh_token)).status,
      400,
    );
    const revoked = await delegate(h);
    const response = await h.send('/api/auth/oauth2/revoke', {
      token: null,
      contentType: 'application/x-www-form-urlencoded',
      body: new URLSearchParams({
        client_id: revoked.client_id,
        token: revoked.access_token,
        token_type_hint: 'access_token',
      }).toString(),
    });
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal(
      (await h.send('/mcp', { token: revoked.access_token })).status,
      401,
    );
  },
);

test('MCP OAuth completes browser sign-in through Google and returns to consent', {
  timeout: 30_000,
}, async () => {
  const { h, callback } = await createOAuthHarness();
  try {
    const client = await register(h);
    const url = await authorize(h, client.client_id, null);
    assert.equal(url.pathname, '/auth/agents/sign-in');
    assert.equal((await h.send(url.href, { token: null })).status, 200);
    const start = await h.send('/api/auth/sign-in/social', {
      token: null,
      headers: { Origin: AUTH_ORIGIN },
      body: JSON.stringify({
        provider: 'google',
        callbackURL: `${AUTH_ORIGIN}/auth/agents/consent${url.search}`,
        oauth_query: url.search.slice(1),
        disableRedirect: true,
      }),
    });
    assert.equal(start.status, 200, await start.clone().text());
    const login = await callback(
      ((await start.json()) as { url: string }).url,
      cookiesFrom(start.headers),
    );
    const target = new URL(login.response.headers.get('Location') ?? '');
    assert.equal(target.pathname, '/auth/agents/consent');
    const screen = await h.send(target.href, {
      token: null,
      headers: { Cookie: login.cookies },
    });
    assert.equal(screen.status, 200, await screen.clone().text());
    const crossSite = await h.send('/api/auth/oauth2/consent', {
      token: null,
      headers: { Cookie: login.cookies, Origin: 'https://untrusted.test' },
      body: JSON.stringify({
        accept: true,
        oauth_query: target.search.slice(1),
      }),
    });
    assert.equal(crossSite.status, 403);
    const denied = await consent(h, target, null, false, {
      Cookie: login.cookies,
    });
    assert.equal(denied.searchParams.get('error'), 'access_denied');
  } finally {
    await closeHarness(h);
  }
});
