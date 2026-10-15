import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HttpResponse } from 'msw/http';
import { z } from 'zod';
import { createScoreBaselineStore } from '../src/recommendations/score-baselines.ts';
import { userSchema } from '../src/users/model.ts';
import { first, recommendMetOffice, upload } from './client.ts';
import { hourlyForecast, metOffice } from './fixtures.ts';
import {
  BOB_TOKEN,
  createHarness,
  type Harness,
  RIDE_DATE,
} from './harness.ts';

const integration = (name: string, run: (h: Harness) => Promise<void>) =>
  test(name, { timeout: 30_000 }, async () => {
    const h = await createHarness();
    try {
      await run(h);
    } finally {
      await h.dispose();
      assert.deepEqual(h.unexpected, []);
      assert.deepEqual(h.handlerErrors, []);
    }
  });
const readUser = async (r: { json: () => Promise<unknown> }) =>
  z
    .object({
      user: userSchema.strip().extend({
        preferenceLevels: z.object({ crosswind: z.string() }),
      }),
    })
    .parse(await r.json()).user;

integration(
  'crosswind levels persist, preserve custom settings and reject conflicting or invalid writes',
  async (h) => {
    h.use(metOffice());
    const route = await upload(h);
    const created = await readUser(
      await h.send('/users', {
        body: JSON.stringify({
          displayName: 'Rider',
          settings: {
            preferences: {
              wind: {
                crosswindSensitivity: 5,
                comfortableGustKph: 25,
                preferTailwind: true,
              },
            },
          },
        }),
      }),
    );
    assert.equal(created.preferenceLevels.crosswind, 'custom');
    const initial = await recommendMetOffice(h, [route.id]);
    const calls = h.requests.length;
    const patched = await h.send('/users/me', {
      method: 'PATCH',
      body: JSON.stringify({
        expectedVersion: created.version,
        settings: { preferenceLevels: { crosswind: 'high' } },
      }),
    });
    assert.equal(patched.status, 200);
    const saved = await readUser(patched);
    assert.equal(saved.settings.preferences.wind.crosswindSensitivity, 2);
    assert.equal(saved.preferenceLevels.crosswind, 'high');
    assert.equal(saved.settings.preferences.wind.preferTailwind, true);
    await h.restart();
    assert.deepEqual(await readUser(await h.send('/users/me')), saved);
    const temporary = await recommendMetOffice(h, [route.id], {
      preferenceLevels: { crosswind: 'low' },
    });
    assert.equal(temporary.resolvedPreferences.wind.crosswindSensitivity, 0.5);
    assert.equal(initial.resolvedPreferences.wind.crosswindSensitivity, 5);
    assert.equal(h.requests.length, calls);
    for (const settings of [
      { preferenceLevels: { crosswind: 'custom' } },
      { preferenceLevels: { crosswind: null } },
      {
        preferenceLevels: { crosswind: 'high' },
        preferences: { wind: { crosswindSensitivity: 2 } },
      },
    ]) {
      assert.equal(
        (
          await h.send('/users/me', {
            method: 'PATCH',
            body: JSON.stringify({ expectedVersion: saved.version, settings }),
          })
        ).status,
        400,
      );
      for (const endpoint of [
        '/recommendations',
        '/recommendations/next-windows',
      ])
        assert.equal(
          (
            await h.send(endpoint, {
              body: JSON.stringify({
                routeIds: [route.id],
                ...(endpoint.endsWith('next-windows')
                  ? { after: { date: '2026-10-09', window: 'daylight' } }
                  : { date: RIDE_DATE }),
                ...settings,
              }),
            })
          ).status,
          400,
        );
    }
    assert.deepEqual(await readUser(await h.send('/users/me')), saved);
    const limit = await readUser(
      await h.send('/users/me', {
        method: 'PATCH',
        body: JSON.stringify({
          expectedVersion: saved.version,
          settings: {
            preferences: { minimumStandards: { maximumGustKph: 50 } },
          },
        }),
      }),
    );
    assert.equal(limit.settings.preferences.wind.comfortableGustKph, 25);
  },
);

const previousSchema = z
  .object({ score: z.number(), generatedAt: z.string() })
  .nullable();
