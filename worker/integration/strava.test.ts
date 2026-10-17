import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { HttpResponse, http } from 'msw';
import { z } from 'zod';
import {
  ALICE_TOKEN,
  BOB_TOKEN,
  createHarness,
  type Harness,
} from './harness.ts';

const bridgeOrigin = 'https://strava-stitch.internal';
const verifier = 'v'.repeat(64);
const state = 'client-strava-state-12345';
const grantId = 'd6782aa0-e166-4db1-a7ea-87701b455f92';
const athlete = {
  athleteId: '123456',
  scopes: ['read', 'activity:read_all', 'activity:write'],
  grantId,
};
const configuration = http.get(`${bridgeOrigin}/configuration`, () =>
  HttpResponse.json({
    clientId: '262735',
    callbackUrl: 'https://stravastitch.com/auth/ride-on/callback',
    scopes: athlete.scopes,
  }),
);
const exchange = http.post(`${bridgeOrigin}/exchange`, async ({ request }) => {
  assert.deepEqual(await request.json(), {
    code: 'synthetic-code',
    scopes: 'read,activity:read_all',
  });
  return HttpResponse.json(athlete);
});
const status = http.get(`${bridgeOrigin}/connection/123456`, ({ request }) => {
  assert.equal(new URL(request.url).searchParams.get('grant'), grantId);
  return HttpResponse.json(athlete);
});
const scenario = (name: string, run: (h: Harness) => Promise<void>) =>
  test(name, { timeout: 20_000 }, async () => {
    const h = await createHarness();
    try {
      await h.restart({ STRAVA_ENABLED: 'true' });
      h.use(configuration, exchange, status);
      await run(h);
    } finally {
      await h.dispose();
      assert.deepEqual(h.unexpected, []);
      assert.deepEqual(h.handlerErrors, []);
    }
  });
const start = async (h: Harness, token = ALICE_TOKEN) => {
  const response = await h.send('/connections/strava/start', {
    token,
    body: JSON.stringify({
      state,
      codeChallenge: createHash('sha256').update(verifier).digest('base64url'),
    }),
  });
  assert.equal(response.status, 201);
  return z
    .object({ requestId: z.string(), authorizationUrl: z.string() })
    .parse(await response.json());
};
const authorize = async (h: Harness, url: string, token = ALICE_TOKEN) => {
  const response = await h.send(url, { token });
  assert.equal(response.status, 302);
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie);
  assert.match(response.headers.get('set-cookie') ?? '', /HttpOnly/);
  const destination = new URL(response.headers.get('location') ?? '');
  assert.equal(destination.origin, 'https://www.strava.com');
  assert.equal(
    destination.searchParams.get('redirect_uri'),
    'https://stravastitch.com/auth/ride-on/callback',
  );
  return cookie;
};
const ready = async (h: Harness, token = ALICE_TOKEN) => {
  const flow = await start(h, token);
  const cookie = await authorize(h, flow.authorizationUrl, token);
  const callback = await h.send(
    `/integrations/strava/callback?state=${flow.requestId}&code=synthetic-code&scope=read,activity:read_all`,
    { token: null, headers: { Cookie: cookie } },
  );
  assert.equal(callback.status, 302);
  const destination = new URL(callback.headers.get('location') ?? '');
  assert.equal(destination.pathname, '/integrations/strava/done');
  assert.equal(destination.searchParams.get('state'), state);
  assert.equal(destination.searchParams.get('result'), 'ready');
  assert.equal(destination.searchParams.has('code'), false);
  return flow;
};
const complete = (
  h: Harness,
  requestId: string,
  token = ALICE_TOKEN,
  codeVerifier = verifier,
) =>
  h.send('/connections/strava/complete', {
    token,
    body: JSON.stringify({ requestId, codeVerifier }),
  });

