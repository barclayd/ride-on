import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { User } from '../src/users/model.ts';
import type { Pause } from '../src/users/pause.ts';
import {
  BOB_TOKEN,
  createHarness,
  FIXED_NOW,
  type Harness,
} from './harness.ts';

type PublicUser = User & { pause: Pause | null };
const run = (name: string, fn: (h: Harness) => Promise<void>) =>
  test(name, { timeout: 30_000 }, async () => {
    const h = await createHarness();
    try {
      await fn(h);
    } finally {
      await h.dispose();
      assert.deepEqual(h.unexpected, []);
      assert.deepEqual(h.handlerErrors, []);
    }
  });
const readUser = async (
  r: { status: number; json(): Promise<unknown> },
  status = 200,
) => {
  assert.equal(r.status, status);
  return ((await r.json()) as { user: PublicUser }).user;
};
const create = async (h: Harness, settings = {}) =>
  readUser(
    await h.send('/users', {
      body: JSON.stringify({ displayName: 'Rider', settings }),
    }),
    201,
  );
const put = (h: Harness, until: string | null) =>
  h.send('/users/me/pause', { method: 'PUT', body: JSON.stringify({ until }) });
const patch = (h: Harness, body: unknown) =>
  h.send('/users/me', { method: 'PATCH', body: JSON.stringify(body) });

run(
  'pause endpoints require an owner session and an existing profile and never cache responses',
  async (h) => {
    for (const method of ['PUT', 'DELETE']) {
      const body =
        method === 'PUT' ? JSON.stringify({ until: null }) : undefined;
      assert.equal(
        (await h.send('/users/me/pause', { method, body, token: null })).status,
        401,
      );
      const missing = await h.send('/users/me/pause', { method, body });
      assert.equal(missing.status, 404);
      assert.equal(missing.headers.get('Cache-Control'), 'no-store');
      assert.equal(
        ((await missing.json()) as { error: { code: string } }).error.code,
        'USER_NOT_FOUND',
      );
    }
    const user = await create(h);
    assert.equal(user.pause, null);
    const response = await put(h, null);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    const paused = await readUser(response);
    assert.deepEqual(paused.pause, {
      until: null,
      resumesAt: null,
      pausedAt: FIXED_NOW,
    });
    assert.deepEqual({ ...paused, pause: null }, user);
    await h.send('/users', {
      token: BOB_TOKEN,
      body: JSON.stringify({ displayName: 'Bob' }),
    });
    assert.equal(
      (await readUser(await h.send('/users/me', { token: BOB_TOKEN }))).pause,
      null,
    );
    await h.send('/users/me/pause', { method: 'DELETE', token: BOB_TOKEN });
    assert.deepEqual(
      (await readUser(await h.send('/users/me'))).pause,
      paused.pause,
    );
  },
);

run(
  'return times follow the current profile zone and London clock changes without changing the pause start',
  async (h) => {
    await create(h);
    const first = await readUser(await put(h, '2026-10-25'));
    assert.equal(first.pause?.resumesAt, '2026-10-24T23:00:00.000Z');
    assert.deepEqual(await readUser(await put(h, '2026-10-25')), first);
    await h.restart({ TEST_NOW: '2026-10-09T13:00:00.000Z' });
    const changed = await readUser(await put(h, '2026-10-26'));
    assert.equal(changed.pause?.resumesAt, '2026-10-26T00:00:00.000Z');
    assert.equal(changed.pause?.pausedAt, FIXED_NOW);
    assert.equal(changed.version, 1);
    const west = await readUser(
      await patch(h, {
        expectedVersion: 1,
        settings: { timeZone: 'America/Los_Angeles' },
      }),
    );
    assert.equal(west.pause?.resumesAt, '2026-10-26T07:00:00.000Z');
    assert.equal(west.pause?.pausedAt, FIXED_NOW);
    assert.equal(west.version, 2);
    await h.restart();
    assert.deepEqual(await readUser(await h.send('/users/me')), west);
    const indefinite = await readUser(await put(h, null));
    assert.deepEqual(indefinite.pause, {
      until: null,
      resumesAt: null,
      pausedAt: FIXED_NOW,
    });
    await h.restart({ TEST_NOW: '2030-01-01T00:00:00.000Z' });
    assert.deepEqual(
      (await readUser(await h.send('/users/me'))).pause,
      indefinite.pause,
    );
  },
);

