import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { test } from 'node:test';
import { HttpResponse, http } from 'msw';
import type { ActivityRow } from '../src/strava/import-model.ts';
import {
  BOB_TOKEN,
  createHarness,
  FIXED_NOW,
  type Harness,
} from './harness.ts';

const origin = 'https://strava-stitch.internal',
  time = Date.parse(FIXED_NOW),
  day = 86_400_000;
const generation = 'synthetic-generation',
  grant = '23fbebc9-de83-4768-8ad7-f7c8f1bb77ce';
const points = Array.from({ length: 101 }, (_, i) => [51.5 + i * 0.0002, -0.1]);
const detail = (id = '101', changes: Record<string, unknown> = {}) => ({
  available: true,
  activityId: id,
  startedAt: '2026-10-09T09:00:00.000Z',
  riddenOn: '2026-10-08',
  averageSpeedMps: 7.5,
  elevationGainM: 350,
  averagePowerWatts: null,
  powerSource: null,
  points,
  ...changes,
});
const json = async <T>(r: { json(): Promise<unknown> }): Promise<T> =>
  (await r.json()) as T;
const dbFor = (h: Harness) => h.runtime.getD1Database('ROUTES_DB');
const scenario = (name: string, fn: (h: Harness) => Promise<void>) =>
  test(name, { timeout: 30_000 }, async () => {
    const h = await createHarness();
    try {
      await h.restart({
        STRAVA_ENABLED: 'true',
        STRAVA_IMPORT_ENABLED: 'true',
      });
      await fn(h);
    } finally {
      await h.dispose();
      assert.deepEqual(h.unexpected, []);
      assert.deepEqual(h.handlerErrors, []);
    }
  });
const seed = async (h: Harness) => {
  const db = await dbFor(h);
  const uploaded = await h.send('/routes', {
    contentType: 'application/gpx+xml',
    body: '<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Richmond loop</name><trkseg><trkpt lat="51.5" lon="-0.1"/><trkpt lat="51.52" lon="-0.1"/></trkseg></trk></gpx>',
  });
  assert.equal(uploaded.status, 201);
  const { route } = await json<{ route: { id: string } }>(uploaded);
  await db.batch([
    db
      .prepare('INSERT INTO strava_connections VALUES(?,?,?,?,?,?)')
      .bind(
        'alice',
        '123',
        grant,
        '["activity:read_all"]',
        time - 60_000,
        generation,
      ),
  ]);
  return route.id;
};
const row = async (h: Harness, id = '101') =>
  (await dbFor(h))
    .prepare(
      'SELECT * FROM strava_activity_cache WHERE owner_id=? AND activity_id=?',
    )
    .bind('alice', id)
    .first<ActivityRow>();
const jobs = async (h: Harness) =>
  (await dbFor(h))
    .prepare(
      'SELECT id,job_key FROM strava_import_jobs WHERE revision>completed_revision AND due_at<=? ORDER BY job_key',
    )
    .bind(time)
    .all<{ id: string; job_key: string }>();
const run = async (h: Harness, id: string) => {
  assert.equal(
    (await h.send('/__test/strava-job', { body: JSON.stringify({ id }) }))
      .status,
    200,
  );
};
const dispatch = async (h: Harness) => {
  assert.equal((await h.send('/__test/strava-dispatch')).status, 200);
};
const drain = async (h: Harness) => {
  for (let i = 0; i < 15; i++) {
    const pending = await jobs(h);
    if (!pending.results.length) return;
    for (const j of pending.results) await run(h, j.id);
  }
  throw new Error('Jobs did not drain');
};
const event = async (
  h: Harness,
  id = '101',
  aspect = 'create',
  eventTime = Math.floor(time / 1000),
) => {
  const response = await h.send('/__test/strava-event', {
    body: JSON.stringify({
      kind: 'strava_event',
      athleteId: '123',
      activityId: id,
      aspect,
      eventTime,
    }),
  });
  assert.equal(response.status, 200);
};
const activityHandler = (changes: Record<string, unknown> = {}) =>
  http.get(`${origin}/import-activity/123`, ({ request }) => {
    const query = new URL(request.url).searchParams;
    assert.equal(query.get('grant'), grant);
    return HttpResponse.json(detail(query.get('activity') ?? '', changes));
  });
