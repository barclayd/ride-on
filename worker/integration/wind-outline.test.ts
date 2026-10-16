import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Route } from '../src/routes/model.ts';
import type { RouteOutline } from '../src/routes/outline.ts';
import type { Candidate } from '../src/tracking/model.ts';
import type { publicTracking } from '../src/tracking/store.ts';
import { upload } from './client.ts';
import { metOffice } from './fixtures.ts';
import { createHarness } from './harness.ts';

test('1,000 real wind sections survive recommendation, tracking and logged-plan persistence without additional forecasts', {
  timeout: 60_000,
}, async () => {
  const h = await createHarness();
  try {
    h.use(metOffice());
    assert.equal(
      (
        await h.send('/users', {
          body: JSON.stringify({
            displayName: 'Wind sketch test',
            settings: {
              weather: { mode: 'strict', providerId: 'met-office' },
              forecast: {
                representation: 'deterministic',
                freshnessBasis: 'model-run',
              },
            },
          }),
        })
      ).status,
      201,
    );
    const uploaded = await upload(h);
    const db = await h.runtime.getD1Database('ROUTES_DB');
    const row = await db
      .prepare('SELECT route_json FROM routes WHERE owner_id = ? AND id = ?')
      .bind('alice', uploaded.id)
      .first<{ route_json: string }>();
    assert.ok(row);
    const original = JSON.parse(row.route_json) as Route;
    const start = original.weatherLocations[0],
      end = original.weatherLocations.at(-1),
      leg = original.legs[0];
    assert.ok(start && end && leg);
    const route: Route = {
      ...original,
      geometry: null,
      distanceM: 100000,
      weatherLocations: [start, { ...end, distanceM: 100000 }],
      legs: Array.from({ length: 1000 }, (_, i) => {
        const location = i < 500 ? start : end;
        return {
          ...leg,
          fromM: i * 100,
          toM: (i + 1) * 100,
          bearingDegrees: i % 2 ? 180 : 0,
          weatherLocationId: location.id,
          coordinate: location.coordinate,
        };
      }),
    };
    await db
      .prepare('UPDATE routes SET route_json = ? WHERE owner_id = ? AND id = ?')
      .bind(JSON.stringify(route), 'alice', uploaded.id)
      .run();
    const response = await h.send('/recommendations', {
      body: JSON.stringify({
        routeIds: [route.id],
        date: '2026-10-10',
        riding: { window: { start: '09:00', end: '15:00' } },
      }),
    });
    assert.equal(response.status, 200);
    const rec = (await response.json()) as {
      generatedAt: string;
      algorithmVersion: string;
      weather: { attribution: { text: string; url: string }[] };
      rankings: {
        outline: RouteOutline;
        best: Candidate & { recommendationRef: string };
        alternatives: Candidate[];
      }[];
      days: { best: Candidate | null }[];
    };
    const ranked = rec.rankings[0];
    assert.ok(ranked?.best.recommendationRef);
    assert.ok(ranked.outline.points.length <= 64);
    assert.equal(ranked.best.windStretches.length, 1000);
    assert.ok(
      ranked.alternatives.every((c) => c.windStretches.length === 1000),
    );
    assert.ok(rec.days.some((d) => d.best?.windStretches.length === 1000));
    const calls = h.requests.length;
    const tracked = await h.send('/tracked-rides', {
      headers: { 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({
        recommendationRef: ranked.best.recommendationRef,
        expectedTrackingVersion: 0,
        replaceTrackedRideId: null,
      }),
    });
    assert.equal(tracked.status, 201, await tracked.clone().text());
    const created = (await tracked.json()) as {
      ride: ReturnType<typeof publicTracking>;
    };
    assert.deepEqual(
      created.ride.baseline.pick.candidate.windStretches,
      ranked.best.windStretches,
    );
    assert.equal(h.requests.length, calls);
    await h.restart({ TEST_NOW: '2026-10-10T19:00:00Z' });
    const plan = {
      departureAt: ranked.best.departureAt,
      finishAt: ranked.best.finishAt,
      conditions: ranked.best.conditions,
      windStretches: ranked.best.windStretches,
      pickRank: 1,
      generatedAt: rec.generatedAt,
      algorithmVersion: rec.algorithmVersion,
      weather: { attribution: rec.weather.attribution },
    };
    const logged = await h.send('/rides', {
      headers: { 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({
        routeId: route.id,
        expectedRouteVersion: 1,
        riddenOn: '2026-10-10',
        timeZone: 'Europe/London',
        plan,
      }),
    });
    assert.equal(logged.status, 201, await logged.clone().text());
    const saved = (await logged.json()) as {
      ride: { id: string; plan: typeof plan };
    };
    assert.deepEqual(saved.ride.plan.windStretches, plan.windStretches);
    await h.restart();
    const fetched = (await (
      await h.send(`/rides/${saved.ride.id}`)
    ).json()) as typeof saved;
    assert.deepEqual(fetched.ride.plan.windStretches, plan.windStretches);
    assert.equal(h.requests.length, calls);
  } finally {
    await h.dispose();
    assert.deepEqual(h.unexpected, []);
    assert.deepEqual(h.handlerErrors, []);
  }
});