run(
  'pause validation rejects impossible and out-of-range dates and malformed bodies without changing the account',
  async (h) => {
    await h.restart({ TEST_NOW: '2026-10-10T00:30:00.000Z' });
    await create(h, { timeZone: 'America/Los_Angeles' });
    const saved = await readUser(await put(h, '2027-10-09')); // Exactly 365 local days.
    for (const until of [
      '2026-10-09',
      '2026-10-08',
      '2027-10-10',
      '2026-02-30',
      '',
      'tomorrow',
      '2026-10-10T00:00:00Z',
    ]) {
      const r = await put(h, until);
      assert.equal(r.status, 422, until);
      assert.equal(
        ((await r.json()) as { error: { code: string } }).error.code,
        'PAUSE_DATE_OUT_OF_RANGE',
      );
    }
    for (const body of [
      {},
      { until: 3 },
      { until: true },
      { until: [] },
      { until: {} },
      { until: null, expectedVersion: 1 },
      { until: null, ownerId: 'bob' },
    ]) {
      assert.equal(
        (
          await h.send('/users/me/pause', {
            method: 'PUT',
            body: JSON.stringify(body),
          })
        ).status,
        400,
      );
    }
    assert.equal(
      (await h.send('/users/me/pause', { method: 'PUT', body: '{' })).status,
      400,
    );
    assert.deepEqual(await readUser(await h.send('/users/me')), saved);
    assert.equal((await put(h, '2026-10-10')).status, 200); // Tomorrow in the rider's zone.
  },
);

run(
  'reads resolve expiry without a write; a new pause starts anew and DELETE is idempotent',
  async (h) => {
    const original = await create(h);
    const paused = await readUser(await put(h, '2026-10-10'));
    await h.restart({ TEST_NOW: '2026-10-09T22:59:59.999Z' });
    assert.deepEqual(
      (await readUser(await h.send('/users/me'))).pause,
      paused.pause,
    );
    const db = await h.runtime.getD1Database('ROUTES_DB');
    const stored = await db.prepare('SELECT * FROM user_pauses').all();
    await h.restart({ TEST_NOW: '2026-10-09T23:00:00.000Z' });
    assert.deepEqual(await readUser(await h.send('/users/me')), original);
    const currentDb = await h.runtime.getD1Database('ROUTES_DB');
    assert.deepEqual(
      (await currentDb.prepare('SELECT * FROM user_pauses').all()).results,
      stored.results,
    );
    const again = await readUser(await put(h, null));
    assert.equal(again.pause?.pausedAt, '2026-10-09T23:00:00.000Z');
    for (let i = 0; i < 2; i++)
      assert.deepEqual(
        await readUser(await h.send('/users/me/pause', { method: 'DELETE' })),
        original,
      );
    assert.deepEqual(
      (await currentDb.prepare('SELECT * FROM user_pauses').all()).results,
      [],
    );
  },
);

run(
  'concurrent preference and pause writes succeed independently and never put pause state in user_json',
  async (h) => {
    await create(h);
    const responses = await Promise.all([
      put(h, '2026-10-25'),
      patch(h, { expectedVersion: 1, displayName: 'Edited on another device' }),
    ]);
    for (const response of responses) assert.equal(response.status, 200);
    let user = await readUser(await h.send('/users/me'));
    assert.equal(user.version, 2);
    assert.equal(user.displayName, 'Edited on another device');
    assert.equal(user.pause?.until, '2026-10-25');
    const db = await h.runtime.getD1Database('ROUTES_DB');
    const stored = await db
      .prepare('SELECT user_json FROM users WHERE id = ?')
      .bind('alice')
      .first<{ user_json: string }>();
    assert.ok(stored);
    assert.equal('pause' in JSON.parse(stored.user_json), false);
    const more = await Promise.all([
      put(h, null),
      put(h, '2026-10-26'),
      patch(h, { expectedVersion: 2, settings: { timeZone: 'UTC' } }),
    ]);
    for (const response of more) assert.equal(response.status, 200);
    user = await readUser(await h.send('/users/me'));
    assert.equal(user.version, 3);
    assert.equal(user.pause?.pausedAt, FIXED_NOW);
    assert.ok(user.pause?.until === null || user.pause?.until === '2026-10-26');
    assert.equal(
      user.pause?.resumesAt,
      user.pause?.until ? '2026-10-26T00:00:00.000Z' : null,
    );
  },
);

run(
  'pause is not a preference or recommendation override; legacy profiles without a zone use London',
  async (h) => {
    const user = await create(h);
    for (const body of [
      { expectedVersion: 1, pause: { until: null } },
      { expectedVersion: 1, settings: { pause: { until: null } } },
    ])
      assert.equal((await patch(h, body)).status, 400);
    for (const path of ['/recommendations', '/recommendations/next-windows'])
      assert.equal(
        (
          await h.send(path, {
            body: JSON.stringify({ pause: { until: null } }),
          })
        ).status,
        400,
      );
    const db = await h.runtime.getD1Database('ROUTES_DB');
    await db
      .prepare(
        "UPDATE users SET user_json = json_remove(user_json, '$.settings.timeZone') WHERE id = ?",
      )
      .bind(user.id)
      .run();
    const paused = await readUser(await put(h, '2026-10-25'));
    assert.equal(paused.settings.timeZone, 'Europe/London');
    assert.equal(paused.pause?.resumesAt, '2026-10-24T23:00:00.000Z');
    assert.equal(paused.version, user.version);
  },
);
