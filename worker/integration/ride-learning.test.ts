import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as pause } from 'node:timers/promises';
import { HttpResponse, http } from 'msw/http';
import { z } from 'zod';
import type { Experience } from '../src/rides/experience.ts';
import type { RideWeatherEvidence } from '../src/rides/historical-weather.ts';
import { recommendMetOffice } from './client.ts';
import { metOffice } from './fixtures.ts';
import { BOB_TOKEN, createHarness, type Harness } from './harness.ts';

const experienceSchema = z.custom<Experience>();
const evidenceSchema = z.custom<RideWeatherEvidence>();
const simpleGpx =
  '<gpx version="1.1"><trk><name>Learning test</name><trkseg><trkpt lat="51.5" lon="-0.1"><ele>10</ele></trkpt><trkpt lat="51.52" lon="-0.1"><ele>20</ele></trkpt></trkseg></trk></gpx>';
const rideSchema = z.object({
  ride: z.object({
    id: z.string(),
    version: z.number(),
    experienceVersion: z.number(),
    experience: experienceSchema.nullable(),
  }),
});
const integration = (name: string, run: (h: Harness) => Promise<void>) =>
  test(name, { timeout: 30000 }, async () => {
    const h = await createHarness();
    try {
      await run(h);
    } finally {
      await h.dispose();
      assert.deepEqual(h.unexpected, []);
      assert.deepEqual(h.handlerErrors, []);
    }
  });
