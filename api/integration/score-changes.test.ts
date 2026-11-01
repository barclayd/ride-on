import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exportPKCS8, generateKeyPair } from 'jose';
import { HttpResponse, http } from 'msw/http';
import { z } from 'zod';
import {
  createScoreChangeStore,
  SCORE_CHANGE_RETENTION_MS,
  type ScoreChangeEntry,
} from '../src/recommendations/score-changes.ts';
import { appleWeatherFixture } from '../test/fixtures/apple-weather.ts';
import { first, upload } from './client.ts';
import { hourlyForecast, metOffice } from './fixtures.ts';
import {
  BOB_TOKEN,
  createHarness,
  FIXED_NOW,
  type Harness,
  RIDE_DATE,
} from './harness.ts';

const integration = (name: string, fn: (h: Harness) => Promise<void>) =>
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
const select = async (h: Harness, routeIds: string[], expectedVersion = 0) => {
  const response = await h.send('/route-selection', {
    method: 'PUT',
    body: JSON.stringify({ expectedVersion, routeIds }),
  });
  assert.equal(response.status, 200);
};
const changeSchema = z
  .object({
    from: z.number().int(),
    to: z.number().int(),
    by: z.number().int(),
    changedAt: z.iso.datetime(),
  })
  .nullable();
const bestSchema = z.object({
  score: z.number(),
  date: z.string(),
  departureAt: z.string(),
  scoreChange: changeSchema,
  previous: z.object({ score: z.number(), generatedAt: z.string() }).nullable(),
});
const responseSchema = z.object({
  algorithmVersion: z.string(),
  rankings: z.array(z.object({ routeId: z.string(), best: bestSchema })),
  unranked: z.array(z.object({ best: bestSchema.nullable() })),
  weather: z.object({ refreshAt: z.string().nullable() }),
  range: z
    .object({ dates: z.array(z.string()), preset: z.string().nullable() })
    .nullable(),
});
const recommend = async (
  h: Harness,
  routeIds: string[],
  overrides: Record<string, unknown> = {},
) => {
  const response = await h.send('/recommendations', {
    body: JSON.stringify({
      routeIds,
      date: RIDE_DATE,
      weather: { mode: 'strict', providerId: 'met-office' },
      forecast: {
        representation: 'deterministic',
        freshnessBasis: 'retrieval-time',
      },
      ...overrides,
    }),
  });
  assert.equal(response.status, 200);
  return responseSchema.parse(await response.json());
};