const emptyPage = http.get(`${origin}/import-page/123`, () =>
  HttpResponse.json({ activityIds: [], nextPage: null }),
);

scenario(
  'automatic 90-day backfill groups repeat rides, paginates and never stores GPS or notifies',
  async (h) => {
    const routeId = await seed(h);
    let pages = 0;
    h.use(
      http.get(`${origin}/import-page/123`, ({ request }) => {
        const query = new URL(request.url).searchParams;
        assert.equal(query.get('after'), String((time - 90 * day) / 1000));
        assert.equal(query.get('before'), String(time / 1000));
        pages++;
        return HttpResponse.json({
          activityIds: query.get('page') === '1' ? ['101', '102'] : ['103'],
          nextPage: query.get('page') === '1' ? 2 : null,
        });
      }),
      activityHandler(),
    );
    await dispatch(h);
    await drain(h);
    await dispatch(h);
    assert.equal(pages, 2);
    const response = await h.send('/history/routes');
    assert.equal(response.status, 200);
    const result = await json<{
      routes: {
        routeId: string;
        rideCount: number;
        mostRecentRide: { riddenOn: string };
      }[];
    }>(response);
    assert.equal(result.routes.length, 1, JSON.stringify(await row(h)));
    assert.equal(result.routes[0]?.routeId, routeId);
    assert.equal(result.routes[0]?.rideCount, 3);
    assert.equal(result.routes[0]?.mostRecentRide.riddenOn, '2026-10-08');
    assert.doesNotMatch(
      JSON.stringify(result),
      /averageSpeed|elevationGain|averagePower|startedAt|match_json/,
    );
    const first = await json<{
      rides: { activityId: string }[];
      nextCursor: string;
    }>(await h.send(`/history/routes/${routeId}/rides?limit=2`));
    assert.equal(first.rides.length, 2);
    assert.ok(first.nextCursor);
    const second = await json<{
      rides: { activityId: string }[];
      nextCursor: string | null;
    }>(
      await h.send(
        `/history/routes/${routeId}/rides?limit=2&cursor=${encodeURIComponent(first.nextCursor)}`,
      ),
    );
    assert.equal(second.rides.length, 1);
    assert.equal(second.nextCursor, null);
    assert.equal(
      new Set([...first.rides, ...second.rides].map((r) => r.activityId)).size,
      3,
    );
    assert.equal(
      (await h.send(`/history/routes/${routeId}/rides`, { token: BOB_TOKEN }))
        .status,
      404,
    );
    assert.deepEqual(
      (
        await json<{ routes: unknown[] }>(
          await h.send('/history/routes', { token: BOB_TOKEN }),
        )
      ).routes,
      [],
    );
    assert.equal(
      (await h.send('/history/routes', { token: null })).status,
      401,
    );
    const cached = await row(h);
    assert.ok(cached);
    assert.equal(cached.notification_at, null);
    assert.doesNotMatch(
      JSON.stringify(cached),
      /points|polyline|latitude|longitude|access_token|average_speed|elevation_gain|average_power|power_source/,
    );
    const manual = await (await dbFor(h))
      .prepare('SELECT COUNT(*) AS n FROM rides')
      .first<{ n: number }>();
    assert.equal(manual?.n, 0);
  },
);
scenario(
  'partial rides log automatically, are owner-scoped and optional corrections survive updates',
  async (h) => {
    const routeId = await seed(h);
    h.use(activityHandler({ points: points.slice(0, 61) }));
    await event(h);
    await drain(h);
    assert.equal(
      (await json<{ routes: unknown[] }>(await h.send('/history/routes')))
        .routes.length,
      1,
    );
    const review = await json<{
      rides: {
        activityId: string;
        version: number;
        primaryRouteId: string;
      }[];
    }>(await h.send('/history/strava-rides?status=review'));
    assert.equal(review.rides.length, 1);
    assert.equal(review.rides[0]?.primaryRouteId, routeId);
    let cached = await row(h);
    assert.ok(cached);
    assert.equal(
      (await h.send('/history/strava-rides/101', { token: BOB_TOKEN })).status,
      404,
    );
    const change = (version: number, routeId: string | null) =>
      h.send('/history/strava-rides/101', {
        method: 'PATCH',
        body: JSON.stringify({ expectedVersion: version, routeId }),
      });
    assert.equal(
      (await change(cached.version, crypto.randomUUID())).status,
      404,
    );
    assert.equal((await change(cached.version, routeId)).status, 200);
    assert.equal((await change(cached.version, null)).status, 409);
    h.use(activityHandler());
    await event(h, '101', 'update', Math.floor(time / 1000) + 1);
    await drain(h);
    cached = await row(h);
    assert.ok(cached);
    assert.equal(cached.decision, 'confirmed');
    assert.equal(cached.primary_route_id, routeId);
    assert.equal((await change(cached.version, null)).status, 200);
    await event(h, '101', 'update', Math.floor(time / 1000) + 2);
    await drain(h);
    cached = await row(h);
    assert.equal(cached?.decision, 'dismissed');
    assert.equal(cached?.primary_route_id, null);
    assert.equal(
      (
        await json<{ rides: unknown[] }>(
          await h.send('/history/strava-rides?status=review'),
        )
      ).rides.length,
      0,
    );
  },
);
scenario(
  'duplicates are idempotent; verified removal and revocation purge cached matches',
  async (h) => {
    await seed(h);
    h.use(activityHandler());
    await event(h);
    await event(h);
    await drain(h);
    assert.equal(h.requests.length, 1);
    await event(h);
    await drain(h);
    assert.equal(h.requests.length, 1);
    // A forged delete hint cannot erase an activity which Strava still returns.
    await event(h, '101', 'delete', Math.floor(time / 1000) + 1);
    await drain(h);
    assert.ok(await row(h));
    h.use(
      http.get(`${origin}/import-activity/123`, () =>
        HttpResponse.json({ available: false }),
      ),
    );
    await event(h, '101', 'delete', Math.floor(time / 1000) + 2);
    await drain(h);
    assert.equal(await row(h), null);
    h.use(activityHandler());
    await event(h, '101', 'update', Math.floor(time / 1000) + 3);
    await drain(h);
    assert.ok(await row(h));
    h.use(
      http.get(`${origin}/connection/123`, ({ request }) => {
        assert.equal(new URL(request.url).searchParams.get('verify'), 'true');
        return new HttpResponse(null, { status: 409 });
      }),
    );
    await h.send('/__test/strava-event', {
      body: JSON.stringify({
        kind: 'strava_event',
        athleteId: '123',
        activityId: null,
        aspect: 'revoke',
        eventTime: time / 1000 + 4,
      }),
    });
    await drain(h);
    assert.equal(await row(h), null);
    assert.equal(
      await (await dbFor(h))
        .prepare('SELECT * FROM strava_connections WHERE owner_id=?')
        .bind('alice')
        .first(),
      null,
    );
  },
);
scenario(
  'disconnect or a newer job revision wins over an in-flight activity response',
  async (h) => {
    await seed(h);
    const db = await dbFor(h);
    h.use(
      http.get(`${origin}/import-activity/123`, async () => {
        await db
          .prepare(
            'UPDATE strava_connections SET generation=? WHERE owner_id=?',
          )
          .bind('new-generation', 'alice')
          .run();
        return HttpResponse.json(detail());
      }),
    );
    await event(h);
    await drain(h);
    assert.equal(await row(h), null);
    h.use(
      http.get(`${origin}/import-activity/123`, async () => {
        await db
          .prepare(
            "UPDATE strava_import_jobs SET revision=revision+1 WHERE job_key='activity:101'",
          )
          .run();
        return HttpResponse.json(detail());
      }),
    );
    await event(h);
    const pending = await jobs(h);
    assert.ok(pending.results[0]);
    await run(h, pending.results[0].id);
    assert.equal(await row(h), null);
  },
);
scenario(
  'rate limits retry durably; evidence expires while ride dates remain',
  async (h) => {
    await seed(h);
    h.use(
      http.get(
        `${origin}/import-activity/123`,
        () => new HttpResponse(null, { status: 429 }),
      ),
    );
    await event(h);
    await drain(h);
    const db = await dbFor(h),
      retry = await db
        .prepare('SELECT due_at,last_error FROM strava_import_jobs')
        .first<{ due_at: number; last_error: string }>();
    assert.equal(retry?.due_at, time + 900_000);
    assert.equal(retry?.last_error, 'STRAVA_RATE_LIMITED');
    h.use(activityHandler());
    await h.restart({ TEST_NOW: new Date(time + 900_000).toISOString() });
    const pending = await (await dbFor(h))
      .prepare('SELECT id FROM strava_import_jobs')
      .first<{ id: string }>();
    assert.ok(pending);
    await run(h, pending.id);
    assert.ok(await row(h));
    await h.restart({ TEST_NOW: new Date(time + 3 * day).toISOString() });
    const stale = await json<{ ride: { riddenOn: string }; evidence: unknown }>(
      await h.send('/history/strava-rides/101'),
    );
    assert.equal(stale.ride.riddenOn, '2026-10-08');
    assert.equal(stale.evidence, null);
    await h.restart({
      TEST_NOW: new Date(time + 8 * day).toISOString(),
      STRAVA_IMPORT_ENABLED: 'false',
    });
    await dispatch(h);
    assert.equal(await row(h), null);
    assert.equal((await h.send('/history/routes')).status, 503);
    assert.equal((await h.send('/health', { token: null })).status, 200);
  },
);
scenario(
  'older history is explicitly requested with bounded dates and cannot replace an active scan',
  async (h) => {
    await seed(h);
    h.use(emptyPage);
    const after = new Date(time - 300 * day).toISOString(),
      before = new Date(time - 90 * day).toISOString();
    const request = () =>
      h.send('/connections/strava/imports', {
        body: JSON.stringify({ after, before }),
      });
    assert.equal((await request()).status, 202);
    assert.equal((await request()).status, 409);
    await drain(h);
    const status = await h.send('/connections/strava/imports');
    assert.equal(status.status, 200);
    assert.equal(
      (
        await h.send('/connections/strava/imports', {
          body: JSON.stringify({
            after: new Date(time - 400 * day).toISOString(),
          }),
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await h.send('/connections/strava/imports', {
          token: BOB_TOKEN,
          body: '{}',
        })
      ).status,
      409,
    );
  },
);
scenario(
  'new matches push once per device, backfill and unmatched activities stay quiet',
  async (h) => {
    await seed(h);
    const key = generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    }).privateKey;
    await h.restart({
      APNS_CONFIG_JSON: JSON.stringify({
        sandbox: { teamId: 'AAAAAAAAAA', keyId: 'BBBBBBBBBB', privateKey: key },
      }),
    });
    assert.equal(
      (
        await h.send(`/push-devices/${crypto.randomUUID()}`, {
          method: 'PUT',
          body: JSON.stringify({
            token: 'a'.repeat(64),
            environment: 'sandbox',
            topic: 'com.danbarclay.rideon',
            platform: 'ios',
          }),
        })
      ).status,
      200,
    );
    let deliveries = 0;
    const push = http.post(
      'https://api.sandbox.push.apple.com/3/device/:token',
      async ({ request }) => {
        deliveries++;
        assert.equal(request.headers.get('apns-collapse-id'), 'strava-101');
        const data = (await request.json()) as { activityId: string };
        assert.equal(data.activityId, '101');
        return new HttpResponse(null, { status: 200 });
      },
    );
    h.use(activityHandler(), emptyPage, push);
    await event(h);
    await drain(h);
    await dispatch(h);
    await drain(h);
    assert.equal(deliveries, 1);
    await event(h);
    await dispatch(h);
    await drain(h);
    assert.equal(deliveries, 1);
    h.use(activityHandler({ points: [] }), emptyPage, push);
    await event(h, '102');
    await drain(h);
    await dispatch(h);
    await drain(h);
    assert.equal(deliveries, 1);
  },
);

