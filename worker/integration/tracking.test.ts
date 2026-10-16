import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HttpResponse } from 'msw/http';
import type { Route } from '../src/routes/model.ts';
import { compareTracking } from '../src/tracking/comparison.ts';
import type { Candidate, Snapshot } from '../src/tracking/model.ts';
import type { publicTracking } from '../src/tracking/store.ts';
import { first, upload } from './client.ts';
import { hourlyForecast, metOffice } from './fixtures.ts';
import { BOB_TOKEN, createHarness, type Harness } from './harness.ts';

type Ride = ReturnType<typeof publicTracking>;
type Mutation = {
  ride: Ride;
  trackingVersion: number;
  activeTrackedRideId: string | null;
  outcome: string;
  replayed: boolean;
};
type Referenced = Candidate & {
  recommendationRef: string;
  trackingAvailability: string;
};
type Recommendation = {
  rankings: { routeId: string; best: Referenced; alternatives: Referenced[] }[];
  days: {
    date: string;
    recommendedRouteId: string | null;
    best: Referenced | null;
  }[];
};
const json = async <T>(response: { json(): Promise<unknown> }) =>
  (await response.json()) as T;
const integration = (name: string, run: (h: Harness) => Promise<void>) =>
  test(name, { timeout: 60_000 }, async () => {
    const h = await createHarness();
    try {
      await run(h);
    } finally {
      await h.dispose();
      assert.deepEqual(h.unexpected, []);
      assert.deepEqual(h.handlerErrors, []);
    }
  });
const settings = {
  weather: { mode: 'strict', providerId: 'met-office' },
  forecast: { representation: 'deterministic', freshnessBasis: 'model-run' },
};
const setup = async (h: Harness) => {
  h.use(metOffice());
  assert.equal(
    (
      await h.send('/users', {
        body: JSON.stringify({ displayName: 'Test rider', settings }),
      })
    ).status,
    201,
  );
  return upload(h);
};
const recommend = async (
  h: Harness,
  routeIds: string[],
  extra: Record<string, unknown> = {},
) => {
  const response = await h.send('/recommendations', {
    body: JSON.stringify({ routeIds, date: '2026-10-10', ...extra }),
  });
  assert.equal(response.status, 200);
  return json<Recommendation>(response);
};
const track = (
  h: Harness,
  ref: string,
  version = 0,
  replace: string | null = null,
  key = crypto.randomUUID(),
) =>
  h.send('/tracked-rides', {
    headers: { 'Idempotency-Key': key },
    body: JSON.stringify({
      recommendationRef: ref,
      expectedTrackingVersion: version,
      replaceTrackedRideId: replace,
    }),
  });
const clearCache = async (h: Harness) => {
  const kv = await h.runtime.getKVNamespace('WEATHER_CACHE');
  for (const key of (await kv.list()).keys) await kv.delete(key.name);
};
const editRoute = async (h: Harness, id: string, scale = 1.1) => {
  const db = await h.runtime.getD1Database('ROUTES_DB');
  const row = await db
    .prepare('SELECT route_json FROM routes WHERE owner_id = ? AND id = ?')
    .bind('alice', id)
    .first<{ route_json: string }>();
  assert.ok(row);
  const route = JSON.parse(row.route_json) as Route;
  const changed = {
    ...route,
    name: 'Edited course',
    sourceHash: 'a'.repeat(64),
    geometry: null,
    distanceM: route.distanceM * scale,
    legs: route.legs.map((leg) => ({
      ...leg,
      fromM: leg.fromM * scale,
      toM: leg.toM * scale,
    })),
    weatherLocations: route.weatherLocations.map((l) => ({
      ...l,
      distanceM: l.distanceM * scale,
    })),
  };
  await db
    .prepare(
      'UPDATE routes SET route_json = ?,version = version + 1 WHERE owner_id = ? AND id = ?',
    )
    .bind(JSON.stringify(changed), 'alice', id)
    .run();
};

