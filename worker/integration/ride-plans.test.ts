import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HttpResponse } from 'msw/http';
import { z } from 'zod';
import { conditionsSchema } from '../src/recommendations/conditions.ts';
import { ridePlanSchema } from '../src/rides/plan.ts';
import { first, upload } from './client.ts';
import { hourlyForecast, metOffice } from './fixtures.ts';
import { BOB_TOKEN, createHarness, type Harness } from './harness.ts';

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
const rideSchema = z.object({
  id: z.uuid(),
  version: z.number(),
  plan: ridePlanSchema.nullable(),
  planSource: z.string().nullable(),
});
const readRide = async (r: { json(): Promise<unknown> }) =>
  z.object({ ride: rideSchema }).parse(await r.json()).ride;
const log = (
  h: Harness,
  routeId: string,
  plan?: unknown,
  key = crypto.randomUUID(),
) =>
  h.send('/rides', {
    headers: { 'Idempotency-Key': key },
    body: JSON.stringify({
      routeId,
      expectedRouteVersion: 1,
      riddenOn: '2026-10-10',
      timeZone: 'Europe/London',
      ...(plan === undefined ? {} : { plan }),
    }),
  });
const fixture = async (h: Harness) => {
  h.use(metOffice(({ request }) => HttpResponse.json(hourlyForecast(request))));
  const route = await upload(h);
  const response = await h.send('/recommendations', {
    body: JSON.stringify({
      routeIds: [route.id],
      date: '2026-10-10',
      weather: { mode: 'strict', providerId: 'met-office' },
      forecast: {
        representation: 'deterministic',
        freshnessBasis: 'model-run',
      },
    }),
  });
  assert.equal(response.status, 200);
  const rec = z
    .object({
      generatedAt: z.string(),
      algorithmVersion: z.string(),
      rankings: z.array(
        z.object({
          rank: z.number(),
          best: z.object({
            departureAt: z.string(),
            finishAt: z.string(),
            conditions: conditionsSchema,
          }),
        }),
      ),
      weather: z.object({
        attribution: ridePlanSchema.shape.weather.shape.attribution,
      }),
    })
    .parse(await response.json());
  // Weather has other recommendation metadata; the saved plan intentionally carries only attribution.
  const picked = first(rec.rankings);
  const plan = {
    ...picked.best,
    pickRank: picked.rank,
    generatedAt: rec.generatedAt,
    algorithmVersion: rec.algorithmVersion,
    weather: rec.weather,
  };
  await h.restart({ TEST_NOW: '2026-10-10T19:00:00Z' });
  return { route, plan };
};