integration(
  'rolling preset tracks the overall best across days, quietly rebases when days roll, and ignores previews',
  async (h) => {
    let modelRunDate = FIXED_NOW;
    const temperatures: Record<string, number> = {
      '2026-10-10': 18,
      '2026-10-11': 14,
    };
    const keys = await generateKeyPair('ES256', { extractable: true });
    await h.restart({
      APPLE_WEATHER_CONFIG_JSON: JSON.stringify({
        teamId: 'TESTTEAM01',
        keyId: 'TESTKEY001',
        serviceId: 'cc.ride-on.test',
        privateKey: await exportPKCS8(keys.privateKey),
      }),
    });
    h.use(
      http.get(
        'https://weatherkit.apple.com/api/v1/weather/en/:latitude/:longitude',
        ({ params }) => {
          const data = appleWeatherFixture({
            latitude: Number(params.latitude),
            longitude: Number(params.longitude),
            start: new Date(
              Math.floor(Date.parse(modelRunDate) / 3_600_000) * 3_600_000 -
                3_600_000,
            ).toISOString(),
            now: modelRunDate,
            hours: 240,
          });
          for (const row of data.forecastHourly.hours)
            row.temperature = temperatures[row.forecastStart.slice(0, 10)] ?? 8;
          return HttpResponse.json(data);
        },
      ),
    );
    const route = await upload(h);
    await select(h, [route.id]);
    const plan = {
      date: undefined,
      days: { kind: 'preset', preset: 'next-five-days' },
      weather: { mode: 'strict', providerId: 'apple-weather' },
      riding: { window: { start: '09:00', end: '12:00' } },
    };
    const created = await h.send('/users', {
      body: JSON.stringify({
        displayName: 'Rider',
        settings: { planning: { days: plan.days } },
      }),
    });
    assert.equal(created.status, 201);
    assert.deepEqual(
      z
        .object({
          user: z.object({
            settings: z.object({ planning: z.object({ days: z.unknown() }) }),
          }),
        })
        .parse(await created.json()).user.settings.planning.days,
      plan.days,
    );
    const initial = await recommend(h, [route.id], plan);
    assert.equal(initial.range?.preset, 'next-five-days');
    assert.equal(first(initial.range?.dates ?? []), '2026-10-10');
    const before = first(initial.rankings).best;
    assert.equal(before.date, '2026-10-10');
    assert.equal(before.scoreChange, null);
    temperatures['2026-10-10'] = 10;
    modelRunDate = '2026-10-09T19:00:00.000Z';
    await h.restart({ TEST_NOW: modelRunDate });
    const moved = first((await recommend(h, [route.id], plan)).rankings).best;
    assert.equal(moved.date, '2026-10-11');
    assert.deepEqual(moved.scoreChange, {
      from: Math.round(before.score),
      to: Math.round(moved.score),
      by: Math.round(moved.score) - Math.round(before.score),
      changedAt: modelRunDate,
    });
    assert.ok(moved.scoreChange && moved.scoreChange.by < 0);
    assert.deepEqual(
      first(
        (await recommend(h, [route.id], { ...plan, previewDays: 7 })).rankings,
      ).best.scoreChange,
      moved.scoreChange,
    );
    assert.equal(
      first(
        (
          await recommend(h, [route.id], {
            ...plan,
            days: { kind: 'preset', preset: 'next' },
          })
        ).rankings,
      ).best.scoreChange,
      null,
    );
    temperatures['2026-10-11'] = 18;
    modelRunDate = '2026-10-10T00:10:00.000Z';
    await h.restart({ TEST_NOW: modelRunDate });
    const rolled = first((await recommend(h, [route.id], plan)).rankings).best;
    assert.equal(rolled.date, '2026-10-11');
    assert.notEqual(Math.round(rolled.score), Math.round(moved.score));
    assert.deepEqual(rolled.scoreChange, moved.scoreChange);
    temperatures['2026-10-11'] = 10;
    temperatures['2026-10-12'] = 14;
    modelRunDate = '2026-10-10T07:00:00.000Z';
    await h.restart({ TEST_NOW: modelRunDate });
    const again = first((await recommend(h, [route.id], plan)).rankings).best;
    assert.equal(again.date, '2026-10-12');
    assert.deepEqual(again.scoreChange, {
      from: Math.round(rolled.score),
      to: Math.round(again.score),
      by: Math.round(again.score) - Math.round(rolled.score),
      changedAt: modelRunDate,
    });
  },
);

integration(
  'HTTP badges survive cache reuse and midnight, resume plans, quietly rebase settings, and clear on removal',
  async (h) => {
    let temperature = 14;
    let modelRunDate = FIXED_NOW;
    h.use(
      metOffice(({ request }) =>
        HttpResponse.json(
          hourlyForecast(request, {
            modelRunDate,
            values: () => ({ screenTemperature: temperature }),
          }),
        ),
      ),
    );
    const route = await upload(h);
    // Unshortlisted evaluations do not retain state.
    assert.equal(
      first((await recommend(h, [route.id])).rankings).best.scoreChange,
      null,
    );
    await select(h, [route.id]);
    const initial = first((await recommend(h, [route.id])).rankings).best;
    assert.equal(initial.scoreChange, null);
    temperature = 18;
    modelRunDate = '2026-10-09T19:00:00.000Z';
    await h.restart({ TEST_NOW: modelRunDate });
    const updated = first((await recommend(h, [route.id])).rankings).best;
    const change = updated.scoreChange;
    assert.deepEqual(change, {
      from: Math.round(initial.score),
      to: Math.round(updated.score),
      by: Math.round(updated.score) - Math.round(initial.score),
      changedAt: modelRunDate,
    });
    assert.ok(change && change.by >= 1);
    const calls = h.requests.length;
    await h.restart({ TEST_NOW: '2026-10-09T19:10:00.000Z' });
    assert.deepEqual(
      first((await recommend(h, [route.id])).rankings).best.scoreChange,
      change,
    );
    assert.equal(h.requests.length, calls);
    const other = { riding: { window: { start: '09:00', end: '14:00' } } };
    assert.equal(
      first((await recommend(h, [route.id], other)).rankings).best.scoreChange,
      null,
    );
    assert.deepEqual(
      first(
        (
          await recommend(h, [route.id], {
            date: undefined,
            days: { kind: 'range', start: RIDE_DATE, end: RIDE_DATE },
            previewDays: 2,
          })
        ).rankings,
      ).best.scoreChange,
      change,
    );
    const preferences = { preferences: { temperature: { comfortMinC: 21 } } };
    const rebased = first(
      (await recommend(h, [route.id], preferences)).rankings,
    ).best;
    assert.notEqual(Math.round(rebased.score), Math.round(updated.score));
    assert.deepEqual(rebased.scoreChange, change);
    // Midnight must not erase the badge, even when previous resets.
    modelRunDate = '2026-10-10T00:10:00.000Z';
    await h.restart({ TEST_NOW: modelRunDate });
    const midnight = first(
      (await recommend(h, [route.id], preferences)).rankings,
    ).best;
    assert.deepEqual(midnight.scoreChange, change);
    assert.equal(midnight.previous, null);
    temperature = 16;
    modelRunDate = '2026-10-10T03:11:00.000Z';
    await h.restart({ TEST_NOW: modelRunDate });
    const weatherChange = first(
      (await recommend(h, [route.id], preferences)).rankings,
    ).best;
    assert.deepEqual(weatherChange.scoreChange, {
      from: Math.round(rebased.score),
      to: Math.round(weatherChange.score),
      by: Math.round(weatherChange.score) - Math.round(rebased.score),
      changedAt: modelRunDate,
    });
    // Expired departures quietly rebase, without replacing the last badge.
    modelRunDate = '2026-10-10T10:10:00.000Z';
    await h.restart({ TEST_NOW: modelRunDate });
    assert.deepEqual(
      first((await recommend(h, [route.id], preferences)).rankings).best
        .scoreChange,
      weatherChange.scoreChange,
    );
    await select(h, [], 1);
    await select(h, [route.id], 2);
    assert.equal(
      first((await recommend(h, [route.id], preferences)).rankings).best
        .scoreChange,
      null,
    );
  },
);