integration(
  'tracking preserves the accepted baseline, uses cached weather, survives restart and keeps history after stopping',
  async (h) => {
    const route = await setup(h),
      rec = await recommend(h, [route.id]);
    const candidate = rec.rankings[0]?.best;
    assert.ok(candidate?.recommendationRef);
    const calls = h.requests.length,
      key = crypto.randomUUID();
    const response = await track(h, candidate.recommendationRef, 0, null, key);
    assert.equal(response.status, 201);
    const created = await json<Mutation>(response);
    assert.equal(created.ride.baseline.pick.candidate.score, candidate.score);
    assert.equal(
      created.ride.baseline.pick.candidate.departureAt,
      candidate.departureAt,
    );
    assert.equal(created.ride.refresh.result, 'assessed');
    assert.equal(created.ride.comparison?.scoreDeltaFromBaseline, 0);
    assert.equal(h.requests.length, calls);
    assert.equal(created.ride.capabilities.notifications, false);
    const summaries = await json<{ rides: { refresh: Ride['refresh'] }[] }>(
      await h.send('/tracked-rides'),
    );
    assert.equal(
      first(summaries.rides).refresh.refreshAt,
      created.ride.refresh.refreshAt,
    );
    await h.restart();
    const replay = await json<Mutation>(
      await track(h, candidate.recommendationRef, 0, null, key),
    );
    assert.equal(replay.ride.id, created.ride.id);
    assert.equal(replay.replayed, true);
    const repeated = await json<Mutation>(
      await track(h, candidate.recommendationRef),
    );
    assert.equal(repeated.outcome, 'existing');
    assert.deepEqual(repeated.ride.baseline, created.ride.baseline);
    assert.equal(
      (
        await h.send(`/tracked-rides/${created.ride.id}?permanent=true`, {
          method: 'DELETE',
        })
      ).status,
      409,
    );
    assert.equal(
      (await h.send(`/tracked-rides/${created.ride.id}`, { method: 'DELETE' }))
        .status,
      204,
    );
    const stopped = await json<Mutation>(
      await track(h, candidate.recommendationRef, 0, null, key),
    );
    assert.equal(stopped.ride.state, 'inactive');
    assert.equal(stopped.activeTrackedRideId, null);
    const list = await json<{ rides: unknown[] }>(
      await h.send('/tracked-rides'),
    );
    assert.equal(list.rides.length, 0);
    assert.equal(
      (
        await json<{ rides: unknown[] }>(
          await h.send('/tracked-rides?state=inactive'),
        )
      ).rides.length,
      1,
    );
    const retracked = await json<Mutation>(
      await track(h, candidate.recommendationRef, stopped.trackingVersion),
    );
    assert.notEqual(retracked.ride.id, created.ride.id);
    assert.equal(
      (
        await h.send(`/tracked-rides/${created.ride.id}?permanent=true`, {
          method: 'DELETE',
        })
      ).status,
      204,
    );
    assert.equal(
      (await track(h, candidate.recommendationRef, 0, null, key)).status,
      409,
    );
    assert.equal(
      (await h.send(`/tracked-rides/${created.ride.id}`)).status,
      404,
    );
    assert.equal(
      (await json<{ rides: unknown[] }>(await h.send('/rides'))).rides.length,
      0,
    );
  },
);

