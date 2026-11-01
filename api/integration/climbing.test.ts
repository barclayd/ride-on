import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HttpResponse } from 'msw/http';
import { z } from 'zod';
import { userSchema } from '../src/users/model.ts';
import { first, recommendMetOffice as recommend } from './client.ts';
import { hourlyForecast, metOffice } from './fixtures.ts';
import { createHarness, type Harness, RIDE_DATE } from './harness.ts';

const integration = (name: string, run: (h: Harness) => Promise<void>) =>
  test(name, { timeout: 20_000 }, async () => {
    const h = await createHarness();
    try {
      await run(h);
    } finally {
      await h.dispose();
      assert.deepEqual(h.unexpected, []);
      assert.deepEqual(h.handlerErrors, []);
    }
  });

const upload = async (h: Harness, ascentM: number | null, longitude = -1) => {
  const points = Array.from(
    { length: 13 },
    (_, i) =>
      `<trkpt lat="${51.2 + i * 0.03}" lon="${longitude}">${ascentM === null && i === 6 ? '' : `<ele>${50 + ((ascentM ?? 100) * i) / 12}</ele>`}</trkpt>`,
  ).join('');
  const response = await h.send('/routes', {
    body: `<gpx version="1.1"><trk><name>Synthetic terrain</name><trkseg>${points}</trkseg></trk></gpx>`,
    contentType: 'application/gpx+xml',
  });
  assert.equal(response.status, 201);
  const route = z
    .object({
      route: z.object({
        id: z.uuid(),
        ascentM: z.number().nullable(),
        warnings: z.array(z.string()),
      }),
    })
    .parse(await response.json()).route;
  assert.equal(route.ascentM, ascentM);
  assert.ok(
    route.warnings.includes(
      ascentM === null ? 'MISSING_ELEVATION' : 'ASCENT_IS_UNSMOOTHED_ESTIMATE',
    ),
  );
  return route;
};
const readUser = async (response: { json: () => Promise<unknown> }) =>
  z.object({ user: userSchema.strip() }).parse(await response.json()).user;
const createUser = async (h: Harness, preference = 'neutral') => {
  const response = await h.send('/users', {
    body: JSON.stringify({
      displayName: 'Cyclist',
      settings: {
        preferences: { climbing: { preference } },
      },
    }),
  });
  assert.equal(response.status, 201);
  return readUser(response);
};
const override = (preference: string) => ({
  preferences: { climbing: { preference } },
});

integration(
  'stored climbing preferences and temporary overrides reverse rankings, survive restart and reuse weather',
  async (h) => {
    h.use(metOffice());
    const flat = await upload(h, 0);
    const hilly = await upload(h, 1200);
    const ids = [hilly.id, flat.id];
    const saved = await createUser(h, 'flatter');
    const flatter = await recommend(h, ids);
    assert.equal(flatter.recommendedRouteId, flat.id);
    assert.equal(first(flatter.rankings).best.factors.climbing, 100);
    assert.equal(first(flatter.rankings).ascentM, 0);
    assert.equal(first(flatter.rankings).ascentMPerKm, 0);
    const calls = h.requests.length;
    assert.ok(calls > 0);
    const hillier = await recommend(h, ids, override('hillier'));
    assert.equal(hillier.recommendedRouteId, hilly.id);
    assert.equal(first(hillier.rankings).best.factors.climbing, 100);
    assert.equal(hillier.weather.cache.misses, 0);
    assert.equal(h.requests.length, calls);
    assert.deepEqual(await readUser(await h.send('/users/me')), saved);
    await h.restart();
    assert.equal((await recommend(h, ids)).recommendedRouteId, flat.id);
    assert.equal(h.requests.length, calls);
    const updated = await h.send('/users/me', {
      method: 'PATCH',
      body: JSON.stringify({
        expectedVersion: 1,
        settings: { preferences: { climbing: { preference: 'hillier' } } },
      }),
    });
    assert.equal(updated.status, 200);
    assert.equal((await readUser(updated)).version, 2);
    const emptyPatch = await h.send('/users/me', {
      method: 'PATCH',
      body: JSON.stringify({
        expectedVersion: 2,
        settings: { preferences: { climbing: {} } },
      }),
    });
    assert.equal(emptyPatch.status, 200);
    assert.equal(
      (await readUser(emptyPatch)).settings.preferences.climbing.preference,
      'hillier',
    );
    await h.restart();
    assert.equal(
      (await recommend(h, ids, { preferences: { climbing: {} } }))
        .recommendedRouteId,
      hilly.id,
    );
    assert.equal(h.requests.length, calls);
    const neutral = await recommend(h, ids, override('neutral'));
    for (const route of neutral.rankings) {
      assert.equal(route.best.score, route.best.weatherScore);
      assert.equal(route.best.factors.climbing, null);
    }
  },
);