scenario(
  'push retries skip accepted devices and a completed review suppresses pending delivery',
  async (h) => {
    await seed(h);
    const key = generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    }).privateKey;
    await h.restart({
      APNS_CONFIG_JSON: JSON.stringify({
        sandbox: { teamId: 'AAAAAAAAAA', keyId: 'BBBBBBBBBB', privateKey: key },
      }),
    });
    for (const token of ['a', 'b'])
      assert.equal(
        (
          await h.send(`/push-devices/${crypto.randomUUID()}`, {
            method: 'PUT',
            body: JSON.stringify({
              token: token.repeat(64),
              environment: 'sandbox',
              topic: 'com.danbarclay.rideon',
              platform: 'ios',
            }),
          })
        ).status,
        200,
      );
    let fail = true;
    const deliveries: string[] = [],
      ids = new Map<string, string>();
    h.use(
      activityHandler(),
      http.post(
        'https://api.sandbox.push.apple.com/3/device/:token',
        ({ request, params }) => {
          const token = String(params.token);
          deliveries.push(token);
          const id = request.headers.get('apns-id');
          assert.ok(id);
          if (ids.has(token)) assert.equal(id, ids.get(token));
          else ids.set(token, id);
          return token.startsWith('b') && fail
            ? HttpResponse.json(
                { reason: 'ServiceUnavailable' },
                { status: 503 },
              )
            : new HttpResponse(null, { status: 200 });
        },
      ),
    );
    await event(h);
    await drain(h);
    assert.equal(deliveries.length, 2);
    fail = false;
    await h.restart({ TEST_NOW: new Date(time + 900_000).toISOString() });
    const pending = await (await dbFor(h))
      .prepare("SELECT id FROM strava_import_jobs WHERE job_key='push:101'")
      .first<{ id: string }>();
    assert.ok(pending);
    await run(h, pending.id);
    assert.equal(deliveries.length, 3);
    assert.ok(deliveries.at(-1)?.startsWith('b'));
    // Another uncertain ride is reviewed before its queued push runs.
    await event(h, '102');
    const activityJob = await (await dbFor(h))
      .prepare("SELECT id FROM strava_import_jobs WHERE job_key='activity:102'")
      .first<{ id: string }>();
    assert.ok(activityJob);
    await run(h, activityJob.id);
    const cached = await row(h, '102');
    assert.ok(cached);
    assert.equal(
      (
        await h.send('/history/strava-rides/102', {
          method: 'PATCH',
          body: JSON.stringify({
            expectedVersion: cached.version,
            routeId: null,
          }),
        })
      ).status,
      200,
    );
    const pushJob = await (await dbFor(h))
      .prepare("SELECT id FROM strava_import_jobs WHERE job_key='push:102'")
      .first<{ id: string }>();
    assert.ok(pushJob);
    await run(h, pushJob.id);
    assert.equal(deliveries.length, 3);
  },
);

