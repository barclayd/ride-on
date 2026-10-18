import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { test } from 'node:test';
import { decodeJwt, decodeProtectedHeader } from 'jose';
import { HttpResponse, http } from 'msw/http';
import type { MonitorState } from '../src/monitoring/policy.ts';
import type { Snapshot } from '../src/tracking/model.ts';
import { first, upload } from './client.ts';
import { hourlyForecast, metOffice } from './fixtures.ts';
import {
  BOB_TOKEN,
  createHarness,
  FIXED_NOW,
  type Harness,
} from './harness.ts';

const key = generateKeyPairSync('ec', {
  namedCurve: 'prime256v1',
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
}).privateKey;
const config = JSON.stringify({
  sandbox: { teamId: 'AAAAAAAAAA', keyId: 'BBBBBBBBBB', privateKey: key },
});
const json = async <T>(response: { json(): Promise<unknown> }) =>
  (await response.json()) as T;
type Ride = {
  id: string;
  baseline: Snapshot;
  latestAssessment: Snapshot;
  departureAt: string;
};
const run = (name: string, fn: (h: Harness) => Promise<void>) =>
  test(name, { timeout: 60_000 }, async () => {
    const h = await createHarness();
    try {
      await fn(h);
    } finally {
      await h.dispose();
      assert.deepEqual(h.unexpected, []);
      assert.deepEqual(h.handlerErrors, []);
    }
  });
