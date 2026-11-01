import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HttpResponse } from 'msw/http';
import { z } from 'zod';
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
const gpx = (longitude = -1, reversed = false) => {
  const points = Array.from(
    { length: 101 },
    (_, i) =>
      `<trkpt lat="${51.2 + i * 0.0002}" lon="${longitude}"><ele>10</ele></trkpt>`,
  );
  return `<gpx version="1.1"><trk><name>History test</name><trkseg>${(reversed ? points.reverse() : points).join('')}</trkseg></trk></gpx>`;
};
const routeSchema = z.object({
  route: z.object({ id: z.uuid(), version: z.number() }),
});
const rideSchema = z.object({
  ride: z.object({
    id: z.uuid(),
    version: z.number(),
    riddenOn: z.string(),
    timeZone: z.string(),
    route: z.object({
      id: z.uuid(),
      name: z.string(),
      version: z.number(),
      distanceM: z.number(),
    }),
    geometryStatus: z.string(),
    geometryBasis: z.string(),
  }),
});
const listSchema = z.object({
  rides: z.array(rideSchema.shape.ride),
  nextCursor: z.string().nullable(),
  historyRevision: z.number(),
  summary: z.object({
    rideCount: z.number(),
    lastRiddenOn: z.string().nullable(),
  }),
});
const recommendationSchema = z.object({
  history: z.object({
    status: z.string(),
    revision: z.number().nullable(),
    reasonCode: z.string().nullable(),
  }),
  rankings: z.array(
    z.object({
      routeId: z.string(),
      best: z.object({
        score: z.number(),
        baseScore: z.number(),
        weatherScore: z.number(),
        recentRides: z.object({
          status: z.string(),
          penaltyPoints: z.number(),
          overlapFraction: z.number().nullable(),
        }),
      }),
    }),
  ),
  weather: z.object({
    cache: z.object({ hits: z.number(), misses: z.number() }),
  }),
});
const upload = async (h: Harness, xml = gpx()) => {
  const response = await h.send('/routes', {
    body: xml,
    contentType: 'application/gpx+xml',
  });
  assert.equal(response.status, 201);
  return routeSchema.parse(await response.json()).route;
};
const log = (
  h: Harness,
  routeId: string,
  key = crypto.randomUUID(),
  extra: Record<string, unknown> = {},
) =>
  h.send('/rides', {
    headers: { 'Idempotency-Key': key },
    body: JSON.stringify({
      routeId,
      expectedRouteVersion: 1,
      riddenOn: '2026-10-09',
      timeZone: 'Europe/London',
      ...extra,
    }),
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
        freshnessBasis: 'model-run',
      },
      preferences: { recentRides: { mode: 'prefer-variety' } },
      ...overrides,
    }),
  });
  assert.equal(response.status, 200);
  return recommendationSchema.parse(await response.json());
};
const errorCode = async (response: { json: () => Promise<unknown> }) =>
  z
    .object({ error: z.object({ code: z.string() }) })
    .parse(await response.json()).error.code;