scenario(
  'a correction racing an import remains authoritative after evidence and delivery expiry',
  async (h) => {
    const routeId = await seed(h);
    h.use(activityHandler());
    await event(h);
    await drain(h);
    const before = await row(h);
    assert.ok(before);
    h.use(
      http.get(`${origin}/import-activity/123`, async () => {
        assert.equal(
          (
            await h.send('/history/strava-rides/101', {
              method: 'PATCH',
              body: JSON.stringify({
                expectedVersion: before.version,
                routeId,
              }),
            })
          ).status,
          200,
        );
        return HttpResponse.json(detail('101', { points: [] }));
      }),
    );
    await event(h, '101', 'update', Math.floor(time / 1000) + 1);
    await drain(h);
    const current = await row(h);
    assert.equal(current?.decision, 'confirmed');
    assert.equal(current?.primary_route_id, routeId);
    assert.equal(current?.expires_at, before.expires_at);
    await h.restart({
      TEST_NOW: new Date(time + 8 * day).toISOString(),
      STRAVA_IMPORT_ENABLED: 'false',
    });
    await dispatch(h);
    const db = await dbFor(h);
    for (const table of [
      'strava_activity_cache',
      'strava_import_jobs',
      'strava_push_deliveries',
    ])
      assert.equal(
        (
          await db
            .prepare(`SELECT COUNT(*) AS n FROM ${table}`)
            .first<{ n: number }>()
        )?.n,
        0,
      );
  },
);