scenario(
  'Strava connects only with the originating owner and verifier, persists across restart, and never exposes tokens',
  async (h) => {
    const flow = await ready(h);
    assert.equal((await complete(h, flow.requestId, BOB_TOKEN)).status, 400);
    assert.equal(
      (await complete(h, flow.requestId, ALICE_TOKEN, 'w'.repeat(64))).status,
      400,
    );
    const results = await Promise.all([
      complete(h, flow.requestId),
      complete(h, flow.requestId),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 400]);
    await h.restart();
    const connection = await (await h.send('/connections/strava')).text();
    assert.match(connection, /connected/);
    assert.match(connection, /privateActivities":true/);
    assert.doesNotMatch(connection, /token|secret|grantId|generation/);
    assert.deepEqual(
      await (await h.send('/connections/strava', { token: BOB_TOKEN })).json(),
      { configured: true, connection: null },
    );
  },
);

scenario(
  'Strava rejects missing browser cookies, replay, expired handoffs and cancelled consent',
  async (h) => {
    const flow = await start(h);
    assert.equal(
      (await h.send(flow.authorizationUrl, { token: null })).status,
      401,
    );
    assert.equal(
      (await h.send(flow.authorizationUrl, { token: BOB_TOKEN })).status,
      400,
    );
    const cookie = await authorize(h, flow.authorizationUrl);
    const url = `/integrations/strava/callback?state=${flow.requestId}&error=access_denied`;
    assert.equal((await h.send(url, { token: null })).status, 400);
    assert.equal((await h.send(flow.authorizationUrl)).status, 400);
    const cancelled = await h.send(url, {
      token: null,
      headers: { Cookie: cookie },
    });
    assert.match(cancelled.headers.get('location') ?? '', /result=cancelled/);
    assert.equal((await complete(h, flow.requestId)).status, 400);
    const next = await ready(h);
    const db = await h.runtime.getD1Database('ROUTES_DB');
    await db.prepare('UPDATE strava_flows SET expires_at = 0').run();
    assert.equal((await complete(h, next.requestId)).status, 400);
  },
);

scenario(
  'Strava history uses the connected athlete, forwards pagination, stores no rides and keeps auth failures separate from Ride On login',
  async (h) => {
    const flow = await ready(h);
    assert.equal((await complete(h, flow.requestId)).status, 200);
    h.use(
      http.get(`${bridgeOrigin}/rides/123456`, ({ request }) => {
        assert.equal(new URL(request.url).searchParams.get('page'), '2');
        return HttpResponse.json({
          rides: [
            {
              id: '987654',
              name: 'Synthetic ride',
              sportType: 'GravelRide',
              startedAt: '2026-10-16T09:00:00Z',
              distanceKm: 42.1,
              movingSeconds: 6000,
              elapsedSeconds: 6300,
              elevationGainM: 400,
              url: 'https://www.strava.com/activities/987654',
            },
          ],
          nextPage: 3,
          fetchedAt: '2026-10-17T09:00:00Z',
        });
      }),
    );
    assert.equal(
      (await h.send('/connections/strava/rides?page=2', { token: BOB_TOKEN }))
        .status,
      409,
    );
    const result = await h.send('/connections/strava/rides?page=2');
    assert.equal(result.status, 200);
    const body = z
      .object({
        page: z.number(),
        nextPage: z.number(),
        rides: z.array(z.object({ distanceKm: z.number() })),
      })
      .parse(await result.json());
    assert.equal(body.rides[0]?.distanceKm, 42.1);
    assert.equal(body.nextPage, 3);
    const db = await h.runtime.getD1Database('ROUTES_DB');
    assert.equal(
      await db.prepare('SELECT COUNT(*) AS count FROM rides').first('count'),
      0,
    );
    assert.equal(
      (await h.send('/connections/strava/rides?page=0')).status,
      400,
    );
    assert.equal(
      (await h.send('/connections/strava/rides?athleteId=123456')).status,
      400,
    );
    h.use(
      http.get(
        `${bridgeOrigin}/rides/123456`,
        () => new HttpResponse(null, { status: 409 }),
      ),
    );
    assert.equal((await h.send('/connections/strava/rides')).status, 409);
    assert.equal((await h.send('/auth/me')).status, 200);
  },
);

scenario(
  'Strava disconnect removes the mapping and pending authorizations without revoking Stitch',
  async (h) => {
    const flow = await ready(h);
    assert.equal((await complete(h, flow.requestId)).status, 200);
    const next = await ready(h);
    const requests = h.requests.length;
    const result = await h.send('/connections/strava', { method: 'DELETE' });
    assert.equal(result.status, 200);
    assert.equal(h.requests.length, requests);
    assert.equal((await complete(h, next.requestId)).status, 400);
    assert.equal((await h.send('/connections/strava/rides')).status, 409);
    assert.deepEqual(await (await h.send('/connections/strava')).json(), {
      configured: true,
      connection: null,
    });
  },
);

scenario(
  'Strava enforces session access, preserves disablement, scopes and upstream failures',
  async (h) => {
    assert.equal(
      (await h.send('/connections/strava', { token: null })).status,
      401,
    );
    assert.equal(
      (await h.send('/connections/strava/start', { token: null, body: '{}' }))
        .status,
      401,
    );
    await h.restart({ STRAVA_ENABLED: 'false' });
    assert.deepEqual(await (await h.send('/connections/strava')).json(), {
      configured: false,
      connection: null,
    });
    assert.equal(
      (await h.send('/connections/strava/start', { body: '{}' })).status,
      503,
    );
    await h.restart({ STRAVA_ENABLED: 'true' });
    const flow = await ready(h);
    await complete(h, flow.requestId);
    h.use(
      http.get(
        `${bridgeOrigin}/connection/123456`,
        () => new HttpResponse(null, { status: 409 }),
      ),
    );
    assert.match(
      await (await h.send('/connections/strava')).text(),
      /needs-reauthorisation/,
    );
    h.use(
      http.get(
        `${bridgeOrigin}/rides/123456`,
        () => new HttpResponse('secret upstream error', { status: 429 }),
      ),
    );
    const limited = await h.send('/connections/strava/rides');
    assert.equal(limited.status, 429);
    assert.ok(limited.headers.get('retry-after'));
    assert.doesNotMatch(await limited.text(), /secret/);
  },
);

scenario(
  'one Strava athlete cannot be claimed by two Ride On accounts',
  async (h) => {
    const alice = await ready(h);
    await complete(h, alice.requestId);
    const bob = await ready(h, BOB_TOKEN);
    const response = await complete(h, bob.requestId, BOB_TOKEN);
    assert.equal(response.status, 409);
    assert.match(await response.text(), /STRAVA_ALREADY_LINKED/);
  },
);