const create = async (h: Harness, date = '2026-10-01') => {
  const uploaded = await h.send('/routes', {
    body: simpleGpx,
    contentType: 'application/gpx+xml',
  });
  assert.equal(uploaded.status, 201);
  const { route } = z
    .object({ route: z.object({ id: z.string(), version: z.number() }) })
    .parse(await uploaded.json());
  const response = await h.send('/rides', {
    headers: { 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify({
      routeId: route.id,
      expectedRouteVersion: route.version,
      riddenOn: date,
      timeZone: 'Europe/London',
    }),
  });
  assert.equal(response.status, 201);
  return { route, ride: rideSchema.parse(await response.json()).ride };
};
const feedback = {
  enjoyment: 5,
  weatherComfort: 2,
  reasons: [{ factor: 'wind', impact: 'negative' }],
  includeInLearning: true,
};
const timing = {
  startTime: '09:00',
  durationMinutes: 120,
  precision: 'confirmed',
  routeFollowed: 'yes',
};
const save = (
  h: Harness,
  id: string,
  patch: Record<string, unknown> = {},
  token?: string,
) =>
  h.send(`/rides/${id}/experience`, {
    method: 'PUT',
    token,
    body: JSON.stringify({
      expectedVersion: 0,
      expectedRideVersion: 1,
      timing,
      feedback,
      ...patch,
    }),
  });
const weather = (h: Harness, id: string) =>
  h.send(`/rides/${id}/weather`).then(async (r) =>
    z
      .object({
        status: z.string(),
        reason: z.string().nullable(),
        experienceVersion: z.number().nullable(),
        evidence: evidenceSchema.nullable(),
      })
      .parse(await r.json()),
  );
const settledWeather = async (h: Harness, id: string) => {
  for (let i = 0; i < 80; i++) {
    const result = await weather(h, id);
    if (
      result.status === 'ready' ||
      result.status === 'unavailable' ||
      (result.status === 'pending' && result.reason)
    )
      return result;
    await pause(20);
  }
  throw new Error('Weather job did not settle');
};
const fixture = (missing = false, before = async () => {}) =>
  http.get(
    'https://archive-api.open-meteo.com/v1/archive',
    async ({ request }) => {
      await before();
      const url = new URL(request.url);
      const lat = (url.searchParams.get('latitude') ?? '')
        .split(',')
        .map(Number);
      const lon = (url.searchParams.get('longitude') ?? '')
        .split(',')
        .map(Number);
      const start =
        Date.parse(`${url.searchParams.get('start_date')}T00:00:00Z`) / 1000;
      const end =
        Date.parse(`${url.searchParams.get('end_date')}T00:00:00Z`) / 1000 +
        86400;
      const time = Array.from(
        { length: (end - start) / 3600 },
        (_, i) => start + i * 3600,
      );
      const values = (n: number | null) => time.map(() => n);
      const rows = lat.map((latitude, i) => ({
        latitude,
        longitude: lon[i],
        hourly_units: {
          time: 'unixtime',
          temperature_2m: '°C',
          wind_speed_10m: 'km/h',
          wind_direction_10m: '°',
          precipitation: 'mm',
          sunshine_duration: 's',
          relative_humidity_2m: '%',
          cloud_cover: '%',
        },
        hourly: {
          time,
          temperature_2m: values(12),
          wind_speed_10m: values(30),
          wind_direction_10m: values(0),
          precipitation: values(missing ? null : 1),
          sunshine_duration: values(900),
          relative_humidity_2m: values(65),
          cloud_cover: values(75),
        },
      }));
      return HttpResponse.json(rows.length === 1 ? rows[0] : rows);
    },
  );

integration(
  'scheduled work recovers pending feedback and replaces provisional evidence without double counting',
  async (h) => {
    h.use(fixture());
    const { ride } = await create(h, '2026-10-08');
    await save(h, ride.id);
    assert.equal(h.requests.length, 0);
    assert.equal((await weather(h, ride.id)).status, 'pending');
    const db = await h.runtime.getD1Database('ROUTES_DB');
    await db
      .prepare('INSERT INTO ride_weather_usage VALUES (?, ?)')
      .bind('2025-01-01', 10)
      .run();
    await (await h.runtime.getWorker()).scheduled({
      scheduledTime: new Date('2026-10-09T12:00:00Z'),
    });
    assert.equal(
      await db.prepare('SELECT date FROM ride_weather_usage').first(),
      null,
    );
    assert.equal(h.requests.length, 0);
    await h.restart({ RIDE_LEARNING_WEATHER_MODE: 'non-commercial' });
    const worker = await h.runtime.getWorker();
    assert.equal(
      (
        await worker.scheduled({
          scheduledTime: new Date('2026-10-09T12:00:00Z'),
        })
      ).outcome,
      'ok',
    );
    assert.equal((await weather(h, ride.id)).evidence?.model, 'ecmwf_ifs');
    assert.equal(
      (
        await worker.scheduled({
          scheduledTime: new Date('2026-10-15T12:00:00Z'),
        })
      ).outcome,
      'ok',
    );
    const final = await weather(h, ride.id);
    assert.equal(final.evidence?.model, 'era5');
    assert.equal(final.reason, null);
    assert.equal(final.experienceVersion, 1);
    assert.equal(h.requests.length, 2);
    const profile = z
      .object({ eligibleRideCount: z.number() })
      .parse(await (await h.send('/users/me/learning')).json());
    assert.equal(profile.eligibleRideCount, 1);
    await (await h.runtime.getD1Database('ROUTES_DB'))
      .prepare(
        "UPDATE ride_weather SET status = 'processing', attempts = 3, lease_until = 0 WHERE ride_id = ?",
      )
      .bind(ride.id)
      .run();
    await worker.scheduled({ scheduledTime: new Date('2026-10-16T12:00:00Z') });
    assert.equal((await weather(h, ride.id)).reason, 'retry-exhausted');
    assert.equal(h.requests.length, 2);
  },
);

integration(
  'a delayed provider response cannot restore removed feedback or its learning contribution',
  async (h) => {
    await h.restart({ RIDE_LEARNING_WEATHER_MODE: 'non-commercial' });
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    h.use(fixture(false, () => gate));
    const { ride } = await create(h);
    try {
      assert.equal((await save(h, ride.id)).status, 200);
      for (let i = 0; i < 80 && h.requests.length === 0; i++) await pause(20);
      assert.equal(h.requests.length, 1);
      assert.equal(
        (
          await save(h, ride.id, {
            expectedVersion: 1,
            timing: null,
            feedback: null,
          })
        ).status,
        200,
      );
      assert.equal((await settledWeather(h, ride.id)).reason, 'not-included');
    } finally {
      release();
    }
    const db = await h.runtime.getD1Database('ROUTES_DB');
    for (let i = 0; i < 80; i++) {
      if (
        await db
          .prepare('SELECT cache_key FROM ride_weather_cache LIMIT 1')
          .first()
      )
        break;
      await pause(20);
    }
    // Give the superseded job its final CAS after the shared cache write.
    await pause(50);
    const final = await weather(h, ride.id);
    assert.equal(final.experienceVersion, 2);
    assert.equal(final.evidence, null);
    assert.equal(final.reason, 'not-included');
    assert.equal(
      z
        .object({ eligibleRideCount: z.number() })
        .parse(await (await h.send('/users/me/learning')).json())
        .eligibleRideCount,
      0,
    );
  },
);

integration(
  'recommendation snapshots are server recorded and link only to the same owner, route version and date',
  async (h) => {
    h.use(metOffice());
    const { route } = await create(h);
    const result = await recommendMetOffice(h, [route.id]);
    assert.ok(result.recommendationId);
    const saved = await h.send(`/recommendations/${result.recommendationId}`);
    assert.equal(saved.status, 200);
    const snapshot = z
      .object({
        source: z.literal('server'),
        snapshot: z.object({
          rankings: z.array(
            z.object({
              routeId: z.string(),
              best: z.object({ score: z.number() }).nullable(),
            }),
          ),
        }),
      })
      .parse(await saved.json());
    assert.equal(
      snapshot.snapshot.rankings[0]?.best?.score,
      result.rankings[0]?.best.score,
    );
    assert.equal(
      (
        await h.send(`/recommendations/${result.recommendationId}`, {
          token: BOB_TOKEN,
        })
      ).status,
      404,
    );
    await h.restart({ TEST_NOW: '2026-10-11T12:00:00Z' });
    const record = async (date: string, id = result.recommendationId) => {
      const response = await h.send('/rides', {
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({
          routeId: route.id,
          expectedRouteVersion: route.version,
          riddenOn: date,
          timeZone: 'Europe/London',
          recommendationId: id,
        }),
      });
      assert.equal(response.status, 201);
      return z
        .object({ ride: z.object({ recommendationId: z.string().nullable() }) })
        .parse(await response.json()).ride;
    };
    assert.equal(
      (await record('2026-10-10')).recommendationId,
      result.recommendationId,
    );
    assert.equal((await record('2026-10-09')).recommendationId, null);
    const db = await h.runtime.getD1Database('ROUTES_DB');
    await db
      .prepare(
        "UPDATE recommendation_snapshots SET owner_id = 'bob' WHERE id = ?",
      )
      .bind(result.recommendationId)
      .run();
    assert.equal((await record('2026-10-10')).recommendationId, null);
    await db
      .prepare(
        "UPDATE recommendation_snapshots SET owner_id = 'alice' WHERE id = ?",
      )
      .bind(result.recommendationId)
      .run();
    await db
      .prepare(
        "UPDATE routes SET route_json = json_set(route_json, '$.sourceHash', ?) WHERE owner_id = 'alice' AND id = ?",
      )
      .bind('0'.repeat(64), route.id)
      .run();
    assert.equal((await record('2026-10-10')).recommendationId, null);
  },
);

integration(
  'snapshot storage limits and failures preserve rankings and tracking references',
  async (h) => {
    h.use(metOffice());
    const { route } = await create(h);
    const first = await recommendMetOffice(h, [route.id]);
    assert.ok(first.recommendationId);
    const db = await h.runtime.getD1Database('ROUTES_DB');
    await db
      .prepare('UPDATE recommendation_snapshots SET size_bytes = 50000000')
      .run();
    const capped = await recommendMetOffice(h, [route.id]);
    assert.equal(capped.recommendationId, null);
    assert.equal(capped.rankings[0]?.best.score, first.rankings[0]?.best.score);
    assert.ok(capped.rankings[0]?.best.recommendationRef);
    await db.prepare('DROP TABLE recommendation_snapshots').run();
    const failed = await recommendMetOffice(h, [route.id]);
    assert.equal(failed.recommendationId, null);
    assert.equal(failed.rankings[0]?.best.score, first.rankings[0]?.best.score);
    assert.ok(failed.rankings[0]?.best.recommendationRef);
  },
);

integration(
  'feedback is owner scoped, versioned, retry safe, optional and independent of saving a ride',
  async (h) => {
    const { ride } = await create(h);
    assert.equal(ride.experience, null);
    assert.equal(h.requests.length, 0);
    assert.equal((await save(h, ride.id, {}, BOB_TOKEN)).status, 404);
    assert.equal((await save(h, ride.id, { ownerId: 'bob' })).status, 400);
    assert.equal(
      (await save(h, ride.id, { timing: { ...timing, durationMinutes: 2000 } }))
        .status,
      400,
    );
    const saved = await save(h, ride.id, { timing: null });
    assert.equal(saved.status, 200);
    const next = rideSchema.parse(await saved.json()).ride;
    assert.equal(next.experienceVersion, 1);
    assert.equal(next.experience?.timing, null);
    assert.equal((await save(h, ride.id, { timing: null })).status, 200);
    assert.equal(
      (
        await save(h, ride.id, {
          timing: null,
          feedback: { ...feedback, weatherComfort: 5 },
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await save(h, ride.id, {
          expectedVersion: 1,
          timing: null,
          feedback: null,
        })
      ).status,
      200,
    );
    const cleared = rideSchema.parse(
      await (await h.send(`/rides/${ride.id}`)).json(),
    ).ride;
    assert.equal(cleared.experience, null);
    assert.equal(cleared.experienceVersion, 2);
    assert.equal(h.requests.length, 0);
  },
);

integration(
  'historical enrichment freezes route evidence, shares cache, and uses reanalysis with explicit provenance',
  async (h) => {
    await h.restart({ RIDE_LEARNING_WEATHER_MODE: 'non-commercial' });
    h.use(fixture());
    const { route, ride } = await create(h);
    // Removing the source route cannot remove the completed ride's weather geometry.
    const db = await h.runtime.getD1Database('ROUTES_DB');
    await db
      .prepare('DELETE FROM routes WHERE owner_id = ? AND id = ?')
      .bind('alice', route.id)
      .run();
    assert.equal((await save(h, ride.id)).status, 200);
    const result = await settledWeather(h, ride.id);
    assert.equal(result.status, 'ready');
    assert.equal(result.evidence?.model, 'era5');
    assert.equal(result.evidence?.basis, 'reanalysis');
    assert.equal(result.evidence?.coverage, 1);
    assert.equal(result.evidence?.summary?.temperatureC, 12);
    assert.equal(result.evidence?.summary?.sunshineFraction, 0.25);
    assert.ok((result.evidence?.summary?.headwindKph ?? 0) > 29);
    assert.equal(result.evidence?.startedAt, '2026-10-01T08:00:00.000Z');
    assert.equal(h.requests.length, 1);
    assert.equal(
      (await h.send(`/rides/${ride.id}/weather`, { token: BOB_TOKEN })).status,
      404,
    );
    const profile = await h.send('/users/me/learning');
    const learned = z
      .object({ eligibleRideCount: z.number(), scoringApplied: z.boolean() })
      .parse(await profile.json());
    assert.equal(learned.eligibleRideCount, 1);
    assert.equal(learned.scoringApplied, false);
    await h.restart({ TEST_NOW: '2026-10-10T12:00:00Z' });
    assert.equal(
      (
        await save(h, ride.id, {
          expectedVersion: 1,
          feedback: { ...feedback, weatherComfort: 3 },
        })
      ).status,
      200,
    );
    assert.equal(
      (await settledWeather(h, ride.id)).evidence?.retrievedAt,
      result.evidence?.retrievedAt,
    );
    assert.equal(h.requests.length, 1);
    const correction = await h.send(`/rides/${ride.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        expectedVersion: 1,
        riddenOn: '2026-10-02',
        timeZone: 'Europe/London',
      }),
    });
    assert.equal(correction.status, 200);
    assert.equal(
      rideSchema.parse(await correction.json()).ride.experience?.timing,
      null,
    );
    assert.equal((await weather(h, ride.id)).evidence, null);
    const after = z
      .object({ eligibleRideCount: z.number() })
      .parse(await (await h.send('/users/me/learning')).json());
    assert.equal(after.eligibleRideCount, 0);
  },
);

integration(
  'missing weather stays unknown; opt out and unconfirmed routes never request weather',
  async (h) => {
    await h.restart({ RIDE_LEARNING_WEATHER_MODE: 'non-commercial' });
    h.use(fixture(true));
    const { ride } = await create(h);
    await save(h, ride.id);
    const result = await settledWeather(h, ride.id);
    assert.equal(result.reason, 'incomplete-weather');
    assert.equal(result.evidence?.features, null);
    assert.equal(result.evidence?.coverage, 0);
    const calls = h.requests.length;
    await save(h, ride.id, {
      expectedVersion: 1,
      feedback: { ...feedback, includeInLearning: false },
    });
    assert.equal((await settledWeather(h, ride.id)).reason, 'not-included');
    await save(h, ride.id, {
      expectedVersion: 2,
      timing: { ...timing, routeFollowed: 'partly' },
    });
    assert.equal(
      (await settledWeather(h, ride.id)).reason,
      'route-not-confirmed',
    );
    assert.equal(h.requests.length, calls);
  },
);

integration(
  'recent model history is provisional; reset/disable and deletion remove learning influence',
  async (h) => {
    await h.restart({ RIDE_LEARNING_WEATHER_MODE: 'non-commercial' });
    h.use(fixture());
    const { ride } = await create(h, '2026-10-08');
    await save(h, ride.id);
    const result = await settledWeather(h, ride.id);
    assert.equal(result.reason, 'reanalysis-pending');
    assert.equal(result.evidence?.basis, 'modelled-past');
    const reset = await h.send('/users/me/learning', {
      method: 'PATCH',
      body: JSON.stringify({ expectedVersion: 0, enabled: true, reset: true }),
    });
    assert.equal(reset.status, 200);
    assert.equal(
      z.object({ eligibleRideCount: z.number() }).parse(await reset.json())
        .eligibleRideCount,
      0,
    );
    assert.equal(
      (
        await h.send('/users/me/learning', {
          method: 'PATCH',
          body: JSON.stringify({ expectedVersion: 0, enabled: false }),
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await h.send('/users/me/learning', {
          method: 'PATCH',
          body: JSON.stringify({ expectedVersion: 1, enabled: false }),
        })
      ).status,
      200,
    );
    await h.send(`/rides/${ride.id}`, { method: 'DELETE' });
    const db = await h.runtime.getD1Database('ROUTES_DB');
    assert.equal(
      await db
        .prepare('SELECT ride_id FROM ride_weather WHERE ride_id = ?')
        .bind(ride.id)
        .first(),
      null,
    );
  },
);