const candidate = z.object({
  score: z.number(),
  previous: previousSchema,
  departureAt: z.string(),
  pointsLost: z.record(z.string(), z.number().nullable()),
  conditions: z.object({ windFromDegrees: z.number().nullable() }),
});
const detail = z.object({
  rankings: z.array(z.object({ routeId: z.string(), best: candidate })),
  days: z.array(z.object({ date: z.string(), best: candidate.nullable() })),
});
const recommendDetail = async (
  h: Harness,
  id: string,
  changes: Record<string, unknown> = {},
) => {
  const r = await h.send('/recommendations', {
    body: JSON.stringify({
      routeIds: [id],
      date: RIDE_DATE,
      weather: { mode: 'strict', providerId: 'met-office' },
      forecast: {
        representation: 'deterministic',
        freshnessBasis: 'retrieval-time',
      },
      ...changes,
    }),
  });
  assert.equal(r.status, 200);
  return detail.parse(await r.json());
};

integration(
  'previous best stays anchored across reloads and weather changes, and resets for incomparable inputs',
  async (h) => {
    let temperature = 14;
    h.use(
      metOffice(({ request }) =>
        HttpResponse.json(
          hourlyForecast(request, {
            values: () => ({ screenTemperature: temperature }),
          }),
        ),
      ),
    );
    const route = await upload(h);
    const initial = await recommendDetail(h, route.id);
    const initialBest = first(initial.rankings).best;
    assert.equal(initialBest.previous, null);
    assert.equal(initialBest.conditions.windFromDegrees, 180);
    assert.ok((initialBest.pointsLost.temperature ?? 0) > 0);
    const calls = h.requests.length;
    await h.restart({ TEST_NOW: '2026-10-09T12:10:00.000Z' });
    const again = first((await recommendDetail(h, route.id)).rankings).best;
    assert.deepEqual(again.previous, {
      score: initialBest.score,
      generatedAt: '2026-10-09T12:00:00.000Z',
    });
    assert.equal(h.requests.length, calls);
    temperature = 18;
    await h.restart({ TEST_NOW: '2026-10-09T19:00:00.000Z' });
    const refreshed = await recommendDetail(h, route.id, {
      date: undefined,
      days: { kind: 'dates', dates: [RIDE_DATE] },
      previewDays: 2,
    });
    const laterBest = first(refreshed.rankings).best;
    assert.ok(laterBest.score > initialBest.score);
    assert.deepEqual(laterBest.previous, again.previous);
    assert.deepEqual(
      first(refreshed.days.filter((d) => d.date === RIDE_DATE)).best?.previous,
      again.previous,
    );
    for (const changes of [
      { preferences: { wind: { preferTailwind: true } } },
      { riding: { averageSpeedKph: 22 } },
      { riding: { window: { start: '09:00', end: '14:00' } } },
      { riding: { departureStepMinutes: 60 } },
      { timeZone: 'UTC' },
    ])
      assert.equal(
        first((await recommendDetail(h, route.id, changes)).rankings).best
          .previous,
        null,
      );
    // Display-only changes do not reset a comparable score.
    const units = await recommendDetail(h, route.id, {
      units: { temperature: 'F', windSpeed: 'mph' },
      display: { unit: 'mi' },
    });
    assert.deepEqual(first(units.rankings).best.previous, again.previous);
    await h.restart({ TEST_NOW: '2026-10-10T00:10:00.000Z' });
    assert.equal(
      first((await recommendDetail(h, route.id)).rankings).best.previous,
      null,
    );
  },
);

