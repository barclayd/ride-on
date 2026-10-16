import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { test } from 'node:test';
import { decodeJwt, decodeProtectedHeader } from 'jose';
import { HttpResponse, http } from 'msw/http';
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
const seed = async (h: Harness) => {
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
  await monitor(h, ride.id);
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
