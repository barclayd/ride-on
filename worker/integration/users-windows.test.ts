import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HttpResponse } from 'msw/http';
import { z } from 'zod';
import profile from '../../evaluation/sunshine-profile-v4.json' with {
  type: 'json',
};
import { userSchema } from '../src/users/model.ts';
import { first, recommend, recommendMetOffice, upload } from './client.ts';
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
const readUser = async (response: { json: () => Promise<unknown> }) =>
  z.object({ user: userSchema.strip() }).parse(await response.json()).user;
const createUser = async (
  h: Harness,
  settings: Record<string, unknown> = {},
  token = ALICE_TOKEN,
) => {
  const response = await h.send('/users', {
    token,
    body: JSON.stringify({ displayName: 'Cyclist', settings }),
  });
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('Location'), '/users/me');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  return readUser(response);
};
const patch = (h: Harness, body: unknown) =>
  h.send('/users/me', { method: 'PATCH', body: JSON.stringify(body) });

integration(
  'display units persist across devices without converting weather, changing scores or refetching',
  async (h) => {
    h.use(metOffice());
    const route = await upload(h);
    const created = await createUser(h, { display: { unit: 'mi' } });
    assert.equal(created.settings.units, undefined);
    const before = await recommendMetOffice(h, [route.id]);
    const calls = h.requests.length;
    const response = await patch(h, {
      expectedVersion: 1,
      settings: { units: { temperature: 'F', windSpeed: 'mph' } },
    });
    assert.equal(response.status, 200);
    assert.deepEqual((await readUser(response)).settings.units, {
      temperature: 'F',
      windSpeed: 'mph',
    });
    await h.restart();
    assert.deepEqual(
      (await readUser(await h.send('/users/me'))).settings.units,
      { temperature: 'F', windSpeed: 'mph' },
    );
    const after = await recommendMetOffice(h, [route.id]);
    assert.deepEqual(after.rankings, before.rankings);
    assert.equal(
      first(after.rankings).best.conditions.temperatureC.minimum,
      18,
    );
    assert.equal(h.requests.length, calls);
    assert.equal(
      (
        await patch(h, {
          expectedVersion: 1,
          settings: { units: { temperature: 'C', windSpeed: 'kmh' } },
        })
      ).status,
      409,
    );
    for (const units of [
      { temperature: 'C' },
      { temperature: 'K', windSpeed: 'kmh' },
      { temperature: 'F', windSpeed: 'knots' },
      { temperature: 'F', windSpeed: 'mph', distance: 'mi' },
      null,
    ])
      assert.equal(
        (await patch(h, { expectedVersion: 2, settings: { units } })).status,
        400,
      );
    const updated = await readUser(
      await patch(h, {
        expectedVersion: 2,
        settings: { units: { temperature: 'C', windSpeed: 'mph' } },
      }),
    );
    assert.deepEqual(updated.settings.units, {
      temperature: 'C',
      windSpeed: 'mph',
    });
    const unrelated = await readUser(
      await patch(h, { expectedVersion: 3, displayName: 'Another device' }),
    );
    assert.deepEqual(unrelated.settings.units, updated.settings.units);
    assert.equal(unrelated.settings.display.unit, 'mi');
    const bob = await createUser(
      h,
      { units: { temperature: 'F', windSpeed: 'kmh' } },
      BOB_TOKEN,
    );
    assert.deepEqual(bob.settings.units, {
      temperature: 'F',
      windSpeed: 'kmh',
    });
  },
);

