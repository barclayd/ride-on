import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HttpResponse } from 'msw/http';
import { z } from 'zod';
import { userSchema } from '../src/users/model.ts';
import { first, recommendMetOffice as recommend } from './client.ts';
import { hourlyForecast, metOffice } from './fixtures.ts';
import {
  ALICE_TOKEN,
  BOB_TOKEN,
  createHarness,
  type Harness,
  RIDE_DATE,
} from './harness.ts';

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

const upload = async (
  h: Harness,
  segments: number,
  ascentM = 0,
  longitude = -1,
) => {
  const points = Array.from(
    { length: segments + 1 },
    (_, i) =>
      `<trkpt lat="${51.2 + i * 0.03}" lon="${longitude}"><ele>${50 + (ascentM * i) / segments}</ele></trkpt>`,
  ).join('');
  const response = await h.send('/routes', {
    contentType: 'application/gpx+xml',
    body: `<gpx version="1.1"><trk><name>Synthetic distance</name><trkseg>${points}</trkseg></trk></gpx>`,
  });
  assert.equal(response.status, 201);
  return z
    .object({ route: z.object({ id: z.uuid(), distanceM: z.number() }) })
    .parse(await response.json()).route;
};
const readUser = async (response: { json: () => Promise<unknown> }) =>
  z.object({ user: userSchema.strip() }).parse(await response.json()).user;
const createUser = async (
  h: Harness,
  preferences: Record<string, unknown> = {},
  token = ALICE_TOKEN,
) => {
  const response = await h.send('/users', {
    token,
    body: JSON.stringify({ displayName: 'Cyclist', settings: { preferences } }),
  });
  assert.equal(response.status, 201);
  return readUser(response);
};
const patch = (
  h: Harness,
  expectedVersion: number,
  preferences: Record<string, unknown>,
) =>
  h.send('/users/me', {
    method: 'PATCH',
    body: JSON.stringify({ expectedVersion, settings: { preferences } }),
  });

integration(
  'preferred distance is owner-bound, persists across restart and can be overridden without saving or refetching forecasts',
  async (h) => {
    h.use(metOffice());
    const short = await upload(h, 6);
    const medium = await upload(h, 12);
    const long = await upload(h, 18);
    const ids = [long.id, short.id, medium.id];
    const saved = await createUser(h, {
      distance: { minKm: 30, maxKm: 50 },
      climbing: { preference: 'flatter' },
    });
    await createUser(h, { distance: { minKm: 10, maxKm: 25 } }, BOB_TOKEN);
    await h.restart();
    const result = await recommend(h, ids);
    assert.equal(result.recommendedRouteId, medium.id);
    assert.equal(result.rankings.length, 3);
    assert.equal(first(result.rankings).best.factors.distance, 100);
    assert.equal(first(result.rankings).distanceFit?.status, 'within_range');
    assert.equal(
      result.rankings.find((r) => r.routeId === short.id)?.distanceFit?.status,
      'below_range',
    );
    assert.equal(
      result.rankings.find((r) => r.routeId === long.id)?.distanceFit?.status,
      'above_range',
    );
    assert.ok(
      (result.rankings.find((r) => r.routeId === long.id)?.distanceFit
        ?.deviationKm ?? 0) > 10,
    );
    const calls = h.requests.length;
    assert.ok(calls > 0);
    const temporary = await recommend(h, ids, {
      preferences: { distance: { minKm: 55, maxKm: 75 } },
    });
    assert.equal(temporary.recommendedRouteId, long.id);
    assert.equal(temporary.resolvedPreferences.climbing.preference, 'flatter');
    assert.equal(h.requests.length, calls);
    assert.equal(temporary.weather.cache.misses, 0);
    assert.deepEqual(await readUser(await h.send('/users/me')), saved);
    assert.deepEqual(
      (await readUser(await h.send('/users/me', { token: BOB_TOKEN }))).settings
        .preferences.distance,
      { minKm: 10, maxKm: 25 },
    );
    const changed = await patch(h, 1, { distance: { minKm: 10, maxKm: 25 } });
    assert.equal(changed.status, 200);
    await h.restart();
    assert.equal((await recommend(h, ids)).recommendedRouteId, short.id);
    assert.equal(h.requests.length, calls);
  },
);

integration(
  'null clears the range temporarily or durably; omission preserves it through unrelated updates',
  async (h) => {
    h.use(metOffice());
    const route = await upload(h, 12);
    const saved = await createUser(h, {
      distance: { minKm: 10, maxKm: 25 },
      climbing: { preference: 'hillier' },
    });
    await recommend(h, [route.id]);
    const calls = h.requests.length;
    const clearedRequest = await recommend(h, [route.id], {
      preferences: { distance: null },
    });
    assert.equal(clearedRequest.resolvedPreferences.distance, null);
    assert.equal(first(clearedRequest.rankings).best.factors.distance, null);
    assert.equal(first(clearedRequest.rankings).distanceFit, null);
    assert.equal(
      clearedRequest.resolvedPreferences.climbing.preference,
      'hillier',
    );
    assert.deepEqual(await readUser(await h.send('/users/me')), saved);
    const unrelated = await patch(h, 1, { temperature: { comfortMinC: 15 } });
    assert.equal(unrelated.status, 200);
    assert.deepEqual(
      (await readUser(unrelated)).settings.preferences.distance,
      { minKm: 10, maxKm: 25 },
    );
    const cleared = await patch(h, 2, { distance: null });
    assert.equal(cleared.status, 200);
    await h.restart();
    assert.equal(
      (await readUser(await h.send('/users/me'))).settings.preferences.distance,
      null,
    );
    const final = await recommend(h, [route.id]);
    assert.equal(first(final.rankings).best.factors.distance, null);
    assert.equal(final.resolvedPreferences.climbing.preference, 'hillier');
    assert.equal(h.requests.length, calls);
  },
);