integration(
  'references are owner bound; daily, alternative and next-window candidates preserve their own scope',
  async (h) => {
    const route = await setup(h),
      rec = await recommend(h, [route.id], { previewDays: 3 });
    const picks = rec.rankings[0];
    assert.ok(picks?.alternatives[0]?.recommendationRef);
    const ref = picks.best.recommendationRef;
    assert.equal(
      (
        await h.send('/tracked-rides', {
          token: BOB_TOKEN,
          headers: { 'Idempotency-Key': crypto.randomUUID() },
          body: JSON.stringify({
            recommendationRef: ref,
            expectedTrackingVersion: 0,
          }),
        })
      ).status,
      422,
    );
    assert.equal((await track(h, crypto.randomUUID())).status, 422);
    assert.equal((await h.send('/tracked-rides', { token: null })).status, 401);
    const db = await h.runtime.getD1Database('ROUTES_DB');
    const scope = async (reference: string) => {
      const row = await db
        .prepare(
          'SELECT context_json FROM tracking_contexts c JOIN tracking_recommendations r ON c.owner_id = r.owner_id AND c.id = r.context_id WHERE r.id = ?',
        )
        .bind(reference)
        .first<{ context_json: string }>();
      assert.ok(row);
      return JSON.parse(row.context_json) as Snapshot['context'];
    };
    assert.deepEqual(
      (await scope(ref)).inputs.map((i) => i.date),
      ['2026-10-10'],
    );
    const day = rec.days.find((d) => d.date === '2026-10-10');
    assert.ok(day?.best?.recommendationRef);
    assert.deepEqual(
      (await scope(day.best.recommendationRef)).inputs.map((i) => i.date),
      ['2026-10-10'],
    );
    const windows = await json<{
      windows: { kind: string; best: Referenced }[];
    }>(
      await h.send('/recommendations/next-windows', {
        body: JSON.stringify({
          routeIds: [route.id],
          after: { date: '2026-10-09', window: 'daylight' },
        }),
      }),
    );
    assert.ok(windows.windows.length);
    for (const window of windows.windows)
      assert.ok((await scope(window.best.recommendationRef)).inputs.length);
    const accepted = await json<Mutation>(await track(h, ref));
    assert.equal(
      (await h.send(`/tracked-rides/${accepted.ride.id}`, { token: BOB_TOKEN }))
        .status,
      404,
    );
    assert.equal(
      (
        await h.send(`/tracked-rides/${accepted.ride.id}/assessments`, {
          token: BOB_TOKEN,
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await h.send(`/tracked-rides/${accepted.ride.id}/refresh`, {
          method: 'POST',
          token: BOB_TOKEN,
        })
      ).status,
      404,
    );
  },
);

integration(
  'concurrent creates and stale replacements keep exactly one active plan; failed replacement leaves it intact',
  async (h) => {
    const a = await setup(h),
      b = await upload(h, 'Second', -1.1);
    const rec = await recommend(h, [a.id, b.id]);
    const refs = rec.rankings.map((r) => r.best.recommendationRef);
    assert.equal(refs.length, 2);
    const responses = await Promise.all(refs.map((ref) => track(h, ref)));
    assert.deepEqual(responses.map((r) => r.status).sort(), [201, 409]);
    const winner = await json<Mutation>(
      first(responses.filter((r) => r.status === 201)),
    );
    const loserRef = first(
      rec.rankings.filter((r) => r.routeId !== winner.ride.routeId),
    ).best.recommendationRef;
    assert.equal((await track(h, loserRef, 0, winner.ride.id)).status, 409);
    const db = await h.runtime.getD1Database('ROUTES_DB');
    await db.exec(
      "CREATE TRIGGER reject_tracking BEFORE INSERT ON tracked_rides BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END;",
    );
    assert.equal(
      (await track(h, loserRef, winner.trackingVersion, winner.ride.id)).status,
      500,
    );
    assert.equal(
      (await json<Mutation>(await h.send(`/tracked-rides/${winner.ride.id}`)))
        .ride.state,
      'active',
    );
    await db.exec('DROP TRIGGER reject_tracking');
    const replacements = await Promise.all([
      track(h, loserRef, winner.trackingVersion, winner.ride.id),
      track(h, loserRef, winner.trackingVersion, winner.ride.id),
    ]);
    const created = replacements.find((r) => r.status === 201);
    assert.ok(created);
    assert.ok(replacements.every((r) => [200, 201, 409].includes(r.status)));
    const replaced = await json<Mutation>(created);
    assert.equal(replaced.outcome, 'replaced');
    const old = await json<Mutation>(
      await h.send(`/tracked-rides/${winner.ride.id}`),
    );
    assert.equal(old.ride.endedReason, 'replaced');
    assert.equal(
      (await json<{ rides: unknown[] }>(await h.send('/tracked-rides'))).rides
        .length,
      1,
    );
  },
);

integration(
  'forecast outage still saves tracking and never reports unchanged; refresh recovers without replacing the baseline',
  async (h) => {
    const route = await setup(h),
      rec = await recommend(h, [route.id]);
    const pick = first(rec.rankings).best;
    await clearCache(h);
    h.use(metOffice(() => new HttpResponse(null, { status: 503 })));
    const response = await track(h, pick.recommendationRef);
    assert.equal(response.status, 201);
    const saved = await json<Mutation>(response);
    assert.equal(saved.ride.refresh.result, 'unavailable');
    assert.equal(saved.ride.comparison, null);
    assert.equal(saved.ride.latestAssessment, null);
    assert.equal(saved.ride.baseline.pick.candidate.score, pick.score);
    h.use(
      metOffice(({ request }) =>
        HttpResponse.json(
          hourlyForecast(request, {
            values: () => ({ screenTemperature: 5, feelsLikeTemperature: 3 }),
          }),
        ),
      ),
    );
    const updated = await json<Mutation>(
      await h.send(`/tracked-rides/${saved.ride.id}/refresh`, {
        method: 'POST',
      }),
    );
    assert.equal(updated.ride.refresh.result, 'assessed');
    assert.ok((updated.ride.comparison?.scoreDeltaFromBaseline ?? 0) < 0);
    assert.deepEqual(updated.ride.baseline, saved.ride.baseline);
    const count = h.requests.length;
    await h.send(`/tracked-rides/${saved.ride.id}/refresh`, { method: 'POST' });
    assert.equal(h.requests.length, count);
    const history = await json<{ assessments: unknown[] }>(
      await h.send(`/tracked-rides/${saved.ride.id}/assessments`),
    );
    assert.equal(history.assessments.length, 1);
    await clearCache(h);
    h.use(metOffice(() => new HttpResponse(null, { status: 503 })));
    const failed = await json<Mutation>(
      await h.send(`/tracked-rides/${saved.ride.id}/refresh`, {
        method: 'POST',
      }),
    );
    assert.equal(failed.ride.latestAssessmentKind, 'last_known');
    assert.equal(failed.ride.comparison, null);
    assert.deepEqual(
      failed.ride.latestAssessment,
      updated.ride.latestAssessment,
    );
  },
);

integration(
  'refresh closes at departure and plans expire at finish without a background task; retries cannot resurrect them',
  async (h) => {
    const route = await setup(h),
      rec = await recommend(h, [route.id]),
      key = crypto.randomUUID();
    const ref = first(rec.rankings).best.recommendationRef;
    const saved = await json<Mutation>(await track(h, ref, 0, null, key));
    await h.restart({ TEST_NOW: saved.ride.departureAt });
    const count = h.requests.length;
    assert.equal(
      (
        await h.send(`/tracked-rides/${saved.ride.id}/refresh`, {
          method: 'POST',
        })
      ).status,
      409,
    );
    assert.equal((await track(h, ref, saved.trackingVersion)).status, 422);
    assert.equal(h.requests.length, count);
    await h.restart({ TEST_NOW: saved.ride.finishAt });
    const expired = await json<Mutation>(
      await h.send(`/tracked-rides/${saved.ride.id}`),
    );
    assert.equal(expired.ride.state, 'inactive');
    assert.equal(expired.ride.endedReason, 'expired');
    assert.equal(expired.activeTrackedRideId, null);
    assert.equal(expired.trackingVersion, saved.trackingVersion + 1);
    const retry = await json<Mutation>(await track(h, ref, 0, null, key));
    assert.equal(retry.ride.state, 'inactive');
    h.use(
      metOffice(({ request }) =>
        HttpResponse.json(
          hourlyForecast(request, { modelRunDate: saved.ride.finishAt }),
        ),
      ),
    );
    const later = await recommend(h, [route.id], {
      riding: { window: { start: '13:00', end: '17:00' } },
    });
    const next = await track(
      h,
      first(later.rankings).best.recommendationRef,
      expired.trackingVersion,
    );
    assert.equal(next.status, 201);
    assert.equal(
      (await json<Mutation>(await h.send(`/tracked-rides/${saved.ride.id}`)))
        .ride.endedReason,
      'expired',
    );
    assert.equal(
      (
        await h.send(`/tracked-rides/${saved.ride.id}?permanent=true`, {
          method: 'DELETE',
        })
      ).status,
      204,
    );
  },
);

integration(
  'refresh follows route and saved-setting edits but preserves the off-grid departure, time zone, dates and window',
  async (h) => {
    const route = await setup(h),
      rec = await recommend(h, [route.id], {
        riding: { window: { start: '08:30', end: '15:30' } },
      });
    const candidate = first(first(rec.rankings).alternatives);
    const saved = await json<Mutation>(
      await track(h, candidate.recommendationRef),
    );
    const patch = await h.send('/users/me', {
      method: 'PATCH',
      body: JSON.stringify({
        expectedVersion: 1,
        settings: {
          timeZone: 'America/New_York',
          riding: { departureStepMinutes: 120, averageSpeedKph: 25 },
          planning: { window: { start: '12:00', end: '16:00' } },
          preferences: { minimumStandards: { maximumGustKph: 1 } },
        },
      }),
    });
    assert.equal(patch.status, 200);
    await editRoute(h, route.id);
    const updated = await json<Mutation>(
      await h.send(`/tracked-rides/${saved.ride.id}/refresh`, {
        method: 'POST',
      }),
    );
    assert.equal(updated.ride.refresh.result, 'assessed');
    assert.equal(updated.ride.refresh.reasonCode, null);
    assert.equal(updated.ride.departureAt, saved.ride.departureAt);
    assert.equal(updated.ride.timeZone, saved.ride.timeZone);
    assert.notEqual(updated.ride.finishAt, saved.ride.finishAt);
    assert.deepEqual(updated.ride.baseline, saved.ride.baseline);
    const latest = updated.ride.latestAssessment;
    assert.ok(latest);
    assert.equal(first(latest.context.routes).version, 2);
    assert.equal(first(updated.ride.baseline.context.routes).version, 1);
    assert.equal(first(latest.context.inputs).riding.departureStepMinutes, 120);
    assert.deepEqual(first(latest.context.inputs).riding.window, {
      start: '08:30',
      end: '15:30',
    });
    assert.ok(updated.ride.comparison?.contextChanges.includes('settings'));
    assert.ok(updated.ride.comparison?.contextChanges.includes('routes'));
    assert.ok(
      updated.ride.comparison?.standards.newlyFailing.some(
        (f) => f.standard === 'maximumGustKph' && f.unit === 'km/h',
      ),
    );
    await editRoute(h, route.id, 10);
    const impossible = await json<Mutation>(
      await h.send(`/tracked-rides/${saved.ride.id}/refresh`, {
        method: 'POST',
      }),
    );
    assert.equal(
      impossible.ride.refresh.reasonCode,
      'pinned_departure_no_longer_fits',
    );
    assert.equal(impossible.ride.comparison, null);
    assert.equal(impossible.ride.departureAt, saved.ride.departureAt);
    assert.equal(impossible.ride.latestAssessmentKind, 'last_known');
  },
);

integration(
  'missing competitors cannot imply continued Best Pick, and deleting library routes retains tracking history',
  async (h) => {
    const route = await setup(h),
      competitor = await upload(h, 'Competitor', -1.1);
    const rec = await recommend(h, [route.id, competitor.id]);
    const pick = first(rec.rankings.filter((r) => r.routeId === route.id)).best;
    const saved = await json<Mutation>(await track(h, pick.recommendationRef));
    await clearCache(h);
    h.use(
      metOffice(({ request }) =>
        Number(new URL(request.url).searchParams.get('longitude')) < -1.05
          ? new HttpResponse(null, { status: 503 })
          : HttpResponse.json(hourlyForecast(request)),
      ),
    );
    const result = await json<Mutation>(
      await h.send(`/tracked-rides/${saved.ride.id}/refresh`, {
        method: 'POST',
      }),
    );
    assert.equal(result.ride.refresh.result, 'assessed');
    assert.equal(
      result.ride.lastKnownComparison?.comparison.bestPick.coverage,
      'incomplete',
    );
    assert.equal(
      result.ride.lastKnownComparison?.comparison.bestPick
        .routeStillRecommended,
      null,
    );
    const db = await h.runtime.getD1Database('ROUTES_DB');
    await db
      .prepare('DELETE FROM routes WHERE owner_id = ? AND id = ?')
      .bind('alice', route.id)
      .run();
    const missing = await json<Mutation>(
      await h.send(`/tracked-rides/${saved.ride.id}/refresh`, {
        method: 'POST',
      }),
    );
    assert.equal(missing.ride.refresh.reasonCode, 'route_unavailable');
    assert.equal(missing.ride.state, 'active');
    assert.deepEqual(missing.ride.baseline, saved.ride.baseline);
  },
);

for (const change of [
  'stop',
  'erase',
  'replace',
  'preferences',
  'route',
] as const)
  integration(`a delayed refresh cannot publish after ${change}`, async (h) => {
    const route = await setup(h),
      other = await upload(h, 'Other', -1.1),
      rec = await recommend(h, [route.id, other.id]);
    const saved = await json<Mutation>(
      await track(
        h,
        first(rec.rankings.filter((r) => r.routeId === route.id)).best
          .recommendationRef,
      ),
    );
    await clearCache(h);
    let release = () => {},
      entered = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    h.use(
      metOffice(async ({ request }) => {
        entered();
        await gate;
        return HttpResponse.json(
          hourlyForecast(request, { values: () => ({ screenTemperature: 5 }) }),
        );
      }),
    );
    const pending = h.send(`/tracked-rides/${saved.ride.id}/refresh`, {
      method: 'POST',
    });
    await started;
    assert.equal(
      (
        await h.send(`/tracked-rides/${saved.ride.id}/refresh`, {
          method: 'POST',
        })
      ).status,
      409,
    );
    let replacement: Promise<Awaited<ReturnType<typeof track>>> | null = null;
    try {
      if (change === 'stop' || change === 'erase') {
        await h.send(`/tracked-rides/${saved.ride.id}`, { method: 'DELETE' });
        if (change === 'erase')
          await h.send(`/tracked-rides/${saved.ride.id}?permanent=true`, {
            method: 'DELETE',
          });
      } else if (change === 'preferences') {
        assert.equal(
          (
            await h.send('/users/me', {
              method: 'PATCH',
              body: JSON.stringify({
                expectedVersion: 1,
                settings: { preferences: { temperature: { comfortMinC: 20 } } },
              }),
            })
          ).status,
          200,
        );
      } else if (change === 'route') await editRoute(h, route.id);
      else {
        // Replacement commits before its own weather check, which is held by the same gate.
        replacement = track(
          h,
          first(rec.rankings.filter((r) => r.routeId === other.id)).best
            .recommendationRef,
          saved.trackingVersion,
          saved.ride.id,
        );
        // Observe the commit through the API while both weather calls are in flight.
        for (let attempt = 0; attempt < 100; attempt++) {
          const old = await json<Mutation>(
            await h.send(`/tracked-rides/${saved.ride.id}`),
          );
          if (old.ride.state === 'inactive') break;
          if (attempt === 99) assert.fail('Replacement did not commit');
        }
      }
    } finally {
      release();
    }
    const response = await pending;
    if (replacement) assert.equal((await replacement).status, 201);
    if (change === 'erase') assert.equal(response.status, 404);
    else {
      const final = await json<Mutation>(response);
      assert.deepEqual(
        final.ride.latestAssessment,
        saved.ride.latestAssessment,
      );
      if (change === 'route' || change === 'preferences')
        assert.equal(final.ride.refresh.reasonCode, 'inputs_changed');
      else assert.equal(final.ride.state, 'inactive');
    }
  });

integration(
  'snapshot storage failure leaves recommendations usable with explicit unavailable references',
  async (h) => {
    const route = await setup(h);
    const db = await h.runtime.getD1Database('ROUTES_DB');
    await db.exec(
      "CREATE TRIGGER reject_reference BEFORE INSERT ON tracking_contexts BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END;",
    );
    const rec = await recommend(h, [route.id]);
    assert.equal(first(rec.rankings).best.recommendationRef, null);
    assert.equal(first(rec.rankings).best.trackingAvailability, 'unavailable');
    assert.ok(first(rec.rankings).best.score > 0);
  },
);

integration(
  'changes accumulate against the accepted score and Best Pick uses priority with explicit uncertainty',
  async (h) => {
    const route = await setup(h),
      rec = await recommend(h, [route.id]);
    const saved = await json<Mutation>(
      await track(h, first(rec.rankings).best.recommendationRef),
    );
    const baseline = structuredClone(saved.ride.baseline);
    baseline.pick.candidate.score = 73;
    for (const [score, delta, significant] of [
      [70, -3, false],
      [67, -6, true],
      [68, -5, true],
      [78, 5, true],
      [77.999, 4.999, false],
    ] as const) {
      const current = structuredClone(baseline);
      current.pick.candidate.score = score;
      const comparison = compareTracking(baseline, current);
      assert.equal(comparison.scoreDeltaFromBaseline, delta);
      assert.equal(comparison.significantScoreChange, significant);
    }
    const current = structuredClone(baseline),
      competitor = crypto.randomUUID();
    current.pick.candidate.score = 75;
    current.pick.candidate.recommendationPriority = 75;
    current.context.best = {
      routeId: competitor,
      candidate: {
        ...current.pick.candidate,
        score: 72,
        recommendationPriority: 77,
      },
    };
    current.context.coverageComplete = false;
    const better = compareTracking(baseline, current);
    assert.equal(better.bestPick.routeStillRecommended, false);
    assert.equal(better.bestPick.lostOriginalBestPick, true);
    assert.equal(better.bestPick.bestKnown.score, 72);
    current.context.best.candidate.recommendationPriority = 70;
    assert.equal(
      compareTracking(baseline, current).bestPick.routeStillRecommended,
      null,
    );
    current.context.coverageComplete = true;
    assert.equal(
      compareTracking(baseline, current).bestPick.routeStillRecommended,
      true,
    );
    baseline.context.best = {
      routeId: competitor,
      candidate: baseline.pick.candidate,
    };
    current.context.best.candidate.recommendationPriority = 77;
    assert.equal(
      compareTracking(baseline, current).bestPick.lostOriginalBestPick,
      false,
    );
  },
);

integration(
  'retained history paginates and stopped action keys cannot be reused with different content',
  async (h) => {
    const route = await setup(h),
      rec = await recommend(h, [route.id]);
    const pick = first(rec.rankings),
      key = crypto.randomUUID();
    const firstRide = await json<Mutation>(
      await track(h, pick.best.recommendationRef, 0, null, key),
    );
    assert.equal(
      (await track(h, first(pick.alternatives).recommendationRef, 0, null, key))
        .status,
      409,
    );
    await h.send(`/tracked-rides/${firstRide.ride.id}`, { method: 'DELETE' });
    const account = await json<{ trackingVersion: number }>(
      await h.send('/tracked-rides'),
    );
    const second = await json<Mutation>(
      await track(h, pick.best.recommendationRef, account.trackingVersion),
    );
    await h.send(`/tracked-rides/${second.ride.id}`, { method: 'DELETE' });
    const page = await json<{ rides: { id: string }[]; nextCursor: string }>(
      await h.send('/tracked-rides?state=inactive&limit=1'),
    );
    assert.ok(page.nextCursor);
    assert.equal(page.rides.length, 1);
    const next = await json<{
      rides: { id: string }[];
      nextCursor: string | null;
    }>(
      await h.send(
        `/tracked-rides?state=inactive&limit=1&cursor=${encodeURIComponent(page.nextCursor)}`,
      ),
    );
    assert.equal(next.rides.length, 1);
    assert.notEqual(first(next.rides).id, first(page.rides).id);
    assert.equal(next.nextCursor, null);
    assert.equal(
      (
        await h.send(
          `/tracked-rides?state=all&cursor=${encodeURIComponent(page.nextCursor)}`,
        )
      ).status,
      400,
    );
    const db = await h.runtime.getD1Database('ROUTES_DB');
    await db
      .prepare('DELETE FROM tracking_contexts WHERE owner_id = ?')
      .bind('alice')
      .run();
    const replay = await json<Mutation>(
      await track(h, pick.best.recommendationRef, 0, null, key),
    );
    assert.deepEqual(replay.ride.baseline, firstRide.ride.baseline);
  },
);

integration(
  'a create response cannot return a plan erased during its initial forecast check',
  async (h) => {
    const route = await setup(h),
      rec = await recommend(h, [route.id]);
    await clearCache(h);
    let release = () => {},
      entered = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    h.use(
      metOffice(async ({ request }) => {
        entered();
        await gate;
        return HttpResponse.json(hourlyForecast(request));
      }),
    );
    const key = crypto.randomUUID(),
      ref = first(rec.rankings).best.recommendationRef;
    const pending = track(h, ref, 0, null, key);
    await started;
    try {
      const list = await json<{ rides: { id: string }[] }>(
        await h.send('/tracked-rides'),
      );
      const id = first(list.rides).id;
      await h.send(`/tracked-rides/${id}`, { method: 'DELETE' });
      await h.send(`/tracked-rides/${id}?permanent=true`, { method: 'DELETE' });
    } finally {
      release();
    }
    assert.equal((await pending).status, 404);
    assert.equal((await track(h, ref, 0, null, key)).status, 409);
  },
);

integration(
  'expired refresh leases expose last-known evidence and older attempts cannot overwrite a newer success',
  async (h) => {
    const route = await setup(h),
      rec = await recommend(h, [route.id]);
    const saved = await json<Mutation>(
      await track(h, first(rec.rankings).best.recommendationRef),
    );
    await clearCache(h);
    let release = () => {},
      entered = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    h.use(
      metOffice(async ({ request }) => {
        entered();
        await gate;
        return HttpResponse.json(
          hourlyForecast(request, { values: () => ({ screenTemperature: 5 }) }),
        );
      }),
    );
    const older = h.send(`/tracked-rides/${saved.ride.id}/refresh`, {
      method: 'POST',
    });
    await started;
    try {
      const db = await h.runtime.getD1Database('ROUTES_DB');
      await db
        .prepare(
          'UPDATE tracked_rides SET lease_until = ? WHERE owner_id = ? AND id = ?',
        )
        .bind('2026-10-08T00:00:00.000Z', 'alice', saved.ride.id)
        .run();
      const interrupted = await json<Mutation>(
        await h.send(`/tracked-rides/${saved.ride.id}`),
      );
      assert.equal(interrupted.ride.refresh.reasonCode, 'refresh_interrupted');
      assert.equal(interrupted.ride.comparison, null);
      h.use(metOffice());
      const newer = await json<Mutation>(
        await h.send(`/tracked-rides/${saved.ride.id}/refresh`, {
          method: 'POST',
        }),
      );
      assert.equal(newer.ride.refresh.result, 'assessed');
      release();
      const result = await json<Mutation>(await older);
      assert.deepEqual(
        result.ride.latestAssessment,
        newer.ride.latestAssessment,
      );
      assert.equal(result.ride.refresh.result, 'assessed');
    } finally {
      release();
    }
  },
);