integration(
  'users are owner-bound, durable, private and created once without changing existing route ownership',
  async (h) => {
    const route = await upload(h);
    assert.equal((await h.send('/users/me')).status, 404);
    const alice = await createUser(h, {
      preferences: profile.request.preferences,
    });
    const bob = await createUser(h, {}, BOB_TOKEN);
    assert.equal(alice.id, 'alice');
    assert.equal(bob.id, 'bob');
    assert.equal(alice.settings.preferences.wind.crosswindSensitivity, 5);
    assert.equal(bob.settings.preferences.wind.crosswindSensitivity, 1);
    assert.equal(
      (
        await h.send('/users', {
          body: JSON.stringify({ displayName: 'Overwrite' }),
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await h.send('/users', {
          body: JSON.stringify({ id: 'bob', displayName: 'Impersonate' }),
        })
      ).status,
      400,
    );
    assert.equal((await h.send('/users/bob')).status, 404);
    assert.equal(
      (
        await h.send('/users/me', {
          method: 'PATCH',
          body: JSON.stringify({
            expectedVersion: 1,
            id: 'bob',
            displayName: 'Impersonate',
          }),
        })
      ).status,
      400,
    );
    for (const [path, method] of [
      ['/users', 'POST'],
      ['/users/me', 'GET'],
      ['/users/me', 'PATCH'],
    ] as const) {
      for (const token of [null, 'wrong-token'])
        assert.equal((await h.send(path, { method, token })).status, 401);
    }
    await h.restart();
    assert.deepEqual(await readUser(await h.send('/users/me')), alice);
    assert.deepEqual(
      await readUser(await h.send('/users/me', { token: BOB_TOKEN })),
      bob,
    );
    const routes = z
      .object({ routes: z.array(z.object({ id: z.string() })) })
      .parse(await (await h.send('/routes')).json());
    assert.equal(first(routes.routes).id, route.id);
    const forbidden = await h.send('/recommendations', {
      token: BOB_TOKEN,
      body: JSON.stringify({ routeIds: [route.id], date: RIDE_DATE }),
    });
    assert.equal(forbidden.status, 404);
    assert.equal(h.requests.length, 0);
  },
);

integration(
  'saved preferences control ranking after restart; request overrides preserve nested values and never save themselves',
  async (h) => {
    h.use(
      metOffice(({ request }) =>
        HttpResponse.json(
          hourlyForecast(request, {
            values: () => ({
              screenTemperature:
                new URL(request.url).searchParams.get('longitude') === '-1'
                  ? 14
                  : 17,
              significantWeatherCode:
                new URL(request.url).searchParams.get('longitude') === '-1'
                  ? 1
                  : 8,
            }),
          }),
        ),
      ),
    );
    const sunny = await upload(h, 'Cool sunshine', -1);
    const cloudy = await upload(h, 'Warm cloud', 0);
    const saved = await createUser(h, {
      preferences: profile.request.preferences,
      riding: { averageSpeedKph: 15, departureStepMinutes: 15 },
      timeZone: 'UTC',
      forecast: { freshnessBasis: 'retrieval-time' },
      weather: {
        mode: 'ordered-fallback',
        providerIds: ['not-configured', 'met-office'],
      },
    });
    await h.restart();
    const window = { start: '09:00', end: '13:00' };
    const result = await recommend(h, [sunny.id, cloudy.id], {
      riding: { window },
    });
    assert.equal(result.recommendedRouteId, sunny.id);
    assert.deepEqual(result.savedUser, { id: 'alice', version: 1 });
    assert.deepEqual(result.resolvedPreferences, saved.settings.preferences);
    assert.equal(result.timeZone, 'UTC');
    assert.equal(result.riding.averageSpeedKph, 15);
    assert.equal(result.riding.departureStepMinutes, 15);
    assert.equal(result.weather.selectedSource?.providerId, 'met-office');
    assert.equal(result.weather.attempts.length, 2);
    assert.equal(
      first(result.rankings).best.departureAt,
      '2026-10-10T09:00:00.000Z',
    );
    const calls = h.requests.length;
    const temporary = await recommend(h, [sunny.id, cloudy.id], {
      riding: { window },
      preferences: { weights: { temperature: 1, sunshine: 0 } },
    });
    assert.equal(temporary.recommendedRouteId, cloudy.id);
    assert.equal(temporary.resolvedPreferences.weights.wind, 0.4);
    assert.equal(temporary.resolvedPreferences.wind.crosswindSensitivity, 5);
    assert.deepEqual(await readUser(await h.send('/users/me')), saved);
    const original = await recommend(h, [sunny.id, cloudy.id], {
      riding: { window },
    });
    assert.equal(original.recommendedRouteId, sunny.id);
    assert.equal(original.weather.cache.misses, 0);
    // The temporary request changed required descriptors; the original uses its original cached snapshot.
    assert.equal(h.requests.length, calls * 2);
    const updated = await patch(h, {
      expectedVersion: 1,
      settings: { preferences: { weights: { temperature: 1, sunshine: 0 } } },
    });
    assert.equal(updated.status, 200);
    await h.restart();
    const changed = await recommend(h, [sunny.id, cloudy.id], {
      riding: { window },
    });
    assert.equal(changed.recommendedRouteId, cloudy.id);
    assert.deepEqual(changed.savedUser, { id: 'alice', version: 2 });
    assert.equal(changed.riding.averageSpeedKph, 15);
    assert.equal(changed.weather.cache.misses, 0);
    assert.equal(h.requests.length, calls * 2);
  },
);

integration(
  'profile patches merge before validating, allow explicit limit removal, and keep unsuccessful writes out of D1',
  async (h) => {
    const saved = await createUser(h, {
      preferences: {
        temperature: { comfortMinC: 30, comfortMaxC: 35 },
        minimumStandards: {
          maximumGustKph: 30,
          minimumTemperature: { kind: 'monthly', valuesC: { '1': 0, '6': 16 } },
        },
      },
    });
    const response = await patch(h, {
      expectedVersion: 1,
      settings: { preferences: { temperature: { comfortMinC: 32 } } },
    });
    assert.equal(response.status, 200);
    const updated = await readUser(response);
    assert.deepEqual(updated.settings.preferences.temperature, {
      comfortMinC: 32,
      comfortMaxC: 35,
    });
    assert.equal(updated.createdAt, saved.createdAt);
    assert.equal(updated.version, 2);
    for (const settings of [
      { preferences: { temperature: { comfortMaxC: 31 } } },
      { preferences: { weights: { temperature: 0, wind: 0, dryness: 0 } } },
      { preferences: { wind: { madeUp: 2 } } },
      { riding: { window: { start: '09:00', end: '13:00' } } },
      { timeZone: '+01:00' },
    ])
      assert.equal(
        (await patch(h, { expectedVersion: 2, settings })).status,
        400,
      );
    assert.deepEqual(await readUser(await h.send('/users/me')), updated);
    const cleared = await patch(h, {
      expectedVersion: 2,
      displayName: 'Summer rider',
      settings: {
        preferences: {
          minimumStandards: {
            maximumGustKph: null,
            minimumTemperature: { kind: 'fixed', valueC: 16 },
          },
        },
      },
    });
    assert.equal(cleared.status, 200);
    const user = await readUser(cleared);
    assert.equal(user.displayName, 'Summer rider');
    assert.deepEqual(user.settings.preferences.minimumStandards, {
      minimumTemperature: { kind: 'fixed', valueC: 16 },
    });
    assert.equal(user.settings.preferences.temperature.comfortMaxC, 35);
    assert.equal(h.requests.length, 0);
  },
);

integration(
  'concurrent creates and updates cannot overwrite another successful write',
  async (h) => {
    const creates = await Promise.all(
      ['One', 'Two'].map((displayName) =>
        h.send('/users', { body: JSON.stringify({ displayName }) }),
      ),
    );
    assert.deepEqual(creates.map((r) => r.status).sort(), [201, 409]);
    const updates = await Promise.all(
      [8, 12].map((comfortableCrosswindKph) =>
        patch(h, {
          expectedVersion: 1,
          settings: { preferences: { wind: { comfortableCrosswindKph } } },
        }),
      ),
    );
    assert.deepEqual(updates.map((r) => r.status).sort(), [200, 409]);
    const winningResponse = updates.find((r) => r.status === 200);
    assert.ok(winningResponse);
    const winner = await readUser(winningResponse);
    assert.deepEqual(await readUser(await h.send('/users/me')), winner);
    assert.equal(winner.version, 2);
    assert.equal(
      (await patch(h, { expectedVersion: 1, displayName: 'Stale' })).status,
      409,
    );
    assert.equal((await patch(h, { displayName: 'No version' })).status, 400);
    assert.deepEqual(await readUser(await h.send('/users/me')), winner);
  },
);

integration(
  'request minimum overrides remain temporary and inherit other saved standards',
  async (h) => {
    h.use(
      metOffice(({ request }) => HttpResponse.json(hourlyForecast(request))),
    );
    const route = await upload(h);
    await createUser(h, {
      weather: { mode: 'strict', providerId: 'met-office' },
      forecast: {
        representation: 'deterministic',
        freshnessBasis: 'model-run',
      },
      preferences: {
        minimumStandards: {
          minimumTemperature: { kind: 'fixed', valueC: 25 },
          maximumGustKph: 30,
        },
      },
    });
    const result = await recommend(h, [route.id]);
    assert.equal(result.minimumStandardsStatus, 'none_meet');
    const relaxed = await recommend(h, [route.id], {
      preferences: { minimumStandards: { minimumTemperature: null } },
    });
    assert.equal(relaxed.minimumStandardsStatus, 'match_found');
    assert.deepEqual(relaxed.resolvedPreferences.minimumStandards, {
      maximumGustKph: 30,
    });
    assert.equal(
      (await recommend(h, [route.id])).minimumStandardsStatus,
      'none_meet',
    );
    assert.equal(relaxed.weather.cache.misses, 0);
  },
);

integration(
  '09:00–13:00 recommendations fit the whole ride and do not fetch weather for routes that cannot fit',
  async (h) => {
    h.use(
      metOffice(({ request }) => {
        assert.equal(new URL(request.url).searchParams.get('longitude'), '-1');
        return HttpResponse.json(
          hourlyForecast(request, {
            values: (hour) => ({ probOfPrecipitation: hour < 10 ? 80 : 0 }),
          }),
        );
      }),
    );
    const route = await upload(h, 'Fits', -1);
    // Extend the synthetic second route through its public GPX ingestion path.
    const longUpload = await h.send('/routes', {
      contentType: 'application/gpx+xml',
      body: `<gpx version="1.1"><trk><name>Long northbound ride</name><trkseg>${Array.from({ length: 51 }, (_, i) => `<trkpt lat="${51 + i * 0.02}" lon="1"/>`).join('')}</trkseg></trk></gpx>`,
    });
    assert.equal(longUpload.status, 201);
    const longId = z
      .object({ route: z.object({ id: z.string() }) })
      .parse(await longUpload.json()).route.id;
    const result = await recommendMetOffice(h, [route.id, longId], {
      riding: { window: { start: '09:00', end: '13:00' } },
    });
    assert.equal(result.recommendedRouteId, route.id);
    assert.equal(first(result.unranked).routeId, longId);
    assert.equal(first(result.unranked).status, 'no_feasible_departure');
    assert.match(
      first(result.unranked).issues.join(' '),
      /full estimated ride/,
    );
    assert.equal(result.savedUser, null);
    const ranked = first(result.rankings);
    assert.deepEqual(ranked.effectiveWindow, {
      start: '2026-10-10T08:00:00.000Z',
      end: '2026-10-10T12:00:00.000Z',
    });
    for (const ride of [ranked.best, ...ranked.alternatives]) {
      assert.ok(
        Date.parse(ride.departureAt) >= Date.parse('2026-10-10T08:00:00Z'),
      );
      assert.ok(
        Date.parse(ride.finishAt) <= Date.parse('2026-10-10T12:00:00Z'),
      );
    }
    assert.equal(ranked.best.departureAt, '2026-10-10T09:30:00.000Z');
    assert.ok(ranked.best.rideHours.length >= 2);
    const calls = h.requests.length;
    const empty = await recommend(h, [longId], {
      riding: { window: { start: '09:00', end: '13:00' } },
    });
    assert.equal(empty.recommendedRouteId, null);
    assert.equal(empty.weather.selectedSource, null);
    assert.equal(h.requests.length, calls);
  },
);

integration(
  'invalid windows fail before weather access; saved time zones govern DST validation',
  async (h) => {
    const route = await upload(h);
    await createUser(h, { timeZone: 'Europe/London' });
    for (const [date, start, end] of [
      [RIDE_DATE, '13:00', '09:00'],
      [RIDE_DATE, '09:00', '09:00'],
      [RIDE_DATE, '9:00', '13:00'],
      [RIDE_DATE, '09:00', '24:00'],
      ['2026-03-29', '01:30', '13:00'],
      ['2026-10-25', '01:30', '13:00'],
    ]) {
      const response = await h.send('/recommendations', {
        body: JSON.stringify({
          routeIds: [route.id],
          date,
          riding: { window: { start, end } },
        }),
      });
      assert.equal(response.status, 400);
    }
    const night = await recommend(h, [route.id], {
      riding: { window: { start: '00:00', end: '05:00' } },
    });
    assert.equal(night.recommendedRouteId, null);
    assert.equal(first(night.unranked).status, 'no_feasible_departure');
    const utc = await recommend(h, [route.id], {
      date: '2026-10-25',
      timeZone: 'UTC',
      riding: { window: { start: '01:30', end: '05:00' } },
    });
    assert.equal(utc.recommendedRouteId, null);
    assert.equal(utc.timeZone, 'UTC');
    assert.equal(h.requests.length, 0);
  },
);

integration(
  'tailwind opt-in persists, changes ranking, and reuses cached weather across restart and temporary overrides',
  async (h) => {
    h.use(
      metOffice(({ request }) => {
        const tailwind =
          new URL(request.url).searchParams.get('longitude') === '-1';
        return HttpResponse.json(
          hourlyForecast(request, {
            values: () => ({
              screenTemperature: tailwind ? 14 : 14.3,
              windSpeed10m: tailwind ? 4.5 : 1,
              max10mWindGust: tailwind ? 8 : 1,
              windDirectionFrom10m: 180,
            }),
          }),
        );
      }),
    );
    const tail = await upload(h, 'Helpful tailwind', -1);
    const calm = await upload(h, 'Slightly warmer calm', 0);
    const ids = [tail.id, calm.id];
    const created = await createUser(h);
    assert.equal(created.settings.preferences.wind.preferTailwind, false);
    const before = await recommendMetOffice(h, ids);
    assert.equal(before.recommendedRouteId, calm.id);
    const calls = h.requests.length;
    const off = first(
      before.rankings.filter((r) => r.routeId === tail.id),
    ).best;
    assert.deepEqual(off.windAssistance, {
      usefulDistanceFraction: 1,
      potentialPoints: 0,
      appliedPoints: 0,
    });
    const response = await patch(h, {
      expectedVersion: created.version,
      settings: { preferences: { wind: { preferTailwind: true } } },
    });
    assert.equal(response.status, 200);
    const saved = await readUser(response);
    assert.deepEqual(saved.settings.preferences.wind, {
      ...created.settings.preferences.wind,
      preferTailwind: true,
    });
    await h.restart();
    assert.deepEqual(await readUser(await h.send('/users/me')), saved);
    const after = await recommendMetOffice(h, ids);
    assert.equal(after.resolvedPreferences.wind.preferTailwind, true);
    assert.equal(after.recommendedRouteId, tail.id);
    const on = first(after.rankings).best;
    assert.equal(on.windAssistance.potentialPoints, 2);
    assert.equal(on.score - off.score, on.windAssistance.appliedPoints);
    assert.deepEqual(on.conditions, off.conditions);
    assert.deepEqual(on.factors, off.factors);
    assert.deepEqual(on.standards, off.standards);

    // An older client edits another wind setting without knowing this field.
    const unrelated = await readUser(
      await patch(h, {
        expectedVersion: saved.version,
        settings: { preferences: { wind: { comfortableHeadwindKph: 19 } } },
      }),
    );
    assert.equal(unrelated.settings.preferences.wind.preferTailwind, true);
    const temporary = await recommendMetOffice(h, ids, {
      preferences: { wind: { preferTailwind: false } },
    });
    assert.equal(temporary.recommendedRouteId, calm.id);
    assert.equal(temporary.resolvedPreferences.wind.preferTailwind, false);
    assert.equal(temporary.resolvedPreferences.wind.comfortableHeadwindKph, 19);
    assert.deepEqual(await readUser(await h.send('/users/me')), unrelated);
    const inherited = await recommendMetOffice(h, ids, {
      preferences: { wind: { comfortableCrosswindKph: 21 } },
    });
    assert.equal(inherited.resolvedPreferences.wind.preferTailwind, true);
    assert.equal(inherited.recommendedRouteId, tail.id);
    assert.equal(
      (
        await patch(h, {
          expectedVersion: saved.version,
          settings: { preferences: { wind: { preferTailwind: false } } },
        })
      ).status,
      409,
    );

    const disabled = await readUser(
      await patch(h, {
        expectedVersion: unrelated.version,
        settings: { preferences: { wind: { preferTailwind: false } } },
      }),
    );
    assert.equal(disabled.settings.preferences.wind.preferTailwind, false);
    assert.equal(
      (await recommendMetOffice(h, ids)).recommendedRouteId,
      calm.id,
    );
    assert.equal(h.requests.length, calls);
    const bob = await createUser(h, {}, BOB_TOKEN);
    assert.equal(bob.settings.preferences.wind.preferTailwind, false);
  },
);

integration(
  'legacy users default to no tailwind preference without rewriting stored settings or version',
  async (h) => {
    const saved = await createUser(h, {
      preferences: { wind: { preferTailwind: true } },
    });
    assert.equal(saved.settings.preferences.wind.preferTailwind, true);
    const { preferTailwind: _removed, ...oldWind } =
      saved.settings.preferences.wind;
    const legacy = {
      ...saved,
      settings: {
        ...saved.settings,
        preferences: { ...saved.settings.preferences, wind: oldWind },
      },
    };
    const db = await h.runtime.getD1Database('ROUTES_DB');
    await db
      .prepare('UPDATE users SET user_json = ? WHERE id = ?')
      .bind(JSON.stringify(legacy), saved.id)
      .run();
    await h.restart();
    const read = await readUser(await h.send('/users/me'));
    assert.equal(read.settings.preferences.wind.preferTailwind, false);
    assert.equal(read.version, saved.version);
    assert.equal(read.updatedAt, saved.updatedAt);
    const restartedDb = await h.runtime.getD1Database('ROUTES_DB');
    const stored = await restartedDb
      .prepare('SELECT user_json FROM users WHERE id = ?')
      .bind(saved.id)
      .first<{ user_json: string }>();
    assert.equal(stored?.user_json, JSON.stringify(legacy));
    const changed = await readUser(
      await patch(h, {
        expectedVersion: saved.version,
        settings: { preferences: { wind: { comfortableGustKph: 40 } } },
      }),
    );
    assert.equal(changed.settings.preferences.wind.preferTailwind, false);
    assert.equal(changed.settings.preferences.wind.comfortableGustKph, 40);
  },
);

integration(
  'tailwind preference accepts only booleans and invalid writes are atomic',
  async (h) => {
    const user = await createUser(h, {
      preferences: { wind: { preferTailwind: true } },
    });
    for (const preferTailwind of [null, 'true', 'false', 0, 1, {}, []]) {
      const preferences = { wind: { preferTailwind } };
      assert.equal(
        (
          await patch(h, {
            expectedVersion: user.version,
            settings: { preferences },
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await h.send('/recommendations', {
            body: JSON.stringify({
              routeIds: ['00000000-0000-4000-8000-000000000001'],
              date: RIDE_DATE,
              preferences,
            }),
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await h.send('/users', {
            token: BOB_TOKEN,
            body: JSON.stringify({
              displayName: 'Bob',
              settings: { preferences },
            }),
          })
        ).status,
        400,
      );
    }
    assert.deepEqual(await readUser(await h.send('/users/me')), user);
    assert.equal((await h.send('/users/me', { token: BOB_TOKEN })).status, 404);
    assert.equal(h.requests.length, 0);
  },
);