integration(
  'real D1 CAS records concurrent changes once, keeps one-point changes, reversals and per-route state',
  async (h) => {
    const a = await upload(h, 'A');
    const b = await upload(h, 'B', 0);
    await select(h, [a.id, b.id]);
    const db = await h.runtime.getD1Database('ROUTES_DB');
    const remember = createScoreChangeStore(db);
    const aEntry: ScoreChangeEntry = {
      routeId: a.id,
      planKey: 'plan',
      contextKey: 'context',
      score: 84,
    };
    const bEntry = { ...aEntry, routeId: b.id, score: 60 };
    const at = new Date(FIXED_NOW);
    const evaluate = (entries: ScoreChangeEntry[], ms = 0) =>
      remember('alice', entries, new Date(at.getTime() + ms));
    const initial = await Promise.all([
      evaluate([aEntry, bEntry]),
      evaluate([aEntry, bEntry]),
    ]);
    assert.equal(initial[0]?.get(a.id), null);
    assert.deepEqual(initial[0], initial[1]);
    const lower = { ...aEntry, score: 83 };
    const changed = await Promise.all([
      evaluate([lower, bEntry], 1000),
      evaluate([lower, bEntry], 1000),
    ]);
    assert.deepEqual(changed[0], changed[1]);
    const badge = {
      from: 84,
      to: 83,
      by: -1,
      changedAt: new Date(at.getTime() + 1000).toISOString(),
    };
    assert.deepEqual(changed[0]?.get(a.id), badge);
    assert.equal(changed[0]?.get(b.id), null);
    assert.deepEqual(
      (await evaluate([lower, { ...bEntry, score: 65 }], 2000)).get(a.id),
      badge,
    );
    // An older in-flight result cannot replace the newer reference or badge.
    assert.deepEqual((await evaluate([aEntry], 500)).get(a.id), badge);
    const reverse = await evaluate([aEntry], 3000);
    assert.deepEqual(reverse.get(a.id), {
      from: 83,
      to: 84,
      by: 1,
      changedAt: new Date(at.getTime() + 3000).toISOString(),
    });
    // Different concurrent observations both compare with the last committed reference.
    const different = await Promise.all([
      evaluate([{ ...aEntry, score: 80 }], 4000),
      evaluate([{ ...aEntry, score: 70 }], 4000),
    ]);
    const pairs = different.map((r) => r.get(a.id));
    assert.ok(pairs.some((c) => c?.from === 84));
    assert.ok(
      pairs.some(
        (c) =>
          (c?.from === 80 && c.to === 70) || (c?.from === 70 && c.to === 80),
      ),
    );
  },
);