integration(
  'older profiles emit no distance preference without rewriting stored settings or changing their version',
  async (h) => {
    const saved = await createUser(h, { climbing: { preference: 'hillier' } });
    const legacy = {
      ...saved,
      settings: {
        ...saved.settings,
        preferences: Object.fromEntries(
          Object.entries(saved.settings.preferences).filter(
            ([key]) => key !== 'distance',
          ),
        ),
      },
    };
    const storedJson = JSON.stringify(legacy);
    const db = await h.runtime.getD1Database('ROUTES_DB');
    await db
      .prepare('UPDATE users SET user_json = ? WHERE id = ?')
      .bind(storedJson, saved.id)
      .run();
    await h.restart();
    const response = await h.send('/users/me');
    assert.equal(response.status, 200);
    // No schema default: this checks the actual JSON emitted by the Worker.
    const actual = z
      .object({
        user: z.object({
          version: z.number(),
          settings: z.object({
            preferences: z.object({
              distance: z.null(),
              climbing: z.object({ preference: z.literal('hillier') }),
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
  },
);

integration(
  'short and flatter preferences select a recovery ride, but substantially better weather can still win outside the range',
  async (h) => {
    h.use(metOffice());
    const shortFlat = await upload(h, 6, 0);
    const longHilly = await upload(h, 18, 1200, 0);
    const ids = [longHilly.id, shortFlat.id];
    const recovery = {
      distance: { minKm: 10, maxKm: 30 },
      climbing: { preference: 'flatter' },
    };
    assert.equal(
      (await recommend(h, ids, { preferences: recovery })).recommendedRouteId,
      shortFlat.id,
    );
    const calls = h.requests.length;
    assert.equal(
      (
        await recommend(h, ids, {
          preferences: {
            distance: { minKm: 55, maxKm: 75 },
            climbing: { preference: 'hillier' },
          },
        })
      ).recommendedRouteId,
      longHilly.id,
    );
    assert.equal(h.requests.length, calls);

    // A separate synthetic route area provides new evidence without modifying cached forecasts.
    const wetShort = await upload(h, 6, 0, 1);
    const dryLong = await upload(h, 18, 1200, 2);
    h.use(
      metOffice(({ request }) =>
        HttpResponse.json(
          hourlyForecast(request, {
            values: () => ({
              probOfPrecipitation:
                new URL(request.url).searchParams.get('longitude') === '1'
                  ? 80
                  : 0,
            }),
          }),
        ),
      ),
    );
    const result = await recommend(h, [wetShort.id, dryLong.id], {
      preferences: recovery,
    });
    assert.equal(result.recommendedRouteId, dryLong.id);
    assert.equal(first(result.rankings).distanceFit?.status, 'above_range');
    assert.ok(
      first(result.rankings).best.drawbacks.some((d) =>
        d.includes('longer than your preferred distance range'),
      ),
    );
  },
);

integration(
  'a distance match never overrides weather minimums and an out-of-range ride remains a usable alternative',
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
    const short = await upload(h, 6, 0, -1);
    const long = await upload(h, 18, 0, 0);
    const ids = [short.id, long.id];
    const distance = { minKm: 10, maxKm: 30 };
    assert.equal(
      (await recommend(h, ids, { preferences: { distance } }))
        .recommendedRouteId,
      short.id,
    );
    const result = await recommend(h, ids, {
      preferences: {
        distance,
        minimumStandards: { maximumPrecipitationProbability: 0.01 },
      },
    });
    assert.equal(result.recommendedRouteId, long.id);
    assert.equal(result.minimumStandardsStatus, 'match_found');
    assert.equal(result.rankings.length, 2);
    assert.ok(
      first(result.rankings).best.score < (result.rankings[1]?.best.score ?? 0),
    );
  },
);

integration(
  'malformed, partial and reversed ranges fail before writes or weather access',
  async (h) => {
    const route = await upload(h, 6);
    const saved = await createUser(h, { distance: { minKm: 10, maxKm: 30 } });
    for (const distance of [
      {},
      [],
      false,
      '10-30',
      { minKm: 20 },
      { maxKm: 40 },
      { minKm: 40, maxKm: 20 },
      { minKm: -1, maxKm: 20 },
      { minKm: 0, maxKm: 0 },
      { minKm: 20, maxKm: 401 },
      { minKm: '10', maxKm: 30 },
      { minKm: 10, maxKm: 30, excludeOutside: true },
    ]) {
      const response = await h.send('/recommendations', {
        body: JSON.stringify({
          routeIds: [route.id],
          date: RIDE_DATE,
          preferences: { distance },
        }),
      });
      assert.equal(response.status, 400);
      assert.equal((await patch(h, 1, { distance })).status, 400);
    }
    assert.deepEqual(await readUser(await h.send('/users/me')), saved);
    assert.equal(h.requests.length, 0);
  },
);