integration(
  'legacy profiles read as neutral without rewriting storage; unrelated updates preserve the neutral default',
  async (h) => {
    const saved = await createUser(h);
    const legacy = {
      ...saved,
      settings: {
        ...saved.settings,
        preferences: Object.fromEntries(
          Object.entries(saved.settings.preferences).filter(
            ([key]) => key !== 'climbing',
          ),
        ),
      },
    };
    const db = await h.runtime.getD1Database('ROUTES_DB');
    const storedJson = JSON.stringify(legacy);
    await db
      .prepare('UPDATE users SET user_json = ? WHERE id = ?')
      .bind(storedJson, saved.id)
      .run();
    await h.restart();
    const response = await h.send('/users/me');
    assert.equal(response.status, 200);
    // This schema has no default: the server must actually emit the new field.
    const actual = z
      .object({
        user: z.object({
          version: z.number(),
          settings: z.object({
            preferences: z.object({
              climbing: z.object({ preference: z.literal('neutral') }),
            }),
          }),
        }),
      })
      .parse(await response.json());
    assert.equal(actual.user.version, 1);
    const afterRead = await (await h.runtime.getD1Database('ROUTES_DB'))
      .prepare('SELECT user_json FROM users WHERE id = ?')
      .bind(saved.id)
      .first<{ user_json: string }>();
    assert.equal(afterRead?.user_json, storedJson);
    const updated = await h.send('/users/me', {
      method: 'PATCH',
      body: JSON.stringify({
        expectedVersion: 1,
        displayName: 'Updated cyclist',
      }),
    });
    assert.equal(updated.status, 200);
    assert.equal(
      (await readUser(updated)).settings.preferences.climbing.preference,
      'neutral',
    );
  },
);

integration(
  'partial GPX elevation stays unranked while available weather can be assessed and never becomes zero ascent',
  async (h) => {
    h.use(metOffice());
    const missing = await upload(h, null, 0);
    const unknown = await recommend(h, [missing.id], override('flatter'));
    assert.equal(unknown.recommendedRouteId, null);
    assert.equal(first(unknown.unranked).status, 'unassessable');
    assert.ok(first(unknown.unranked).issues.includes('missing-elevation'));
    assert.ok(h.requests.length > 0);
    const flat = await upload(h, 0);
    const mixed = await recommend(
      h,
      [missing.id, flat.id],
      override('hillier'),
    );
    assert.deepEqual(
      mixed.rankings.map((r) => r.routeId),
      [flat.id],
    );
    assert.ok(h.requests.length > 0);
    assert.ok(
      h.requests.every((r) =>
        ['-1', '0'].includes(
          new URL(r.url).searchParams.get('longitude') ?? '',
        ),
      ),
    );
    const neutral = await recommend(h, [missing.id, flat.id]);
    assert.equal(neutral.rankings.length, 2);
    assert.equal(
      neutral.rankings.find((r) => r.routeId === missing.id)?.ascentM,
      null,
    );
  },
);

integration(
  'a preferred terrain cannot override minimum conditions even when its combined score is higher',
  async (h) => {
    h.use(
      metOffice(({ request }) =>
        HttpResponse.json(
          hourlyForecast(request, {
            values: () => ({
              probOfPrecipitation:
                new URL(request.url).searchParams.get('longitude') === '-1'
                  ? 2
                  : 0,
            }),
          }),
        ),
      ),
    );
    const flat = await upload(h, 0);
    const hilly = await upload(h, 1200, 0);
    const ids = [flat.id, hilly.id];
    assert.equal(
      (await recommend(h, ids, override('flatter'))).recommendedRouteId,
      flat.id,
    );
    const calls = h.requests.length;
    const result = await recommend(h, ids, {
      preferences: {
        climbing: { preference: 'flatter' },
        minimumStandards: { maximumPrecipitationProbability: 0.01 },
      },
    });
    assert.equal(result.recommendedRouteId, hilly.id);
    assert.equal(result.minimumStandardsStatus, 'match_found');
    assert.ok(
      first(result.rankings).best.score < (result.rankings[1]?.best.score ?? 0),
    );
    assert.equal(h.requests.length, calls);
  },
);

integration(
  'invalid climbing preferences fail before storage changes or weather calls',
  async (h) => {
    const route = await upload(h, 100);
    const saved = await createUser(h, 'hillier');
    for (const climbing of [
      null,
      [],
      'flatter',
      { preference: 'flat' },
      { preference: null },
      { maximumAscentM: 800 },
    ]) {
      const recommendation = await h.send('/recommendations', {
        body: JSON.stringify({
          routeIds: [route.id],
          date: RIDE_DATE,
          preferences: { climbing },
        }),
      });
      assert.equal(recommendation.status, 400);
      const update = await h.send('/users/me', {
        method: 'PATCH',
        body: JSON.stringify({
          expectedVersion: 1,
          settings: { preferences: { climbing } },
        }),
      });
      assert.equal(update.status, 400);
    }
    assert.deepEqual(await readUser(await h.send('/users/me')), saved);
    assert.equal(h.requests.length, 0);
  },
);