scenario(
  'one upstream rate limit pauses other import jobs until the shared cooldown ends',
  async (h) => {
    await seed(h);
    let calls = 0;
    h.use(
      http.get(`${origin}/import-activity/123`, () => {
        calls++;
        return new HttpResponse(null, { status: 429 });
      }),
    );
    await event(h, '101');
    await event(h, '102');
    const queued = await jobs(h);
    assert.equal(queued.results.length, 2);
    for (const j of queued.results) await run(h, j.id);
    assert.equal(calls, 1);
    h.use(activityHandler());
    await h.restart({ TEST_NOW: new Date(time + 900_000).toISOString() });
    const pending = await (await dbFor(h))
      .prepare(
        'SELECT id FROM strava_import_jobs WHERE revision>completed_revision',
      )
      .all<{ id: string }>();
    for (const j of pending.results) await run(h, j.id);
    assert.ok(await row(h, '101'));
    assert.ok(await row(h, '102'));
  },
);

scenario(
  'date-only history and optional corrections survive evidence expiry and repeat imports without duplicates',
  async (h) => {
    const routeId = await seed(h);
    h.use(activityHandler(), emptyPage);
    await event(h);
    await drain(h);
    let initial = await row(h);
    assert.ok(initial);
    await event(h, '101', 'update', time / 1000 + 1);
    await drain(h);
    assert.equal(
      (
        await h.send('/history/strava-rides/101', {
          method: 'PATCH',
          body: JSON.stringify({
            expectedVersion: initial.version,
            routeId: null,
          }),
        })
      ).status,
      409,
    );
    initial = await row(h);
    assert.ok(initial);
    assert.equal(initial.reviewed_at, null);
    const future = time + 8 * day;
    await h.restart({
      TEST_NOW: new Date(future).toISOString(),
      STRAVA_IMPORT_ENABLED: 'false',
    });
    await dispatch(h);
    assert.equal(await row(h), null);
    await h.restart({ STRAVA_IMPORT_ENABLED: 'true' });
    const retained = await json<{
      ride: {
        activityId: string;
        riddenOn: string;
        primaryRouteId: string;
        version: number;
      };
      evidence: unknown;
    }>(await h.send('/history/strava-rides/101'));
    assert.equal(retained.ride.riddenOn, '2026-10-08');
    assert.equal(retained.ride.primaryRouteId, routeId);
    assert.equal(retained.evidence, null);
    assert.equal(retained.ride.version, initial.version);
    assert.deepEqual(
      Object.keys(retained.ride).sort(),
      [
        'activityId',
        'decision',
        'primaryRouteId',
        'riddenOn',
        'source',
        'version',
      ].sort(),
    );
    const change = await h.send('/history/strava-rides/101', {
      method: 'PATCH',
      body: JSON.stringify({
        expectedVersion: retained.ride.version,
        routeId: null,
      }),
    });
    assert.equal(change.status, 200);
    assert.equal(
      (
        await h.send('/history/strava-rides/101', {
          method: 'PATCH',
          body: JSON.stringify({
            expectedVersion: retained.ride.version,
            routeId,
          }),
        })
      ).status,
      409,
    );
    // A late/repeated create can neither resurrect a dismissal nor repeat its push.
    await event(h, '101', 'create', future / 1000);
    const pending = await (await dbFor(h))
      .prepare("SELECT id FROM strava_import_jobs WHERE job_key='activity:101'")
      .first<{ id: string }>();
    assert.ok(pending);
    await run(h, pending.id);
    const refreshed = await row(h);
    assert.ok(refreshed);
    assert.equal(refreshed.decision, 'dismissed');
    assert.equal(refreshed.primary_route_id, null);
    assert.equal(refreshed.notification_at, null);
    assert.ok(refreshed.version > retained.ride.version);
    const history = await (await dbFor(h))
      .prepare('SELECT * FROM strava_ride_history')
      .all();
    assert.equal(history.results.length, 1);
    assert.doesNotMatch(
      JSON.stringify(history.results),
      /started_at|average|power|elevation|match_json|coverage|direction|routeName|points/,
    );
    assert.equal(
      (await json<{ routes: unknown[] }>(await h.send('/history/routes')))
        .routes.length,
      0,
    );
    assert.equal(
      (
        await h.send('/history/strava-rides/101', {
          token: BOB_TOKEN,
          method: 'PATCH',
          body: JSON.stringify({
            expectedVersion: refreshed.version,
            routeId: null,
          }),
        })
      ).status,
      404,
    );
    h.use(
      http.get(`${origin}/import-activity/123`, () =>
        HttpResponse.json({ available: false }),
      ),
    );
    await event(h, '101', 'delete', future / 1000 + 1);
    await run(h, pending.id);
    assert.equal(
      (
        await (
          await dbFor(h)
        )
          .prepare('SELECT COUNT(*) AS n FROM strava_ride_history')
          .first<{ n: number }>()
      )?.n,
      0,
    );
    assert.equal((await h.send('/history/strava-rides/101')).status, 404);
  },
);