integration(
  'baseline storage isolates owners, keeps earliest generation, expires and bounds rows, and cascades route deletion',
  async (h) => {
    const alice = await upload(h);
    const bob = await upload({
      ...h,
      send: (path, init) => h.send(path, { ...init, token: BOB_TOKEN }),
    });
    const db = await h.runtime.getD1Database('ROUTES_DB');
    const remember = createScoreBaselineStore(db);
    const earlier = {
      key: 'same-comparison',
      routeId: alice.id,
      score: 80,
      generatedAt: '2026-10-09T12:00:00.000Z',
    };
    const later = {
      ...earlier,
      score: 85,
      generatedAt: '2026-10-09T12:30:00.000Z',
    };
    await Promise.all([
      remember('alice', [later], new Date(later.generatedAt)),
      remember('alice', [earlier], new Date(earlier.generatedAt)),
    ]);
    const result = await remember(
      'alice',
      [later],
      new Date(later.generatedAt),
    );
    assert.deepEqual(result.get(earlier.key), {
      score: 80,
      generatedAt: earlier.generatedAt,
    });
    const other = await remember(
      'bob',
      [{ ...later, routeId: bob.id, score: 30 }],
      new Date(later.generatedAt),
    );
    assert.equal(other.get(earlier.key)?.score, 30);
    const after = { ...later, generatedAt: '2026-10-12T12:00:00.000Z' };
    assert.deepEqual(
      (await remember('alice', [after], new Date(after.generatedAt))).get(
        earlier.key,
      ),
      { score: after.score, generatedAt: after.generatedAt },
    );
    await db
      .prepare(`WITH RECURSIVE sequence(n) AS (
        SELECT 1 UNION ALL SELECT n + 1 FROM sequence WHERE n < 1000
      ) INSERT INTO recommendation_score_baselines
        (owner_id, comparison_key, route_id, score, generated_at, expires_at)
        SELECT 'alice', 'older-' || n, ?, 75, '2026-10-12T11:00:00.000Z', ? FROM sequence`)
      .bind(alice.id, Date.parse('2026-10-14T11:00:00.000Z'))
      .run();
    assert.ok(
      (await remember('alice', [after], new Date(after.generatedAt))).has(
        earlier.key,
      ),
    );
    const count = (owner: string) =>
      db
        .prepare(
          'SELECT COUNT(*) AS count FROM recommendation_score_baselines WHERE owner_id = ?',
        )
        .bind(owner)
        .first<number>('count');
    assert.equal(await count('alice'), 1000);
    assert.equal(await count('bob'), 1);
    await db
      .prepare('DELETE FROM routes WHERE owner_id = ? AND id = ?')
      .bind('alice', alice.id)
      .run();
    assert.equal(await count('alice'), 0);
    assert.equal(await count('bob'), 1);
  },
);

integration(
  'auth me exposes only this login’s deduplicated linked methods, including real passkeys',
  async (h) => {
    const db = await h.runtime.getD1Database('ROUTES_DB');
    for (const [id, provider, owner, at] of [
      ['a1', 'apple', 'alice', '2026-10-01T10:00:00Z'],
      ['a2', 'apple', 'alice', '2026-10-03T10:00:00Z'],
      ['g1', 'google', 'alice', '2026-10-04T10:00:00Z'],
      ['g2', 'google', 'bob', '2026-09-01T10:00:00Z'],
    ])
      await db
        .prepare(
          'INSERT INTO auth_account (id, accountId, providerId, userId, createdAt, updatedAt, accessToken) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .bind(id, id, provider, owner, at, at, 'synthetic-private-token')
        .run();
    await db
      .prepare(`INSERT INTO auth_passkey (id, publicKey, userId, credentialID, counter, deviceType, backedUp, createdAt)
    VALUES ('p1', 'synthetic-key', 'alice', 'synthetic-credential', 0, 'multiDevice', 1, '2026-10-02T10:00:00Z')`)
      .run();
    const schema = z.object({
      user: z.object({ providers: z.array(z.string()) }),
    });
    const response = await h.send('/auth/me');
    const text = await response.text();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(schema.parse(JSON.parse(text)).user.providers, [
      'apple',
      'passkey',
      'google',
    ]);
    assert.ok(!text.includes('synthetic-private-token'));
    assert.ok(!text.includes('synthetic-key'));
    assert.deepEqual(
      schema.parse(
        await (await h.send('/auth/me', { token: BOB_TOKEN })).json(),
      ).user.providers,
      ['google'],
    );
    await db
      .prepare('DELETE FROM auth_passkey WHERE userId = ?')
      .bind('alice')
      .run();
    assert.deepEqual(
      schema.parse(await (await h.send('/auth/me')).json()).user.providers,
      ['apple', 'google'],
    );
    assert.equal((await h.send('/auth/me', { token: null })).status, 401);
  },
);