integration(
  'state is owner-scoped, expires lazily after 30 days, caps oldest plans and cascades route deletion',
  async (h) => {
    const a = await upload(h);
    const bob = {
      ...h,
      send: (path: string, init?: Parameters<Harness['send']>[1]) =>
        h.send(path, { ...init, token: BOB_TOKEN }),
    };
    const b = await upload(bob);
    await select(h, [a.id]);
    await select(bob, [b.id]);
    const db = await h.runtime.getD1Database('ROUTES_DB');
    const remember = createScoreChangeStore(db);
    const at = new Date(FIXED_NOW);
    const entry = {
      routeId: a.id,
      planKey: 'plan',
      contextKey: 'context',
      score: 84,
    };
    await remember('alice', [entry], at);
    await remember('bob', [{ ...entry, routeId: b.id }], at);
    const badge = (await remember('alice', [{ ...entry, score: 83 }], at)).get(
      a.id,
    );
    assert.ok(badge);
    assert.equal(
      (await remember('bob', [{ ...entry, routeId: b.id }], at)).get(b.id),
      null,
    );
    assert.equal((await remember('bob', [entry], at)).size, 0);
    const expiredAt = new Date(at.getTime() + SCORE_CHANGE_RETENTION_MS);
    assert.equal((await remember('alice', [entry], expiredAt)).get(a.id), null);
    await db
      .prepare(`WITH RECURSIVE sequence(n) AS (
      SELECT 1 UNION ALL SELECT n + 1 FROM sequence WHERE n < 1000
    ) INSERT INTO recommendation_score_changes
      (owner_id,route_id,plan_key,context_key,reference_score,change_json,revision,evaluated_at)
      SELECT 'alice', ?, 'older-' || n, 'context', 84, NULL, 'revision-' || n, ? FROM sequence`)
      .bind(a.id, expiredAt.getTime() - 1000)
      .run();
    assert.equal((await remember('alice', [entry], expiredAt)).get(a.id), null);
    const count = (owner: string) =>
      db
        .prepare(
          'SELECT COUNT(*) AS count FROM recommendation_score_changes WHERE owner_id = ?',
        )
        .bind(owner)
        .first<number>('count');
    assert.equal(await count('alice'), 1000);
    assert.equal(await count('bob'), 1);
    await db
      .prepare('DELETE FROM routes WHERE owner_id = ? AND id = ?')
      .bind('alice', a.id)
      .run();
    assert.equal(await count('alice'), 0);
    assert.equal(await count('bob'), 1);
  },
);

integration(
  'missing badge storage fails open, and idle paused accounts retain state beyond the cleanup age',
  async (h) => {
    h.use(metOffice());
    const route = await upload(h);
    await select(h, [route.id]);
    await recommend(h, [route.id]);
    let db = await h.runtime.getD1Database('ROUTES_DB');
    const before = await db
      .prepare('SELECT * FROM recommendation_score_changes')
      .all();
    assert.equal(before.results.length, 1);
    assert.equal(
      (
        await h.send('/users', {
          body: JSON.stringify({ displayName: 'Rider' }),
        })
      ).status,
      201,
    );
    assert.equal(
      (
        await h.send('/users/me/pause', {
          method: 'PUT',
          body: JSON.stringify({ until: null }),
        })
      ).status,
      200,
    );
    const calls = h.requests.length;
    await h.restart({ TEST_NOW: '2026-12-01T12:00:00.000Z' });
    db = await h.runtime.getD1Database('ROUTES_DB');
    // Paused clients stop automatic evaluations. Profile reads do not prune
    // their state, even after thirty days. Manual recommendations remain allowed.
    const paused = await h.send('/users/me');
    assert.equal(paused.status, 200);
    assert.equal(h.requests.length, calls);
    assert.deepEqual(
      (await db.prepare('SELECT * FROM recommendation_score_changes').all())
        .results,
      before.results,
    );
    await h.restart({ TEST_NOW: FIXED_NOW });
    db = await h.runtime.getD1Database('ROUTES_DB');
    await h.send('/users/me/pause', { method: 'DELETE' });
    await db.prepare('DROP TABLE recommendation_score_changes').run();
    const usable = await recommend(h, [route.id]);
    assert.ok(first(usable.rankings).best.score > 0);
    assert.equal(first(usable.rankings).best.scoreChange, null);
    assert.equal(usable.algorithmVersion, 'comfort-v0.17');
  },
);