scenario(
  'old ride dates remain grouped and are revalidated after cache expiry; route deletion removes them',
  async (h) => {
    const routeId = await seed(h);
    h.use(
      activityHandler({
        startedAt: '2025-01-01T23:30:00.000Z',
        riddenOn: '2025-01-02',
      }),
      emptyPage,
    );
    await event(h);
    await drain(h);
    await h.restart({ TEST_NOW: new Date(time + 8 * day).toISOString() });
    await dispatch(h);
    assert.equal(await row(h), null);
    const history = await json<{
      routes: {
        rideCount: number;
        firstRiddenOn: string;
        lastRiddenOn: string;
      }[];
    }>(await h.send('/history/routes'));
    assert.equal(history.routes[0]?.rideCount, 1);
    assert.equal(history.routes[0]?.firstRiddenOn, '2025-01-02');
    assert.equal(history.routes[0]?.lastRiddenOn, '2025-01-02');
    const db = await dbFor(h);
    const refresh = await db
      .prepare(
        "SELECT id FROM strava_import_jobs WHERE job_key='activity:101' AND revision>completed_revision",
      )
      .first<{ id: string }>();
    assert.ok(refresh);
    await run(h, refresh.id);
    assert.equal(
      (
        await db
          .prepare('SELECT COUNT(*) AS n FROM strava_ride_history')
          .first<{ n: number }>()
      )?.n,
      1,
    );
    await db
      .prepare('DELETE FROM routes WHERE owner_id=? AND id=?')
      .bind('alice', routeId)
      .run();
    assert.equal(
      (
        await db
          .prepare('SELECT COUNT(*) AS n FROM strava_ride_history')
          .first<{ n: number }>()
      )?.n,
      0,
    );
  },
);

scenario(
  'below-threshold activities never create permanent history, and disconnect removes retained dates',
  async (h) => {
    await seed(h);
    h.use(activityHandler({ points: points.slice(0, 40) }));
    await event(h);
    await drain(h);
    const db = await dbFor(h);
    assert.equal(
      (
        await db
          .prepare('SELECT COUNT(*) AS n FROM strava_ride_history')
          .first<{ n: number }>()
      )?.n,
      0,
    );
    h.use(activityHandler());
    await event(h, '101', 'update', time / 1000 + 1);
    await drain(h);
    assert.equal(
      (
        await db
          .prepare('SELECT COUNT(*) AS n FROM strava_ride_history')
          .first<{ n: number }>()
      )?.n,
      1,
    );
    await db
      .prepare('DELETE FROM strava_connections WHERE owner_id=?')
      .bind('alice')
      .run();
    assert.equal(
      (
        await db
          .prepare('SELECT COUNT(*) AS n FROM strava_ride_history')
          .first<{ n: number }>()
      )?.n,
      0,
    );
    assert.equal((await h.send('/history/strava-rides/101')).status, 404);
  },
);
