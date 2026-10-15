import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HttpResponse } from 'msw/http';
import { z } from 'zod';
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
const readUser = async (response: { json: () => Promise<unknown> }) =>
  z.object({ user: userSchema.strip() }).parse(await response.json()).user;
const choice = { coldSensitivity: 'high', seasonalTolerance: 'cooler-winters' };

integration(
  'seasonal intent persists through restart and partial edits; overrides reuse weather without changing saved intent',
  async (h) => {
    h.use(
      metOffice(({ request }) =>
        HttpResponse.json(
          hourlyForecast(request, { values: () => ({ screenTemperature: 9 }) }),
        ),
      ),
    );
    const route = await upload(h);
    const user = await readUser(
      await h.send('/users', {
        body: JSON.stringify({ displayName: 'Rider' }),
      }),
    );
    assert.equal(
      user.settings.preferences.temperature.seasonalTolerance,
      'none',
    );
    const before = await recommendMetOffice(h, [route.id]);
    const calls = h.requests.length;
    const response = await h.send('/users/me', {
      method: 'PATCH',
      body: JSON.stringify({
        expectedVersion: user.version,
        settings: { preferences: { temperature: choice } },
      }),
    });
    assert.equal(response.status, 200);
    const saved = await readUser(response);
    await h.restart();
    assert.deepEqual(await readUser(await h.send('/users/me')), saved);
    const after = await recommendMetOffice(h, [route.id]);
    assert.equal(
      after.resolvedPreferences.temperature.seasonalTolerance,
      'cooler-winters',
    );
    assert.ok(
      first(after.rankings).best.score < first(before.rankings).best.score,
    );
    assert.deepEqual(
      first(after.rankings).best.conditions,
      first(before.rankings).best.conditions,
    );
    const unrelated = await readUser(
      await h.send('/users/me', {
        method: 'PATCH',
        body: JSON.stringify({
          expectedVersion: saved.version,
          settings: { preferences: { temperature: { comfortMaxC: 32 } } },
        }),
      }),
    );
    assert.equal(
      unrelated.settings.preferences.temperature.coldSensitivity,
      'high',
    );
    assert.equal(
      unrelated.settings.preferences.temperature.seasonalTolerance,
      'cooler-winters',
    );
    const temporary = await recommendMetOffice(h, [route.id], {
      preferences: {
        temperature: { coldSensitivity: 'standard', seasonalTolerance: 'none' },
      },
    });
    assert.equal(
      first(temporary.rankings).best.score,
      first(before.rankings).best.score,
    );
    assert.deepEqual(await readUser(await h.send('/users/me')), unrelated);
    assert.equal(h.requests.length, calls);
    assert.equal(
      (
        await h.send('/users/me', {
          method: 'PATCH',
          body: JSON.stringify({
            expectedVersion: saved.version,
            settings: {
              preferences: { temperature: { seasonalTolerance: 'none' } },
            },
          }),
        })
      ).status,
      409,
    );
    const bob = await readUser(
      await h.send('/users', {
        token: BOB_TOKEN,
        body: JSON.stringify({ displayName: 'Other rider' }),
      }),
    );
    assert.equal(
      bob.settings.preferences.temperature.coldSensitivity,
      'standard',
    );
    assert.equal(
      bob.settings.preferences.temperature.seasonalTolerance,
      'none',
    );
    const detail = await h.send('/recommendations', {
      body: JSON.stringify({
        routeIds: [route.id],
        date: RIDE_DATE,
        weather: { mode: 'strict', providerId: 'met-office' },
        forecast: {
          representation: 'deterministic',
          freshnessBasis: 'retrieval-time',
        },
      }),
    });
    const parsed = z
      .object({
        rankings: z.array(
          z.object({
            best: z.object({
              temperatureAssessment: z.object({
                seasonal: z.object({
                  status: z.literal('complete'),
                  source: z.object({ referencePeriod: z.literal('1991–2020') }),
                }),
              }),
            }),
          }),
        ),
      })
      .parse(await detail.json());
    assert.equal(parsed.rankings.length, 1);
  },
);

integration(
  'legacy stored profiles remain untouched and new temperature fields reject invalid values atomically',
  async (h) => {
    const user = await readUser(
      await h.send('/users', {
        body: JSON.stringify({ displayName: 'Legacy rider' }),
      }),
    );
    const {
      coldSensitivity: _cold,
      seasonalTolerance: _season,
      ...temperature
    } = user.settings.preferences.temperature;
    const legacy = {
      ...user,
      settings: {
        ...user.settings,
        preferences: { ...user.settings.preferences, temperature },
      },
    };
    const db = await h.runtime.getD1Database('ROUTES_DB');
    await db
      .prepare('UPDATE users SET user_json = ? WHERE id = ?')
      .bind(JSON.stringify(legacy), user.id)
      .run();
    const read = await readUser(await h.send('/users/me'));
    assert.deepEqual(read, user);
    assert.equal(
      (
        await db
          .prepare('SELECT user_json FROM users WHERE id = ?')
          .bind(user.id)
          .first<{ user_json: string }>()
      )?.user_json,
      JSON.stringify(legacy),
    );
    for (const temperature of [
      { seasonalTolerance: true },
      { coldSensitivity: null },
      { seasonalTolerance: 'auto' },
      { coldSensitivity: 'HIGH' },
      { coldSensitivity: 'high', adjustSafetyMinimum: true },
    ]) {
      const settings = { preferences: { temperature } };
      assert.equal(
        (
          await h.send('/users/me', {
            method: 'PATCH',
            body: JSON.stringify({ expectedVersion: user.version, settings }),
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await h.send('/users', {
            token: BOB_TOKEN,
            body: JSON.stringify({ displayName: 'Invalid', settings }),
          })
        ).status,
        400,
      );
      for (const endpoint of [
        '/recommendations',
        '/recommendations/next-windows',
      ]) {
        assert.equal(
          (
            await h.send(endpoint, {
              body: JSON.stringify({
                routeIds: ['00000000-0000-4000-8000-000000000001'],
                ...(endpoint.endsWith('next-windows')
                  ? { after: { date: RIDE_DATE, window: 'daylight' } }
                  : { date: RIDE_DATE }),
                ...settings,
              }),
            })
          ).status,
          400,
        );
      }
    }
    assert.deepEqual(await readUser(await h.send('/users/me')), user);
    assert.equal(h.requests.length, 0);
  },
);