integration(
  'planned recommendation persists through replay, restart, list and unchanged-date correction with its original provider credit',
  async (h) => {
    const { route, plan } = await fixture(h);
    assert.equal(plan.conditions.precipitationSummary, 'dry');
    assert.ok(plan.conditions.windDistanceFractions);
    const key = crypto.randomUUID();
    const created = await log(h, route.id, plan, key);
    assert.equal(created.status, 201, await created.clone().text());
    const ride = await readRide(created);
    assert.deepEqual(ride.plan, { schemaVersion: 1, ...plan });
    assert.equal(ride.planSource, 'client-supplied');
    await h.restart();
    const replay = await log(h, route.id, { ...plan, schemaVersion: 1 }, key);
    assert.equal(replay.status, 200);
    assert.deepEqual(await readRide(replay), ride);
    assert.deepEqual(await readRide(await h.send(`/rides/${ride.id}`)), ride);
    const list = z
      .object({ rides: z.array(rideSchema) })
      .parse(await (await h.send('/rides')).json());
    assert.deepEqual(first(list.rides), ride);
    const patch = await h.send(`/rides/${ride.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        expectedVersion: 1,
        riddenOn: '2026-10-10',
        timeZone: 'Europe/London',
      }),
    });
    assert.equal(patch.status, 200);
    assert.deepEqual((await readRide(patch)).plan, ride.plan);
    assert.equal(
      (await h.send(`/rides/${ride.id}`, { token: BOB_TOKEN })).status,
      404,
    );
  },
);

integration(
  'historical plans without condition chips still write, replay and read unchanged',
  async (h) => {
    const { route, plan } = await fixture(h);
    const {
      windDistanceFractions: _wind,
      precipitationSummary: _rain,
      ...conditions
    } = plan.conditions;
    const legacy = { ...plan, conditions };
    const key = crypto.randomUUID();
    const created = await log(h, route.id, legacy, key);
    assert.equal(created.status, 201);
    const ride = await readRide(created);
    assert.deepEqual(ride.plan?.conditions, conditions);
    await h.restart();
    const fetched = await readRide(await h.send(`/rides/${ride.id}`));
    assert.deepEqual(fetched.plan?.conditions, conditions);
    const replay = await log(h, route.id, legacy, key);
    assert.equal(replay.status, 200);
    assert.deepEqual((await readRide(replay)).plan?.conditions, conditions);
  },
);

integration(
  'plan is part of the canonical idempotency content, and no-plan legacy fingerprints survive the migration',
  async (h) => {
    const { route, plan } = await fixture(h);
    const key = crypto.randomUUID();
    assert.equal((await log(h, route.id, plan, key)).status, 201);
    assert.equal(
      (await log(h, route.id, { ...plan, pickRank: 2 }, key)).status,
      409,
    );
    assert.equal((await log(h, route.id, null, key)).status, 409);
    const legacyKey = crypto.randomUUID();
    const old = await readRide(await log(h, route.id, undefined, legacyKey));
    // Reproduce the v0.11 fingerprint with no newly introduced fields.
    const content = {
      routeId: route.id,
      expectedRouteVersion: 1,
      riddenOn: '2026-10-10',
      timeZone: 'Europe/London',
    };
    const digest = Buffer.from(
      await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(JSON.stringify(content)),
      ),
    ).toString('hex');
    const db = await h.runtime.getD1Database('ROUTES_DB');
    await db
      .prepare('UPDATE rides SET request_hash = ? WHERE id = ?')
      .bind(digest, old.id)
      .run();
    const replay = await log(h, route.id, null, legacyKey);
    assert.equal(replay.status, 200);
    assert.equal((await readRide(replay)).plan, null);
  },
);

integration(
  'date or time-zone correction clears the plan atomically, including idempotent replay of the original request',
  async (h) => {
    const { route, plan } = await fixture(h);
    for (const correction of [
      { riddenOn: '2026-10-09', timeZone: 'Europe/London' },
      { riddenOn: '2026-10-10', timeZone: 'America/New_York' },
    ]) {
      const key = crypto.randomUUID();
      const ride = await readRide(await log(h, route.id, plan, key));
      const r = await h.send(`/rides/${ride.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ expectedVersion: ride.version, ...correction }),
      });
      assert.equal(r.status, 200);
      assert.equal((await readRide(r)).plan, null);
      assert.equal(
        (await readRide(await log(h, route.id, plan, key))).plan,
        null,
      );
      const conflict = await h.send(`/rides/${ride.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          expectedVersion: ride.version,
          riddenOn: '2026-10-10',
          timeZone: 'Europe/London',
        }),
      });
      assert.equal(conflict.status, 409);
    }
  },
);

integration(
  'invalid plan dates, units, categories and metadata are rejected before a ride is stored',
  async (h) => {
    const { route, plan } = await fixture(h);
    for (const bad of [
      { ...plan, departureAt: plan.finishAt },
      { ...plan, departureAt: '2026-10-09T08:00:00Z' },
      { ...plan, generatedAt: plan.finishAt },
      { ...plan, departureAt: '2026-10-10T08:00:00' },
      { ...plan, schemaVersion: 2 },
      { ...plan, pickRank: 0 },
      { ...plan, actualDuration: 100 },
      { ...plan, weather: undefined },
      { ...plan, weather: { attribution: [] } },
      {
        ...plan,
        weather: {
          attribution: [{ text: 'Unsafe', url: 'javascript:alert(1)' }],
        },
      },
      {
        ...plan,
        conditions: { ...plan.conditions, maximumPrecipitationProbability: 25 },
      },
      {
        ...plan,
        conditions: {
          ...plan.conditions,
          temperatureC: { minimum: 20, maximum: 5 },
        },
      },
      { ...plan, conditions: { ...plan.conditions, providerPayload: {} } },
      {
        ...plan,
        conditions: {
          ...plan.conditions,
          skyConditionDistanceFractions: { sunny: 1 },
        },
      },
    ]) {
      const response = await log(h, route.id, bad);
      assert.equal(response.status, 400, await response.clone().text());
    }
    const list = z
      .object({ rides: z.array(z.unknown()) })
      .parse(await (await h.send('/rides')).json());
    assert.equal(list.rides.length, 0);
    const offset = {
      ...plan,
      departureAt: '2026-10-10T09:00:00+01:00',
      finishAt: '2026-10-10T11:00:00+01:00',
    };
    const accepted = await log(h, route.id, offset);
    assert.equal(accepted.status, 201);
    assert.equal(
      (await readRide(accepted)).plan?.departureAt,
      '2026-10-10T08:00:00.000Z',
    );
  },
);

integration(
  'route summaries include older history beyond the first page and update after deletion with owner isolation',
  async (h) => {
    const older = await upload(h, 'Older route');
    const recent = await upload(h, 'Frequent route', 0);
    const unridden = await upload(h, 'Never ridden', 1);
    await h.restart({ TEST_NOW: '2026-10-10T19:00:00Z' });
    const old = await readRide(
      await h.send('/rides', {
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({
          routeId: older.id,
          expectedRouteVersion: 1,
          riddenOn: '2026-09-01',
          timeZone: 'Europe/London',
        }),
      }),
    );
    // 101 events are intentional: a UI page cannot supply complete route badges.
    for (let i = 0; i < 101; i++)
      assert.equal((await log(h, recent.id)).status, 201);
    const page = z
      .object({ rides: z.array(rideSchema), nextCursor: z.string().nullable() })
      .parse(await (await h.send('/rides?limit=100')).json());
    assert.equal(page.rides.length, 100);
    assert.ok(page.nextCursor);
    assert.ok(!page.rides.some((r) => r.id === old.id));
    const body = JSON.stringify({
      routeIds: [older.id, recent.id, unridden.id],
    });
    const schema = z.object({
      historyRevision: z.number(),
      summaries: z.array(
        z.object({
          routeId: z.string(),
          rideCount: z.number(),
          lastRiddenOn: z.string().nullable(),
          lastRide: z
            .object({
              id: z.string(),
              timeZone: z.string(),
              routeVersion: z.number(),
            })
            .nullable(),
        }),
      ),
    });
    const summary = schema.parse(
      await (await h.send('/rides/summaries', { body })).json(),
    );
    assert.deepEqual(
      summary.summaries.map((r) => [r.routeId, r.rideCount, r.lastRiddenOn]),
      [
        [older.id, 1, '2026-09-01'],
        [recent.id, 101, '2026-10-10'],
        [unridden.id, 0, null],
      ],
    );
    assert.equal(summary.summaries[0]?.lastRide?.id, old.id);
    assert.equal(
      (await h.send('/rides/summaries', { body, token: BOB_TOKEN })).status,
      404,
    );
    assert.equal(
      (await h.send('/rides/summaries', { body, token: null })).status,
      401,
    );
    assert.equal(
      (
        await h.send('/rides/summaries', {
          body: JSON.stringify({ routeIds: [older.id, older.id] }),
        })
      ).status,
      400,
    );
    await h.send(`/rides/${old.id}`, { method: 'DELETE' });
    const changed = schema.parse(
      await (await h.send('/rides/summaries', { body })).json(),
    );
    assert.equal(changed.historyRevision, summary.historyRevision + 1);
    assert.equal(changed.summaries[0]?.rideCount, 0);
    assert.equal(changed.summaries[0]?.lastRide, null);
    assert.equal(h.requests.length, 0);
  },
);

integration(
  'concurrent logging with different plans has one winner; deleting that event cannot be undone by retrying its key',
  async (h) => {
    const { route, plan } = await fixture(h);
    const key = crypto.randomUUID();
    const responses = await Promise.all([
      log(h, route.id, plan, key),
      log(h, route.id, { ...plan, pickRank: 2 }, key),
    ]);
    assert.deepEqual(responses.map((r) => r.status).sort(), [201, 409]);
    const success = responses.find((r) => r.status === 201);
    assert.ok(success);
    const ride = await readRide(success);
    const list = z
      .object({ rides: z.array(rideSchema), historyRevision: z.number() })
      .parse(await (await h.send('/rides')).json());
    assert.equal(list.rides.length, 1);
    assert.equal(list.historyRevision, 1);
    await h.send(`/rides/${ride.id}`, { method: 'DELETE' });
    const replay = await log(h, route.id, ride.plan, key);
    assert.equal(replay.status, 409);
    assert.equal(
      z
        .object({ error: z.object({ code: z.string() }) })
        .parse(await replay.json()).error.code,
      'RIDE_UNDONE',
    );
  },
);

integration(
  'stored planned weather never replaces live forecast evidence or alters scores when repetition preference is neutral',
  async (h) => {
    const { route, plan } = await fixture(h);
    h.use(
      metOffice(({ request }) => {
        const data = hourlyForecast(request);
        for (const feature of data.features)
          for (const row of feature.properties.timeSeries)
            row.time = row.time.replace('2026-10-10', '2026-10-11');
        return HttpResponse.json(data);
      }),
    );
    const body = JSON.stringify({
      routeIds: [route.id],
      date: '2026-10-11',
      weather: { mode: 'strict', providerId: 'met-office' },
      forecast: {
        representation: 'deterministic',
        freshnessBasis: 'retrieval-time',
      },
    });
    const schema = z.object({
      rankings: z.array(
        z.object({
          routeId: z.string(),
          best: z.object({ score: z.number(), conditions: conditionsSchema }),
        }),
      ),
    });
    const before = await h.send('/recommendations', { body });
    assert.equal(before.status, 200);
    const original = schema.parse(await before.json());
    assert.equal(original.rankings.length, 1);
    const logged = await log(h, route.id, {
      ...plan,
      conditions: {
        ...plan.conditions,
        temperatureC: { minimum: -20, maximum: -10 },
        maximumPrecipitationProbability: 1,
      },
    });
    assert.equal(logged.status, 201);
    const after = await h.send('/recommendations', { body });
    assert.equal(after.status, 200);
    assert.deepEqual(schema.parse(await after.json()), original);
  },
);