integration(
  'ride creation is persistent, owner-bound, idempotent under concurrent retries and makes no weather calls',
  async (h) => {
    const r = await upload(h);
    const key = crypto.randomUUID();
    const responses = await Promise.all(
      Array.from({ length: 4 }, () => log(h, r.id, key)),
    );
    assert.deepEqual(
      responses.map((r) => r.status).sort(),
      [200, 200, 200, 201],
    );
    const records = await Promise.all(
      responses.map(async (r) => rideSchema.parse(await r.json()).ride),
    );
    assert.equal(new Set(records.map((r) => r.id)).size, 1);
    const first = records[0];
    assert.ok(first);
    assert.equal(first.geometryBasis, 'assumed-saved-route');
    assert.equal(first.geometryStatus, 'available');
    assert.equal(
      (await log(h, r.id, key, { riddenOn: '2026-10-08' })).status,
      409,
    );
    await h.restart();
    const list = listSchema.parse(await (await h.send('/rides')).json());
    assert.equal(list.rides.length, 1);
    assert.equal(list.historyRevision, 1);
    assert.equal(
      (await h.send(`/rides/${first.id}`, { token: BOB_TOKEN })).status,
      404,
    );
    assert.equal(
      listSchema.parse(
        await (await h.send('/rides', { token: BOB_TOKEN })).json(),
      ).rides.length,
      0,
    );
    assert.equal(
      (
        await h.send('/rides', {
          token: BOB_TOKEN,
          headers: { 'Idempotency-Key': crypto.randomUUID() },
          body: JSON.stringify({
            routeId: r.id,
            expectedRouteVersion: 1,
            riddenOn: '2026-10-09',
            timeZone: 'Europe/London',
          }),
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await h.send(`/rides/${first.id}`, {
          token: BOB_TOKEN,
          method: 'DELETE',
        })
      ).status,
      204,
    );
    assert.equal((await h.send(`/rides/${first.id}`)).status, 200);
    assert.equal(h.requests.length, 0);
  },
);

integration(
  'correction has optimistic concurrency; undo invalidates history exactly once and blocks delayed create retries',
  async (h) => {
    const route = await upload(h);
    const key = crypto.randomUUID();
    const r = rideSchema.parse(await (await log(h, route.id, key)).json()).ride;
    const corrections = await Promise.all(
      ['2026-10-07', '2026-10-08'].map((riddenOn) =>
        h.send(`/rides/${r.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            expectedVersion: 1,
            riddenOn,
            timeZone: 'Europe/London',
          }),
        }),
      ),
    );
    assert.deepEqual(corrections.map((r) => r.status).sort(), [200, 409]);
    let list = listSchema.parse(await (await h.send('/rides')).json());
    assert.equal(list.historyRevision, 2);
    assert.equal(
      (await h.send(`/rides/${r.id}`, { method: 'DELETE' })).status,
      204,
    );
    assert.equal(
      (await h.send(`/rides/${r.id}`, { method: 'DELETE' })).status,
      204,
    );
    list = listSchema.parse(await (await h.send('/rides')).json());
    assert.equal(list.historyRevision, 3);
    assert.equal(list.summary.rideCount, 0);
    const replay = await log(h, route.id, key);
    assert.equal(replay.status, 409);
    assert.equal(await errorCode(replay), 'RIDE_UNDONE');
    assert.equal((await log(h, route.id)).status, 201);
    assert.equal((await h.send(`/rides/${r.id}`)).status, 404);
  },
);

integration(
  'pagination is stable and scoped, repeat rides are distinct, filters expose last ridden and count',
  async (h) => {
    const a = await upload(h);
    const b = await upload(h, gpx(-2));
    for (const [id, date] of [
      [a.id, '2026-10-09'],
      [a.id, '2026-10-08'],
      [b.id, '2026-10-08'],
      [a.id, '2026-10-07'],
    ]) {
      assert.ok(id);
      assert.equal(
        (await log(h, id, crypto.randomUUID(), { riddenOn: date })).status,
        201,
      );
    }
    const first = listSchema.parse(
      await (await h.send(`/rides?routeId=${a.id}&limit=1`)).json(),
    );
    assert.deepEqual(first.summary, {
      rideCount: 3,
      lastRiddenOn: '2026-10-09',
    });
    assert.ok(first.nextCursor);
    const second = listSchema.parse(
      await (
        await h.send(
          `/rides?routeId=${a.id}&limit=2&cursor=${encodeURIComponent(first.nextCursor)}`,
        )
      ).json(),
    );
    assert.deepEqual(
      second.rides.map((r) => r.riddenOn),
      ['2026-10-08', '2026-10-07'],
    );
    assert.equal(second.nextCursor, null);
    assert.equal(
      (
        await h.send(
          `/rides?routeId=${b.id}&cursor=${encodeURIComponent(first.nextCursor)}`,
        )
      ).status,
      400,
    );
  },
);

integration(
  'recorded route version stays immutable after source refresh and history affects overlapping new IDs',
  async (h) => {
    h.use(metOffice());
    const xml = gpx();
    const source = { providerId: 'cycle-travel', externalId: '1' };
    const initial = await h.send('/route-imports', {
      body: JSON.stringify({ source, gpx: xml }),
    });
    assert.equal(initial.status, 201);
    const r = routeSchema.parse(await initial.json()).route;
    const entry = rideSchema.parse(await (await log(h, r.id)).json()).ride;
    const reversed = await upload(h, gpx(-1, true));
    const refresh = await h.send('/route-imports', {
      body: JSON.stringify({ source, gpx: gpx(-2), expectedVersion: 1 }),
    });
    assert.equal(refresh.status, 200);
    assert.equal((await log(h, r.id)).status, 409);
    const old = rideSchema.parse(
      await (await h.send(`/rides/${entry.id}`)).json(),
    ).ride;
    assert.deepEqual(old.route, entry.route);
    const result = await recommend(h, [r.id, reversed.id]);
    assert.equal(result.rankings[0]?.routeId, r.id);
    assert.equal(result.rankings[0]?.best.recentRides.penaltyPoints, 0);
    const repeat = result.rankings.find((x) => x.routeId === reversed.id);
    assert.ok(repeat);
    assert.ok(repeat.best.recentRides.penaltyPoints > 9.6);
  },
);

integration(
  'saved preference, temporary neutral override and undo rerank immediately while forecasts remain cached',
  async (h) => {
    h.use(metOffice());
    const ridden = await upload(h);
    const fresh = await upload(h, gpx(-2));
    assert.equal(
      (
        await h.send('/users', {
          body: JSON.stringify({
            displayName: 'Rider',
            settings: {
              preferences: { recentRides: { mode: 'prefer-variety' } },
            },
          }),
        })
      ).status,
      201,
    );
    const before = await recommend(h, [ridden.id, fresh.id], {
      preferences: {},
    });
    assert.equal(before.history.status, 'no_recent_history');
    const calls = h.requests.length;
    const entry = rideSchema.parse(await (await log(h, ridden.id)).json()).ride;
    const after = await recommend(h, [ridden.id, fresh.id], {
      preferences: {},
    });
    assert.equal(after.rankings[0]?.routeId, fresh.id);
    assert.equal(after.history.revision, 1);
    const neutral = await recommend(h, [ridden.id, fresh.id], {
      preferences: { recentRides: { mode: 'neutral' } },
    });
    assert.equal(neutral.history.status, 'disabled');
    for (const result of neutral.rankings)
      assert.equal(result.best.score, result.best.baseScore);
    await h.send(`/rides/${entry.id}`, { method: 'DELETE' });
    const undone = await recommend(h, [ridden.id, fresh.id], {
      preferences: {},
    });
    assert.equal(undone.history.status, 'no_recent_history');
    assert.equal(undone.history.revision, 2);
    assert.deepEqual(
      undone.rankings.map((r) => [r.routeId, r.best.score]),
      before.rankings.map((r) => [r.routeId, r.best.score]),
    );
    assert.equal(h.requests.length, calls);
  },
);

integration(
  'legacy geometry has an explicit global fallback and exact-file enrichment repairs its frozen history',
  async (h) => {
    h.use(metOffice());
    const xml = gpx();
    const legacy = await upload(h, xml);
    const fresh = await upload(h, gpx(-2));
    const db = await h.runtime.getD1Database('ROUTES_DB');
    await db.batch([
      db
        .prepare(
          "DELETE FROM ride_geometries WHERE source_hash=(SELECT json_extract(route_json,'$.sourceHash') FROM routes WHERE id=?)",
        )
        .bind(legacy.id),
      db
        .prepare(
          "UPDATE routes SET route_json=json_remove(route_json,'$.geometry') WHERE id=?",
        )
        .bind(legacy.id),
    ]);
    const entry = rideSchema.parse(await (await log(h, legacy.id)).json()).ride;
    assert.equal(entry.geometryStatus, 'unavailable');
    const unavailable = await recommend(h, [legacy.id, fresh.id]);
    assert.equal(
      unavailable.history.reasonCode,
      'history_geometry_unavailable',
    );
    for (const r of unavailable.rankings)
      assert.equal(r.best.recentRides.overlapFraction, null);
    const wrong = await h.send(`/routes/${legacy.id}/geometry`, {
      method: 'PUT',
      body: JSON.stringify({ expectedVersion: 1, gpx: gpx(-3) }),
    });
    assert.equal(wrong.status, 409);
    const enrich = await h.send(`/routes/${legacy.id}/geometry`, {
      method: 'PUT',
      body: JSON.stringify({ expectedVersion: 1, gpx: xml }),
    });
    assert.equal(enrich.status, 200);
    assert.equal(routeSchema.parse(await enrich.json()).route.version, 2);
    const recorded = rideSchema.parse(
      await (await h.send(`/rides/${entry.id}`)).json(),
    ).ride;
    assert.equal(recorded.route.version, 1);
    assert.equal(recorded.geometryStatus, 'available');
    const repaired = await recommend(h, [legacy.id, fresh.id]);
    assert.equal(repaired.history.status, 'assessed');
    assert.equal(repaired.history.revision, 2);
    assert.equal(repaired.rankings[0]?.routeId, fresh.id);
  },
);

integration(
  'new history routes authenticate first and reject future dates, malformed time zones, missing keys and stale versions',
  async (h) => {
    const r = await upload(h);
    for (const path of ['/rides', `/rides/${crypto.randomUUID()}`])
      for (const method of ['GET', 'POST', 'PATCH', 'DELETE'])
        assert.equal((await h.send(path, { method, token: null })).status, 401);
    assert.equal(
      (await log(h, r.id, crypto.randomUUID(), { riddenOn: '2026-10-10' }))
        .status,
      400,
    );
    assert.equal(
      (await log(h, r.id, crypto.randomUUID(), { timeZone: 'not/a-zone' }))
        .status,
      400,
    );
    assert.equal(
      (await log(h, r.id, crypto.randomUUID(), { riddenOn: '2026-02-30' }))
        .status,
      400,
    );
    assert.equal(
      (await log(h, r.id, crypto.randomUUID(), { expectedRouteVersion: 2 }))
        .status,
      409,
    );
    assert.equal((await h.send('/rides', { body: '{}' })).status, 400);
    assert.equal(
      listSchema.parse(await (await h.send('/rides')).json()).historyRevision,
      0,
    );
    assert.equal(h.requests.length, 0);
  },
);

integration(
  'legacy source reimport enriches identical content only with an explicit current version',
  async (h) => {
    const source = { providerId: 'cycle-travel', externalId: '9' };
    const xml = gpx();
    const created = await h.send('/route-imports', {
      body: JSON.stringify({ source, gpx: xml }),
    });
    assert.equal(created.status, 201);
    const r = routeSchema.parse(await created.json()).route;
    const db = await h.runtime.getD1Database('ROUTES_DB');
    await db.batch([
      db
        .prepare(
          "DELETE FROM ride_geometries WHERE source_hash=(SELECT json_extract(route_json,'$.sourceHash') FROM routes WHERE id=?)",
        )
        .bind(r.id),
      db
        .prepare(
          "UPDATE routes SET route_json=json_remove(route_json,'$.geometry') WHERE id=?",
        )
        .bind(r.id),
    ]);
    const entry = rideSchema.parse(await (await log(h, r.id)).json()).ride;
    assert.equal(
      (
        await h.send('/route-imports', {
          body: JSON.stringify({ source, gpx: xml }),
        })
      ).status,
      409,
    );
    const enriched = await h.send('/route-imports', {
      body: JSON.stringify({ source, gpx: xml, expectedVersion: 1 }),
    });
    assert.equal(enriched.status, 200);
    assert.equal(routeSchema.parse(await enriched.json()).route.version, 2);
    assert.equal(
      rideSchema.parse(await (await h.send(`/rides/${entry.id}`)).json()).ride
        .geometryStatus,
      'available',
    );
  },
);

integration(
  'frozen legacy history can be enriched from its original GPX after the saved route was edited',
  async (h) => {
    const source = { providerId: 'cycle-travel', externalId: '10' };
    const xml = gpx();
    const r = routeSchema.parse(
      await (
        await h.send('/route-imports', {
          body: JSON.stringify({ source, gpx: xml }),
        })
      ).json(),
    ).route;
    const db = await h.runtime.getD1Database('ROUTES_DB');
    await db.batch([
      db
        .prepare(
          "DELETE FROM ride_geometries WHERE source_hash=(SELECT json_extract(route_json,'$.sourceHash') FROM routes WHERE id=?)",
        )
        .bind(r.id),
      db
        .prepare(
          "UPDATE routes SET route_json=json_remove(route_json,'$.geometry') WHERE id=?",
        )
        .bind(r.id),
    ]);
    const entry = rideSchema.parse(await (await log(h, r.id)).json()).ride;
    await h.send('/route-imports', {
      body: JSON.stringify({ source, gpx: gpx(-2), expectedVersion: 1 }),
    });
    const endpoint = `/rides/${entry.id}/geometry`;
    assert.equal(
      (
        await h.send(endpoint, {
          method: 'PUT',
          body: JSON.stringify({ expectedVersion: 1, gpx: gpx(-2) }),
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await h.send(endpoint, {
          method: 'PUT',
          token: BOB_TOKEN,
          body: JSON.stringify({ expectedVersion: 1, gpx: xml }),
        })
      ).status,
      404,
    );
    for (let i = 0; i < 2; i++) {
      const response = await h.send(endpoint, {
        method: 'PUT',
        body: JSON.stringify({ expectedVersion: 1, gpx: xml }),
      });
      assert.equal(response.status, 200);
      const ride = rideSchema.parse(await response.json()).ride;
      assert.equal(ride.geometryStatus, 'available');
      assert.deepEqual(ride.route, entry.route);
    }
    assert.equal(
      listSchema.parse(await (await h.send('/rides')).json()).historyRevision,
      2,
    );
  },
);

integration(
  'logging racing a route refresh records only the checked version or returns a conflict',
  async (h) => {
    const source = { providerId: 'cycle-travel', externalId: '11' };
    const r = routeSchema.parse(
      await (
        await h.send('/route-imports', {
          body: JSON.stringify({ source, gpx: gpx() }),
        })
      ).json(),
    ).route;
    const [recorded, updated] = await Promise.all([
      log(h, r.id),
      h.send('/route-imports', {
        body: JSON.stringify({ source, gpx: gpx(-2), expectedVersion: 1 }),
      }),
    ]);
    assert.equal(updated.status, 200);
    if (recorded.status === 201)
      assert.equal(
        rideSchema.parse(await recorded.json()).ride.route.version,
        1,
      );
    else {
      assert.equal(recorded.status, 409);
      assert.equal(await errorCode(recorded), 'ROUTE_VERSION_CONFLICT');
    }
  },
);

integration(
  'large histories fall back explicitly instead of reporting truncated history as complete',
  async (h) => {
    h.use(metOffice());
    const r = await upload(h);
    await log(h, r.id);
    const db = await h.runtime.getD1Database('ROUTES_DB');
    await db
      .prepare(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<1000)
    INSERT INTO rides (owner_id,id,idempotency_key,request_hash,route_id,source_hash,route_snapshot,ridden_on,time_zone,recorded_at,updated_at)
    SELECT r.owner_id, 'synthetic-'||n.i, 'key-'||n.i, r.request_hash,r.route_id,r.source_hash,r.route_snapshot,r.ridden_on,r.time_zone,r.recorded_at,r.updated_at
    FROM n CROSS JOIN (SELECT * FROM rides LIMIT 1) r`)
      .run();
    const result = await recommend(h, [r.id]);
    assert.equal(result.history.reasonCode, 'history_assessment_limit');
    assert.equal(result.rankings[0]?.best.recentRides.overlapFraction, null);
    assert.equal(
      result.rankings[0]?.best.score,
      result.rankings[0]?.best.baseScore,
    );
  },
);

integration(
  'history CORS supports idempotency and undo; infeasible requests do not claim a history failure',
  async (h) => {
    const response = await h.send('/rides', {
      method: 'OPTIONS',
      token: null,
      headers: { Origin: 'https://api.ride-on.test' },
    });
    assert.equal(response.status, 204);
    assert.match(
      response.headers.get('Access-Control-Allow-Headers') ?? '',
      /Idempotency-Key/,
    );
    assert.match(
      response.headers.get('Access-Control-Allow-Methods') ?? '',
      /DELETE/,
    );
    const r = await upload(h);
    const result = await recommend(h, [r.id], {
      riding: { window: { start: '09:00', end: '09:01' } },
    });
    assert.equal(result.history.status, 'not_evaluated');
    assert.equal(result.history.reasonCode, null);
    assert.equal(h.requests.length, 0);
  },
);

integration(
  'one multi-day request applies candidate-day decay consistently to best departures and alternatives',
  async (h) => {
    h.use(
      metOffice(({ request }) => {
        const body = hourlyForecast(request);
        for (const feature of body.features) {
          const hours = feature.properties.timeSeries;
          feature.properties.timeSeries = [
            ...hours,
            ...hours.map((row) => ({
              ...row,
              time: row.time.replace('2026-10-10', '2026-10-11'),
            })),
          ];
        }
        return HttpResponse.json(body);
      }),
    );
    const r = await upload(h);
    await log(h, r.id);
    const response = await h.send('/recommendations', {
      body: JSON.stringify({
        routeIds: [r.id],
        days: { kind: 'range', start: '2026-10-10', end: '2026-10-11' },
        riding: { window: { start: '10:00', end: '11:00' } },
        weather: { mode: 'strict', providerId: 'met-office' },
        forecast: {
          representation: 'deterministic',
          freshnessBasis: 'model-run',
        },
        preferences: { recentRides: { mode: 'prefer-variety' } },
      }),
    });
    assert.equal(response.status, 200);
    const schema = z.object({
      history: z.object({ revision: z.number() }),
      rankings: z.array(
        z.object({
          best: z.object({
            date: z.string(),
            recentRides: z.object({ penaltyPoints: z.number() }),
          }),
          alternatives: z.array(
            z.object({
              date: z.string(),
              recentRides: z.object({ penaltyPoints: z.number() }),
            }),
          ),
        }),
      ),
    });
    const result = schema.parse(await response.json());
    assert.equal(result.history.revision, 1);
    const best = result.rankings[0]?.best;
    assert.ok(best);
    assert.equal(best.date, '2026-10-11');
    assert.ok(Math.abs(best.recentRides.penaltyPoints - (10 * 26) / 28) < 0.01);
    const earlier = result.rankings[0]?.alternatives.find(
      (r) => r.date === '2026-10-10',
    );
    assert.ok(earlier);
    assert.ok(
      Math.abs(earlier.recentRides.penaltyPoints - (10 * 27) / 28) < 0.01,
    );
  },
);