const monitor = async (h: Harness, plan: string) => {
  const response = await h.send('/__test/monitor', {
    body: JSON.stringify({ ownerId: 'alice', planId: plan }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { result: 'ack' });
};
const seed = async (
  h: Harness,
  pauseUntil?: string | null,
  monitorInitially = true,
) => {
  h.use(metOffice());
  assert.equal(
    (
      await h.send('/users', {
        body: JSON.stringify({
          displayName: 'Test',
          settings: {
            weather: { mode: 'strict', providerId: 'met-office' },
            forecast: {
              representation: 'deterministic',
              freshnessBasis: 'model-run',
            },
          },
        }),
      })
    ).status,
    201,
  );
  if (pauseUntil !== undefined)
    assert.equal(
      (
        await h.send('/users/me/pause', {
          method: 'PUT',
          body: JSON.stringify({ until: pauseUntil }),
        })
      ).status,
      200,
    );
  const route = await upload(h);
  const rec = await json<{
    rankings: { best: { recommendationRef: string } }[];
  }>(
    await h.send('/recommendations', {
      body: JSON.stringify({
        routeIds: [route.id],
        date: '2026-10-10',
        timeZone: 'Europe/London',
      }),
    }),
  );
  const created = await h.send('/tracked-rides', {
    headers: { 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify({
      recommendationRef: first(rec.rankings).best.recommendationRef,
      expectedTrackingVersion: 0,
      replaceTrackedRideId: null,
    }),
  });
  assert.equal(created.status, 201);
  const { ride } = await json<{ ride: Ride }>(created);
  if (monitorInitially) await monitor(h, ride.id);
  return ride;
};
const register = async (
  h: Harness,
  token = 'a'.repeat(64),
  id = crypto.randomUUID(),
) => {
  const response = await h.send(`/push-devices/${id}`, {
    method: 'PUT',
    body: JSON.stringify({
      token,
      environment: 'sandbox',
      topic: 'com.danbarclay.rideon',
      platform: 'ios',
    }),
  });
  assert.equal(response.status, 200);
  return id;
};
const change = async (h: Harness, ride: Ride, delta: number) => {
  const db = await h.runtime.getD1Database('ROUTES_DB');
  const snapshot = structuredClone(ride.latestAssessment);
  snapshot.pick.candidate.score = ride.baseline.pick.candidate.score + delta;
  snapshot.pick.candidate.recommendationPriority =
    snapshot.pick.candidate.score;
  snapshot.context.best = snapshot.pick;
  const id = crypto.randomUUID();
  await db.batch([
    db
      .prepare('INSERT INTO tracking_assessments VALUES (?,?,?,?,?,?)')
      .bind('alice', ride.id, id, FIXED_NOW, id, JSON.stringify(snapshot)),
    db
      .prepare(
        "UPDATE tracked_rides SET latest_id = ?,refresh_result = 'assessed',version = version + 1 WHERE owner_id = ? AND id = ?",
      )
      .bind(id, 'alice', ride.id),
  ]);
};
const notifications = (h: Harness, id: string) =>
  h.send(`/tracked-rides/${id}/notifications`).then((r) =>
    json<{
      notifications: {
        id: string;
        status: string;
        devicesAccepted: number;
        devicesPending: number;
        decision: { reasons: string[] };
      }[];
    }>(r),
  );
const clearCache = async (h: Harness) => {
  const kv = await h.runtime.getKVNamespace('WEATHER_CACHE');
  for (const k of (await kv.list()).keys) await kv.delete(k.name);
};
const pause = async (h: Harness, until: string | null = null) => {
  const r = await h.send('/users/me/pause', {
    method: 'PUT',
    body: JSON.stringify({ until }),
  });
  assert.equal(r.status, 200);
};
const resume = async (h: Harness) => {
  assert.equal(
    (await h.send('/users/me/pause', { method: 'DELETE' })).status,
    200,
  );
};
const monitorState = async (h: Harness, id: string) => {
  const db = await h.runtime.getD1Database('ROUTES_DB');
  return db
    .prepare(
      'SELECT state_json,resume_pending FROM tracking_monitors WHERE owner_id = ? AND plan_id = ?',
    )
    .bind('alice', id)
    .first<{ state_json: string | null; resume_pending: number }>();
};
run(
  'device registration is authenticated, owner-scoped, bounded, rotates tokens and never exposes them',
  async (h) => {
    const body = JSON.stringify({
      token: 'a'.repeat(64),
      environment: 'sandbox',
      topic: 'com.danbarclay.rideon',
      platform: 'ios',
    });
    assert.equal(
      (
        await h.send(`/push-devices/${crypto.randomUUID()}`, {
          method: 'PUT',
          body,
          token: null,
        })
      ).status,
      401,
    );
    const id = await register(h);
    assert.equal(
      (
        await h.send(`/push-devices/${id}`, {
          method: 'PUT',
          body,
          token: BOB_TOKEN,
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await h.send(`/push-devices/${crypto.randomUUID()}`, {
          method: 'PUT',
          body,
          token: BOB_TOKEN,
        })
      ).status,
      409,
    );
    const list = await h.send('/push-devices');
    const text = await list.text();
    assert.ok(!text.includes('a'.repeat(64)));
    assert.ok(text.includes(id));
    assert.deepEqual(
      (
        await json<{ devices: unknown[] }>(
          await h.send('/push-devices', { token: BOB_TOKEN }),
        )
      ).devices,
      [],
    );
    await h.send(`/push-devices/${id}`, { method: 'DELETE', token: BOB_TOKEN });
    await register(h, 'b'.repeat(64), id);
    const db = await h.runtime.getD1Database('ROUTES_DB');
    assert.equal(
      (
        await db
          .prepare('SELECT version FROM push_devices WHERE id = ?')
          .bind(id)
          .first<{ version: number }>()
      )?.version,
      2,
    );
    for (let i = 1; i < 20; i++)
      await register(h, i.toString(16).padStart(64, '0'));
    assert.equal(
      (
        await h.send(`/push-devices/${crypto.randomUUID()}`, {
          method: 'PUT',
          body,
        })
      ).status,
      409,
    );
    await h.send(`/push-devices/${id}`, { method: 'DELETE' });
    await register(h);
  },
);
run(
  'scheduled dispatch is bounded and duplicate-safe; monitoring refreshes without devices and stops at departure',
  async (h) => {
    const ride = await seed(h);
    const calls = h.requests.length;
    await h.restart({ TEST_NOW: '2026-10-09T12:15:00.000Z' });
    const dispatch = () =>
      h.send('/__test/dispatch').then((r) => json<{ jobs: unknown[] }>(r));
    const dispatched = await Promise.all([dispatch(), dispatch()]);
    assert.equal(
      dispatched.reduce((n, r) => n + r.jobs.length, 0),
      1,
    );
    await monitor(h, ride.id);
    assert.equal(h.requests.length, calls);
    await h.restart({ TEST_NOW: '2026-10-09T18:00:00.000Z' });
    h.use(
      metOffice(({ request }) =>
        HttpResponse.json(
          hourlyForecast(request, {
            modelRunDate: '2026-10-09T18:00:00.000Z',
            values: () => ({ screenTemperature: 2 }),
          }),
        ),
      ),
    );
    await monitor(h, ride.id);
    assert.ok(h.requests.length > calls);
    assert.equal((await notifications(h, ride.id)).notifications.length, 0);
    const updated = await json<{
      ride: { baseline: Snapshot; latestAssessment: Snapshot };
    }>(await h.send(`/tracked-rides/${ride.id}`));
    assert.deepEqual(updated.ride.baseline, ride.baseline);
    assert.notEqual(
      updated.ride.latestAssessment.pick.candidate.score,
      ride.baseline.pick.candidate.score,
    );
    const after = h.requests.length;
    await h.restart({ TEST_NOW: ride.departureAt });
    await monitor(h, ride.id);
    assert.equal(h.requests.length, after);
    const db = await h.runtime.getD1Database('ROUTES_DB');
    assert.equal(
      (
        await db
          .prepare('SELECT COUNT(*) AS n FROM tracking_monitors')
          .first<{ n: number }>()
      )?.n,
      0,
    );
  },
);
run(
  'one APNs success advances the reference; a second device retries independently after restart without duplicate sends',
  async (h) => {
    const ride = await seed(h);
    const firstDevice = await register(h),
      secondDevice = await register(h, 'b'.repeat(64));
    await h.restart({ APNS_CONFIG_JSON: config });
    const sends: string[] = [],
      ids: string[] = [],
      jwt: string[] = [];
    let fail = true;
    h.use(
      metOffice(),
      http.post(
        'https://api.sandbox.push.apple.com/3/device/:token',
        async ({ request, params }) => {
          const token = String(params.token);
          sends.push(token);
          const apnsId = request.headers.get('apns-id');
          assert.ok(apnsId);
          ids.push(apnsId);
          const header = request.headers.get('authorization');
          assert.ok(header);
          const authorization = header.slice(7);
          jwt.push(authorization);
          assert.equal(decodeProtectedHeader(authorization).kid, 'BBBBBBBBBB');
          assert.equal(decodeJwt(authorization).iss, 'AAAAAAAAAA');
          assert.equal(request.headers.get('apns-push-type'), 'alert');
          assert.equal(request.headers.get('apns-collapse-id'), ride.id);
          const payload = (await request.json()) as {
            trackedRideId: string;
            reasons: string[];
          };
          assert.equal(payload.trackedRideId, ride.id);
          assert.ok(payload.reasons.includes('score_worsened'));
          return fail && token.startsWith('b')
            ? HttpResponse.json(
                { reason: 'ServiceUnavailable' },
                { status: 503 },
              )
            : new HttpResponse(null, { status: 200 });
        },
      ),
    );
    await change(h, ride, -6);
    await Promise.all([monitor(h, ride.id), monitor(h, ride.id)]);
    assert.equal(sends.length, 2);
    let history = (await notifications(h, ride.id)).notifications;
    assert.equal(first(history).devicesAccepted, 1);
    assert.equal(first(history).devicesPending, 1);
    await monitor(h, ride.id);
    assert.equal(sends.length, 2);
    fail = false;
    await h.restart({ TEST_NOW: '2026-10-09T12:15:00.000Z' });
    await monitor(h, ride.id);
    assert.equal(sends.filter((s) => s.startsWith('a')).length, 1);
    assert.equal(sends.filter((s) => s.startsWith('b')).length, 2);
    assert.equal(ids[2], ids[sends[0]?.startsWith('b') ? 0 : 1]);
    assert.equal(new Set(jwt).size, 1);
    history = (await notifications(h, ride.id)).notifications;
    assert.equal(first(history).devicesAccepted, 2);
    await change(h, ride, -12);
    await monitor(h, ride.id);
    assert.equal(sends.length, 3);
    await h.restart({ TEST_NOW: '2026-10-09T15:00:00.000Z' });
    await monitor(h, ride.id);
    assert.equal(sends.length, 5);
    await h.send(`/push-devices/${firstDevice}`, { method: 'DELETE' });
    await h.send(`/push-devices/${secondDevice}`, { method: 'DELETE' });
    assert.equal(
      first((await notifications(h, ride.id)).notifications).devicesAccepted,
      2,
    );
    assert.equal(
      (
        await h.send(`/tracked-rides/${ride.id}/notifications`, {
          token: BOB_TOKEN,
        })
      ).status,
      404,
    );
  },
);
run(
  'a stopped plan cancels retries and erasure removes its monitoring and notification records',
  async (h) => {
    const ride = await seed(h);
    await register(h);
    await h.restart({ APNS_CONFIG_JSON: config });
    let count = 0;
    h.use(
      metOffice(),
      http.post('https://api.sandbox.push.apple.com/3/device/:token', () => {
        count++;
        return HttpResponse.json(
          { reason: 'TooManyRequests' },
          { status: 429 },
        );
      }),
    );
    await change(h, ride, -6);
    await monitor(h, ride.id);
    assert.equal(count, 1);
    await h.send(`/tracked-rides/${ride.id}`, { method: 'DELETE' });
    await h.restart({ TEST_NOW: '2026-10-09T12:15:00.000Z' });
    await monitor(h, ride.id);
    assert.equal(count, 1);
    assert.equal(
      first((await notifications(h, ride.id)).notifications).status,
      'cancelled',
    );
    await h.send(`/tracked-rides/${ride.id}?permanent=true`, {
      method: 'DELETE',
    });
    assert.equal(
      (await h.send(`/tracked-rides/${ride.id}/notifications`)).status,
      404,
    );
    const db = await h.runtime.getD1Database('ROUTES_DB');
    assert.equal(
      (
        await db
          .prepare('SELECT COUNT(*) AS n FROM push_deliveries')
          .first<{ n: number }>()
      )?.n,
      0,
    );
  },
);
run(
  'preference changes refresh quietly and supersede an unsent alert',
  async (h) => {
    const ride = await seed(h);
    await register(h);
    // No credentials: an actual durable pending event remains available for retry.
    await change(h, ride, -6);
    await monitor(h, ride.id);
    assert.equal(
      first((await notifications(h, ride.id)).notifications).devicesPending,
      1,
    );
    const user = await json<{ user: { version: number } }>(
      await h.send('/users/me'),
    );
    const response = await h.send('/users/me', {
      method: 'PATCH',
      body: JSON.stringify({
        expectedVersion: user.user.version,
        settings: { riding: { averageSpeedKph: 23 } },
      }),
    });
    assert.equal(response.status, 200);
    await monitor(h, ride.id);
    assert.equal(
      first((await notifications(h, ride.id)).notifications).status,
      'superseded',
    );
    assert.equal((await notifications(h, ride.id)).notifications.length, 1);
  },
);
run(
  'summary-time outage sends one warning and recovery combines with the latest conditions',
  async (h) => {
    const ride = await seed(h);
    await register(h);
    await clearCache(h);
    const payloads: { reasons: string[] }[] = [];
    const apns = http.post(
      'https://api.sandbox.push.apple.com/3/device/:token',
      async ({ request }) => {
        payloads.push((await request.json()) as { reasons: string[] });
        return new HttpResponse(null, { status: 200 });
      },
    );
    await h.restart({
      APNS_CONFIG_JSON: config,
      TEST_NOW: '2026-10-09T18:00:00.000Z',
    });
    h.use(
      metOffice(() => new HttpResponse(null, { status: 503 })),
      apns,
    );
    await monitor(h, ride.id);
    assert.deepEqual(first(payloads).reasons, [
      'evening_summary',
      'unavailable',
    ]);
    await h.restart({ TEST_NOW: '2026-10-09T19:00:00.000Z' });
    await monitor(h, ride.id);
    assert.equal(payloads.length, 1);
    await h.restart({ TEST_NOW: '2026-10-09T19:15:00.000Z' });
    h.use(
      metOffice(({ request }) =>
        HttpResponse.json(
          hourlyForecast(request, { modelRunDate: '2026-10-09T19:15:00.000Z' }),
        ),
      ),
      apns,
    );
    await monitor(h, ride.id);
    assert.equal(payloads.length, 2);
    assert.ok(payloads[1]?.reasons.includes('available_again'));
    await monitor(h, ride.id);
    assert.equal(payloads.length, 2);
  },
);
run(
  'APNs invalid tokens retire only the affected device; registration during a 410 response survives',
  async (h) => {
    const ride = await seed(h);
    const id = await register(h);
    await h.restart({ APNS_CONFIG_JSON: config });
    let release = () => {},
      entered = () => {};
    const wait = new Promise<void>((r) => {
      release = r;
    });
    const started = new Promise<void>((r) => {
      entered = r;
    });
    h.use(
      metOffice(),
      http.post(
        'https://api.sandbox.push.apple.com/3/device/:token',
        async () => {
          entered();
          await wait;
          return HttpResponse.json(
            { reason: 'Unregistered', timestamp: Date.parse(FIXED_NOW) },
            { status: 410 },
          );
        },
      ),
    );
    await change(h, ride, -6);
    const pending = monitor(h, ride.id);
    await started;
    try {
      await register(h, 'b'.repeat(64), id);
    } finally {
      release();
    }
    await pending;
    assert.equal(
      (await json<{ devices: unknown[] }>(await h.send('/push-devices')))
        .devices.length,
      1,
    );
    h.use(
      metOffice(),
      http.post('https://api.sandbox.push.apple.com/3/device/:token', () =>
        HttpResponse.json({ reason: 'BadDeviceToken' }, { status: 400 }),
      ),
    );
    await change(h, ride, -7);
    await monitor(h, ride.id);
    assert.equal(
      (await json<{ devices: unknown[] }>(await h.send('/push-devices')))
        .devices.length,
      0,
    );
  },
);
run(
  'permanent APNs payload errors do not regenerate a poison notification on every tick',
  async (h) => {
    const ride = await seed(h);
    await register(h);
    await h.restart({ APNS_CONFIG_JSON: config });
    let calls = 0;
    h.use(
      metOffice(),
      http.post('https://api.sandbox.push.apple.com/3/device/:token', () => {
        calls++;
        return HttpResponse.json({ reason: 'BadPayload' }, { status: 400 });
      }),
    );
    await change(h, ride, -6);
    await monitor(h, ride.id);
    await h.restart({ TEST_NOW: '2026-10-09T12:15:00.000Z' });
    await monitor(h, ride.id);
    assert.equal(calls, 1);
    assert.equal(
      first((await notifications(h, ride.id)).notifications).status,
      'failed',
    );
  },
);
run(
  'stopping a ride during its background refresh prevents publication and delivery',
  async (h) => {
    const ride = await seed(h);
    await register(h);
    await h.restart({
      APNS_CONFIG_JSON: config,
      TEST_NOW: '2026-10-09T18:00:00.000Z',
    });
    let release = () => {},
      entered = () => {};
    const wait = new Promise<void>((r) => {
      release = r;
    });
    const started = new Promise<void>((r) => {
      entered = r;
    });
    h.use(
      metOffice(async ({ request }) => {
        entered();
        await wait;
        return HttpResponse.json(
          hourlyForecast(request, { modelRunDate: '2026-10-09T18:00:00.000Z' }),
        );
      }),
    );
    const pending = monitor(h, ride.id);
    await started;
    try {
      await h.send(`/tracked-rides/${ride.id}`, { method: 'DELETE' });
    } finally {
      release();
    }
    await pending;
    assert.equal((await notifications(h, ride.id)).notifications.length, 0);
    const current = await json<{
      ride: { baseline: Snapshot; latestAssessment: Snapshot };
    }>(await h.send(`/tracked-rides/${ride.id}`));
    assert.deepEqual(current.ride.latestAssessment, ride.latestAssessment);
  },
);
run(
  'obsolete unsent score changes are cancelled when the current score recovers',
  async (h) => {
    const ride = await seed(h);
    await register(h);
    await change(h, ride, -6);
    await monitor(h, ride.id);
    assert.equal(
      first((await notifications(h, ride.id)).notifications).status,
      'pending',
    );
    await change(h, ride, -2);
    await monitor(h, ride.id);
    assert.equal(
      first((await notifications(h, ride.id)).notifications).status,
      'superseded',
    );
  },
);
run(
  'local midnight tightens tomorrow freshness to the same-day three-hour limit',
  async (h) => {
    const ride = await seed(h);
    await h.restart({ TEST_NOW: '2026-10-09T20:30:00.000Z' });
    h.use(
      metOffice(({ request }) =>
        HttpResponse.json(
          hourlyForecast(request, { modelRunDate: '2026-10-09T20:30:00.000Z' }),
        ),
      ),
    );
    await monitor(h, ride.id);
    const calls = h.requests.length;
    const before = await json<{
      ride: { refresh: { assessmentFreshUntil: string } };
    }>(await h.send(`/tracked-rides/${ride.id}`));
    assert.ok(
      before.ride.refresh.assessmentFreshUntil > '2026-10-10T00:00:00.000Z',
    );
    await h.restart({ TEST_NOW: '2026-10-10T00:00:00.000Z' });
    h.use(
      metOffice(({ request }) =>
        HttpResponse.json(
          hourlyForecast(request, { modelRunDate: '2026-10-10T00:00:00.000Z' }),
        ),
      ),
    );
    await monitor(h, ride.id);
    assert.ok(h.requests.length > calls);
    const after = await json<{
      ride: { refresh: { lastSuccessfulAssessmentAt: string } };
    }>(await h.send(`/tracked-rides/${ride.id}`));
    assert.equal(
      after.ride.refresh.lastSuccessfulAssessmentAt,
      '2026-10-10T00:00:00.000Z',
    );
  },
);
run(
  'incomplete comparison forecasts are retried even while the chosen departure stays fresh',
  async (h) => {
    const ride = await seed(h);
    const db = await h.runtime.getD1Database('ROUTES_DB');
    const snapshot = structuredClone(ride.latestAssessment);
    snapshot.context.weather.refreshAt = null;
    snapshot.context.coverageComplete = false;
    const assessmentId = crypto.randomUUID();
    await db.batch([
      db
        .prepare('INSERT INTO tracking_assessments VALUES (?,?,?,?,?,?)')
        .bind(
          'alice',
          ride.id,
          assessmentId,
          FIXED_NOW,
          assessmentId,
          JSON.stringify(snapshot),
        ),
      db
        .prepare(
          'UPDATE tracked_rides SET latest_id = ? WHERE owner_id = ? AND id = ?',
        )
        .bind(assessmentId, 'alice', ride.id),
    ]);
    const calls = h.requests.length;
    await h.restart({ TEST_NOW: '2026-10-09T12:15:00.000Z' });
    await monitor(h, ride.id);
    const current = await json<{
      ride: {
        refresh: { lastSuccessfulAssessmentAt: string };
        latestAssessment: Snapshot;
      };
    }>(await h.send(`/tracked-rides/${ride.id}`));
    assert.equal(
      current.ride.refresh.lastSuccessfulAssessmentAt,
      '2026-10-09T12:15:00.000Z',
    );
    assert.equal(current.ride.latestAssessment.context.coverageComplete, true);
    assert.equal(h.requests.length, calls);
  },
);
run(
  'an outage starts at the tightened same-day expiry, not the first later check',
  async (h) => {
    const ride = await seed(h);
    await h.restart({ TEST_NOW: '2026-10-09T20:30:00.000Z' });
    h.use(
      metOffice(({ request }) =>
        HttpResponse.json(
          hourlyForecast(request, { modelRunDate: '2026-10-09T20:30:00.000Z' }),
        ),
      ),
    );
    await monitor(h, ride.id);
    await h.restart({ TEST_NOW: '2026-10-10T00:00:00.000Z' });
    h.use(metOffice(() => new HttpResponse(null, { status: 503 })));
    await monitor(h, ride.id);
    const db = await h.runtime.getD1Database('ROUTES_DB');
    const row = await db
      .prepare(
        'SELECT state_json FROM tracking_monitors WHERE owner_id = ? AND plan_id = ?',
      )
      .bind('alice', ride.id)
      .first<{ state_json: string }>();
    assert.ok(row);
    assert.equal(
      JSON.parse(row.state_json).unavailableSince,
      '2026-10-09T23:30:00.000Z',
    );
  },
);
run(
  'checks remain eligible at the next quarter-hour despite time spent processing the previous job',
  async (h) => {
    const ride = await seed(h);
    await h.restart({ TEST_NOW: '2026-10-09T12:00:07.000Z' });
    await monitor(h, ride.id);
    await h.restart({ TEST_NOW: '2026-10-09T12:15:00.000Z' });
    const { jobs } = await json<{ jobs: { planId: string }[] }>(
      await h.send('/__test/dispatch'),
    );
    assert.deepEqual(
      jobs.map((j) => j.planId),
      [ride.id],
    );
  },
);

run(
  'pausing cancels all unsent deliveries and stops weather and every alert while preserving the plan and reference',
  async (h) => {
    const ride = await seed(h);
    await register(h);
    await change(h, ride, -6);
    await monitor(h, ride.id); // A durable pending delivery, with credentials absent.
    assert.equal(
      first((await notifications(h, ride.id)).notifications).devicesPending,
      1,
    );
    const before = await monitorState(h, ride.id);
    await pause(h);
    const history = (await notifications(h, ride.id)).notifications;
    assert.equal(first(history).status, 'cancelled');
    assert.equal(first(history).devicesPending, 0);
    assert.equal(
      (await monitorState(h, ride.id))?.state_json,
      before?.state_json,
    );
    await clearCache(h);
    const calls = h.requests.length;
    await h.restart({
      TEST_NOW: '2026-10-09T19:00:00.000Z',
      APNS_CONFIG_JSON: config,
    });
    h.use(); // Any forecast or APNs request is a test failure.
    await monitor(h, ride.id);
    assert.equal(h.requests.length, calls);
    assert.deepEqual((await notifications(h, ride.id)).notifications, history);
    assert.equal(
      (await monitorState(h, ride.id))?.state_json,
      before?.state_json,
    );
    const current = await json<{ ride: Ride & { state: string } }>(
      await h.send(`/tracked-rides/${ride.id}`),
    );
    assert.equal(current.ride.state, 'active');
    assert.deepEqual(current.ride.baseline, ride.baseline);
    await h.restart({ TEST_NOW: ride.departureAt });
    await monitor(h, ride.id);
    assert.equal(await monitorState(h, ride.id), null);
    assert.equal(h.requests.length, calls);
  },
);

run(
  'explicit resume rebases quietly, drops a missed evening summary and then alerts on new weather changes',
  async (h) => {
    const ride = await seed(h);
    await register(h);
    await pause(h);
    await change(h, ride, -12);
    // Resume after the summary, without ever running a monitor during the pause.
    await h.restart({
      TEST_NOW: '2026-10-09T19:00:00.000Z',
      APNS_CONFIG_JSON: config,
    });
    const payloads: { reasons: string[] }[] = [];
    h.use(
      metOffice(({ request }) =>
        HttpResponse.json(
          hourlyForecast(request, {
            modelRunDate: '2026-10-09T19:00:00.000Z',
            values: () => ({ screenTemperature: 2 }),
          }),
        ),
      ),
      http.post(
        'https://api.sandbox.push.apple.com/3/device/:token',
        async ({ request }) => {
          payloads.push((await request.json()) as { reasons: string[] });
          return new HttpResponse(null, { status: 200 });
        },
      ),
    );
    await resume(h);
    await monitor(h, ride.id);
    assert.equal(payloads.length, 0);
    assert.equal((await notifications(h, ride.id)).notifications.length, 0);
    const { ride: current } = await json<{ ride: Ride }>(
      await h.send(`/tracked-rides/${ride.id}`),
    );
    assert.deepEqual(current.baseline, ride.baseline);
    const saved = await monitorState(h, ride.id);
    assert.ok(saved?.state_json);
    const state = JSON.parse(saved.state_json) as MonitorState;
    assert.equal(saved.resume_pending, 0);
    assert.equal(state.summaryDone, true);
    assert.equal(
      state.reference.score,
      current.latestAssessment.pick.candidate.score,
    );
    await monitor(h, ride.id);
    assert.equal(payloads.length, 0);
    await change(
      h,
      current,
      current.latestAssessment.pick.candidate.score -
        current.baseline.pick.candidate.score -
        6,
    );
    await monitor(h, ride.id);
    assert.deepEqual(first(payloads).reasons, ['score_worsened']);
  },
);

run(
  'a dated pause resumes from cron alone and never sends a missed summary',
  async (h) => {
    const ride = await seed(h);
    await register(h);
    await pause(h, '2026-10-10');
    const calls = h.requests.length;
    await h.restart({ TEST_NOW: '2026-10-09T22:45:00.000Z' });
    await monitor(h, ride.id);
    assert.equal(h.requests.length, calls);
    await h.restart({
      TEST_NOW: '2026-10-09T23:00:00.000Z',
      APNS_CONFIG_JSON: config,
    });
    h.use(
      metOffice(({ request }) =>
        HttpResponse.json(
          hourlyForecast(request, {
            modelRunDate: '2026-10-09T23:00:00.000Z',
            values: () => ({ screenTemperature: 2 }),
          }),
        ),
      ),
    );
    const { jobs } = await json<{
      jobs: { ownerId: string; planId: string }[];
    }>(await h.send('/__test/dispatch'));
    assert.deepEqual(jobs, [{ ownerId: 'alice', planId: ride.id }]);
    for (const job of jobs) await monitor(h, job.planId);
    assert.ok(h.requests.length > calls);
    assert.equal((await monitorState(h, ride.id))?.resume_pending, 0);
    assert.equal((await notifications(h, ride.id)).notifications.length, 0);
    await h.restart({ TEST_NOW: '2026-10-09T23:15:00.000Z' });
    await monitor(h, ride.id);
    assert.equal((await notifications(h, ride.id)).notifications.length, 0);
    assert.equal(
      (await json<{ user: { pause: unknown } }>(await h.send('/users/me'))).user
        .pause,
      null,
    );
  },
);

run(
  'plans can be created and manually refreshed while paused, then start scheduled monitoring quietly',
  async (h) => {
    // Recommendations and tracked-ride creation remain available while paused.
    const ride = await seed(h, '2026-10-10');
    const state = await monitorState(h, ride.id);
    assert.equal(state?.state_json, null);
    assert.equal(state?.resume_pending, 1);
    await register(h);
    const response = await h.send(`/tracked-rides/${ride.id}/refresh`, {
      method: 'POST',
    });
    assert.equal(response.status, 200);
    await h.restart({
      TEST_NOW: '2026-10-09T23:00:00.000Z',
      APNS_CONFIG_JSON: config,
    });
    h.use(
      metOffice(({ request }) =>
        HttpResponse.json(
          hourlyForecast(request, {
            modelRunDate: '2026-10-09T23:00:00.000Z',
            values: () => ({ screenTemperature: 2 }),
          }),
        ),
      ),
    );
    await monitor(h, ride.id);
    assert.equal((await monitorState(h, ride.id))?.resume_pending, 0);
    assert.equal((await notifications(h, ride.id)).notifications.length, 0);
  },
);

run(
  'resume stays quiet through an outage until a successful assessment supplies the reference',
  async (h) => {
    const ride = await seed(h);
    await register(h);
    await pause(h);
    await clearCache(h);
    await h.restart({
      TEST_NOW: '2026-10-09T19:00:00.000Z',
      APNS_CONFIG_JSON: config,
    });
    await resume(h);
    h.use(metOffice(() => new HttpResponse(null, { status: 503 })));
    await monitor(h, ride.id);
    await h.restart({ TEST_NOW: '2026-10-09T20:00:00.000Z' });
    await monitor(h, ride.id);
    assert.equal((await monitorState(h, ride.id))?.resume_pending, 1);
    assert.equal((await notifications(h, ride.id)).notifications.length, 0);
    h.use(
      metOffice(({ request }) =>
        HttpResponse.json(
          hourlyForecast(request, { modelRunDate: '2026-10-09T20:00:00.000Z' }),
        ),
      ),
    );
    await monitor(h, ride.id);
    assert.equal((await monitorState(h, ride.id))?.resume_pending, 0);
    await monitor(h, ride.id);
    assert.equal((await notifications(h, ride.id)).notifications.length, 0);
  },
);

run(
  'pausing during a weather refresh invalidates the running monitor and prevents its alert',
  async (h) => {
    const ride = await seed(h);
    await register(h);
    const state = await monitorState(h, ride.id);
    await h.restart({
      TEST_NOW: '2026-10-09T18:00:00.000Z',
      APNS_CONFIG_JSON: config,
    });
    let release = () => {},
      entered = () => {};
    const wait = new Promise<void>((r) => {
      release = r;
    });
    const started = new Promise<void>((r) => {
      entered = r;
    });
    h.use(
      metOffice(async ({ request }) => {
        entered();
        await wait;
        return HttpResponse.json(
          hourlyForecast(request, {
            modelRunDate: '2026-10-09T18:00:00.000Z',
            values: () => ({ screenTemperature: 2 }),
          }),
        );
      }),
    );
    const pending = monitor(h, ride.id);
    await started;
    try {
      await pause(h);
    } finally {
      release();
    }
    await pending;
    assert.equal(
      (await monitorState(h, ride.id))?.state_json,
      state?.state_json,
    );
    assert.equal((await monitorState(h, ride.id))?.resume_pending, 1);
    assert.equal((await notifications(h, ride.id)).notifications.length, 0);
  },
);

run(
  'pausing during an APNs request cancels the remaining device and prevents the old monitor advancing the reference',
  async (h) => {
    const ride = await seed(h);
    await register(h);
    await register(h, 'b'.repeat(64));
    await h.restart({ APNS_CONFIG_JSON: config });
    let release = () => {},
      entered = () => {},
      sends = 0;
    const wait = new Promise<void>((r) => {
      release = r;
    });
    const started = new Promise<void>((r) => {
      entered = r;
    });
    h.use(
      metOffice(),
      http.post(
        'https://api.sandbox.push.apple.com/3/device/:token',
        async () => {
          sends++;
          entered();
          await wait;
          return new HttpResponse(null, { status: 200 });
        },
      ),
    );
    await change(h, ride, -6);
    const pending = monitor(h, ride.id);
    await started;
    let pausedState: string | null | undefined;
    try {
      await pause(h);
      pausedState = (await monitorState(h, ride.id))?.state_json;
    } finally {
      release();
    }
    await pending;
    assert.equal(sends, 1);
    const history = first((await notifications(h, ride.id)).notifications);
    assert.equal(history.status, 'cancelled');
    assert.equal(history.devicesPending, 0);
    assert.equal((await monitorState(h, ride.id))?.state_json, pausedState);
  },
);

run(
  'a plan created during a pause rebases even when its first job runs only after automatic expiry',
  async (h) => {
    const ride = await seed(h, '2026-10-10', false);
    assert.equal((await monitorState(h, ride.id))?.resume_pending, 0);
    await register(h);
    await h.restart({
      TEST_NOW: '2026-10-09T23:00:00.000Z',
      APNS_CONFIG_JSON: config,
    });
    h.use(
      metOffice(({ request }) =>
        HttpResponse.json(
          hourlyForecast(request, {
            modelRunDate: '2026-10-09T23:00:00.000Z',
            values: () => ({ screenTemperature: 2 }),
          }),
        ),
      ),
    );
    await monitor(h, ride.id);
    assert.equal((await notifications(h, ride.id)).notifications.length, 0);
    const saved = await monitorState(h, ride.id);
    assert.equal(saved?.resume_pending, 0);
    assert.ok(saved?.state_json);
    assert.equal(
      (JSON.parse(saved.state_json) as MonitorState).summaryDone,
      true,
    );
    // DELETE after automatic resume is a no-op for the comparison reference.
    await resume(h);
    assert.deepEqual(await monitorState(h, ride.id), saved);
  },
);

run(
  'clearing an expired pause before a new plan has ever been monitored preserves its quiet first assessment',
  async (h) => {
    const ride = await seed(h, '2026-10-10', false);
    await register(h);
    await h.restart({
      TEST_NOW: '2026-10-09T23:00:00.000Z',
      APNS_CONFIG_JSON: config,
    });
    h.use(
      metOffice(({ request }) =>
        HttpResponse.json(
          hourlyForecast(request, {
            modelRunDate: '2026-10-09T23:00:00.000Z',
            values: () => ({ screenTemperature: 2 }),
          }),
        ),
      ),
    );
    await resume(h);
    assert.equal((await monitorState(h, ride.id))?.resume_pending, 1);
    await monitor(h, ride.id);
    assert.equal((await monitorState(h, ride.id))?.resume_pending, 0);
    assert.equal((await notifications(h, ride.id)).notifications.length, 0);
  },
);

run(
  'a short pause before summary time keeps the later evening summary eligible',
  async (h) => {
    const ride = await seed(h);
    await register(h);
    await pause(h);
    await resume(h);
    await monitor(h, ride.id);
    const saved = await monitorState(h, ride.id);
    assert.ok(saved?.state_json);
    assert.equal(
      (JSON.parse(saved.state_json) as MonitorState).summaryDone,
      false,
    );
    await h.restart({
      TEST_NOW: '2026-10-09T18:00:00.000Z',
      APNS_CONFIG_JSON: config,
    });
    const payloads: { reasons: string[] }[] = [];
    h.use(
      metOffice(({ request }) =>
        HttpResponse.json(
          hourlyForecast(request, { modelRunDate: '2026-10-09T18:00:00.000Z' }),
        ),
      ),
      http.post(
        'https://api.sandbox.push.apple.com/3/device/:token',
        async ({ request }) => {
          payloads.push((await request.json()) as { reasons: string[] });
          return new HttpResponse(null, { status: 200 });
        },
      ),
    );
    await monitor(h, ride.id);
    assert.ok(first(payloads).reasons.includes('evening_summary'));
  },
);

const browserKeys = generateKeyPairSync('ec', {
  namedCurve: 'prime256v1',
}).privateKey.export({ format: 'jwk' });
const browserPublic = Buffer.concat([
  Buffer.from([4]),
  Buffer.from(browserKeys.x ?? '', 'base64url'),
  Buffer.from(browserKeys.y ?? '', 'base64url'),
]).toString('base64url');
const webConfig = JSON.stringify({
  subject: 'mailto:push@example.test',
  publicKey: browserPublic,
  privateKey: browserKeys.d,
});
const subscription = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/synthetic-device',
  expirationTime: null,
  keys: {
    p256dh: browserPublic,
    auth: Buffer.alloc(16, 42).toString('base64url'),
  },
};
const registerBrowser = (
  h: Harness,
  id: string,
  value = subscription,
  token?: string,
) =>
  h.send(`/push-devices/${id}`, {
    method: 'PUT',
    ...(token ? { token } : {}),
    body: JSON.stringify({
      transport: 'web_push',
      platform: 'chrome',
      subscription: value,
    }),
  });
run(
  'Chrome registration rejects unsafe endpoints, keeps secrets private, rotates versions and enforces ownership',
  async (h) => {
    const id = crypto.randomUUID();
    assert.equal((await registerBrowser(h, id)).status, 200);
    assert.equal(
      (await registerBrowser(h, id, subscription, BOB_TOKEN)).status,
      409,
    );
    assert.equal((await registerBrowser(h, crypto.randomUUID())).status, 409);
    for (const endpoint of [
      'https://localhost/fcm/send/x',
      'https://fcm.googleapis.com/fcm/send/x?redirect=1',
      'https://fcm.googleapis.com.evil.test/fcm/send/x',
    ])
      assert.equal(
        (
          await registerBrowser(h, crypto.randomUUID(), {
            ...subscription,
            endpoint,
          })
        ).status,
        400,
      );
    assert.equal(
      (
        await registerBrowser(h, id, {
          ...subscription,
          keys: {
            ...subscription.keys,
            p256dh: Buffer.alloc(65).toString('base64url'),
          },
        })
      ).status,
      400,
    );
    const version = async () =>
      (await h.runtime.getD1Database('ROUTES_DB'))
        .prepare('SELECT version FROM push_devices WHERE id=?')
        .bind(id)
        .first<{ version: number }>();
    assert.equal((await version())?.version, 1);
    assert.equal((await registerBrowser(h, id)).status, 200);
    assert.equal((await version())?.version, 1);
    assert.equal(
      (
        await registerBrowser(h, id, {
          ...subscription,
          keys: {
            ...subscription.keys,
            auth: Buffer.alloc(16, 43).toString('base64url'),
          },
        })
      ).status,
      200,
    );
    assert.equal((await version())?.version, 2);
    const listing = await (await h.send('/push-devices')).text();
    assert.ok(listing.includes('web_push'));
    assert.ok(!listing.includes(subscription.endpoint));
    assert.ok(!listing.includes(subscription.keys.p256dh));
    const configuration = await json<{
      webPush: { publicKey: string | null; configured: boolean };
    }>(await h.send('/push-devices/config'));
    assert.equal(configuration.webPush.configured, false);
    await h.restart({ WEB_PUSH_CONFIG_JSON: webConfig });
    const configured = await (await h.send('/push-devices/config')).text();
    assert.ok(configured.includes(browserPublic));
    assert.ok(!configured.includes(browserKeys.d ?? 'missing-private-key'));
    assert.equal(
      (await h.send(`/push-devices/${id}`, { method: 'DELETE' })).status,
      204,
    );
    assert.equal(await version(), null);
  },
);
run(
  'Chrome and Apple share one decision while retrying each installation independently',
  async (h) => {
    const ride = await seed(h);
    await register(h);
    assert.equal((await registerBrowser(h, crypto.randomUUID())).status, 200);
    await h.restart({
      APNS_CONFIG_JSON: config,
      WEB_PUSH_CONFIG_JSON: webConfig,
    });
    let apple = 0,
      web = 0,
      fail = true;
    h.use(
      metOffice(),
      http.post('https://api.sandbox.push.apple.com/3/device/:token', () => {
        apple++;
        return new HttpResponse(null, { status: 200 });
      }),
      http.post(subscription.endpoint, async ({ request }) => {
        web++;
        assert.equal(request.headers.get('content-encoding'), 'aes128gcm');
        assert.ok((await request.arrayBuffer()).byteLength > 100);
        return new HttpResponse(null, { status: fail ? 503 : 201 });
      }),
    );
    await change(h, ride, -6);
    await monitor(h, ride.id);
    assert.equal(apple, 1);
    assert.equal(web, 1);
    let history = first((await notifications(h, ride.id)).notifications);
    assert.equal(history.devicesAccepted, 1);
    assert.equal(history.devicesPending, 1);
    fail = false;
    await h.restart({ TEST_NOW: '2026-10-09T12:15:00.000Z' });
    await monitor(h, ride.id);
    assert.equal(apple, 1);
    assert.equal(web, 2);
    history = first((await notifications(h, ride.id)).notifications);
    assert.equal(history.devicesAccepted, 2);
    await monitor(h, ride.id);
    assert.equal(web, 2);
  },
);
run(
  'notification landing page is public but exposes no ride data and uses an external script with a restrictive CSP',
  async (h) => {
    const response = await h.send('/notifications/open');
    assert.equal(response.status, 200);
    assert.match(
      response.headers.get('content-security-policy') ?? '',
      /script-src 'self'/,
    );
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    const page = await response.text();
    assert.ok(page.includes('/notifications/page.js'));
    assert.ok(!page.includes('test-token'));
    const script = await h.send('/notifications/page.js');
    assert.equal(script.status, 200);
    assert.match(script.headers.get('content-type') ?? '', /javascript/);
  },
);
