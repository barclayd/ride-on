import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HttpResponse } from 'msw/http';
import { alertConditions } from '../src/monitoring/conditions.ts';
import { referenceFor } from '../src/monitoring/policy.ts';
import type { ScoreChange } from '../src/recommendations/score-changes.ts';
import type { Route } from '../src/routes/model.ts';
import type { TrackedDeparture } from '../src/tracking/departures.ts';
import type { Candidate } from '../src/tracking/model.ts';
import type { publicTracking } from '../src/tracking/store.ts';
import { first, upload } from './client.ts';
import { hourlyForecast, metOffice, routeGpx } from './fixtures.ts';
import { BOB_TOKEN, createHarness, type Harness } from './harness.ts';

type Departure = Candidate & {
  recommendationRef: string;
  scoreChange?: ScoreChange | null;
};
type Entry = {
  routeId: string;
  rank?: number;
  best: Departure | null;
  alternatives: Departure[];
  trackedDeparture?: TrackedDeparture;
  betterDeparture?: Departure | null;
  verdict: { status: string };
  departuresAssessed: number;
};
type Recommendations = {
  rankings: Entry[];
  unranked: Entry[];
  recommendation: { routeId: string; kind: string } | null;
  minimumStandardsStatus: string;
  days: { date: string; best: Departure | null }[];
  weather: {
    refreshAt: string | null;
    quality: { refreshAfterSeconds: number };
  };
};
type Tracked = {
  ride: ReturnType<typeof publicTracking>;
  trackingVersion: number;
  activeTrackedRideId: string | null;
};
const json = async <T>(r: { json(): Promise<unknown> }) =>
  (await r.json()) as T;
const run = (name: string, fn: (h: Harness) => Promise<void>) =>
  test(name, { timeout: 60_000 }, async () => {
    const h = await createHarness();
    try {
      await fn(h);
    } finally {
      await h.dispose();
      assert.deepEqual(h.unexpected, []);
      assert.deepEqual(h.handlerErrors, []);
    }
  });
const settings = {
  timeZone: 'Europe/London',
  weather: { mode: 'strict', providerId: 'met-office' },
  forecast: { representation: 'deterministic', freshnessBasis: 'model-run' },
};
const setup = async (h: Harness) => {
  h.use(metOffice());
  assert.equal(
    (
      await h.send('/users', {
        body: JSON.stringify({ displayName: 'Rider', settings }),
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
  token?: string,
) => {
  const r = await h.send('/recommendations', {
    token,
    body: JSON.stringify({
      ...settings,
      routeIds,
      date: '2026-10-10',
      ...extra,
    }),
  });
  assert.equal(r.status, 200, await r.clone().text());
  return json<Recommendations>(r);
};
const track = async (h: Harness, ref: string, previous?: Tracked) => {
  const r = await h.send('/tracked-rides', {
    headers: { 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify({
      recommendationRef: ref,
      expectedTrackingVersion: previous?.trackingVersion ?? 0,
      replaceTrackedRideId: previous?.activeTrackedRideId ?? null,
    }),
  });
  assert.equal(r.status, 201, await r.clone().text());
  return json<Tracked>(r);
};
const seed = async (h: Harness) => {
  const route = await setup(h);
  const initial = await recommend(h, [route.id], {
    riding: { window: { start: '09:00', end: '12:00' } },
  });
  const pick = first(initial.rankings).best;
  assert.ok(pick);
  return { route, pick, plan: await track(h, pick.recommendationRef) };
};
const clearCache = async (h: Harness) => {
  const kv = await h.runtime.getKVNamespace('WEATHER_CACHE');
  for (const key of (await kv.list()).keys) await kv.delete(key.name);
};
const routeEntry = (result: Recommendations, id: string) => {
  const entry = [...result.rankings, ...result.unranked].find(
    (r) => r.routeId === id,
  );
  assert.ok(entry);
  return entry;
};
const modifyRoute = async (
  h: Harness,
  id: string,
  edit: (route: Route) => Route,
) => {
  const db = await h.runtime.getD1Database('ROUTES_DB');
  const row = await db
    .prepare('SELECT route_json FROM routes WHERE owner_id = ? AND id = ?')
    .bind('alice', id)
    .first<{ route_json: string }>();
  assert.ok(row);
  await db
    .prepare(
      'UPDATE routes SET route_json = ?,version = version + 1 WHERE owner_id = ? AND id = ?',
    )
    .bind(
      JSON.stringify(edit(JSON.parse(row.route_json) as Route)),
      'alice',
      id,
    )
    .run();
};
const all = { rain: true, wind: true, cold: true, betterTime: true };

run(
  'score badges compare the fixed departure and retain the last change when fixing, moving and releasing it',
  async (h) => {
    const route = await setup(h);
    await h.send('/route-selection', {
      method: 'PUT',
      body: JSON.stringify({ expectedVersion: 0, routeIds: [route.id] }),
    });
    let morning = 18;
    let afternoon = 18;
    let at = '2026-10-09T12:00:00.000Z';
    h.use(
      metOffice(({ request }) =>
        HttpResponse.json(
          hourlyForecast(request, {
            modelRunDate: at,
            values: (hour) => ({
              screenTemperature: hour < 12 ? morning : afternoon,
            }),
          }),
        ),
      ),
    );
    const next = async (minute: number) => {
      at = `2026-10-09T12:${String(minute).padStart(2, '0')}:00.000Z`;
      await clearCache(h);
      await h.restart({ TEST_NOW: at });
    };
    const initial = routeEntry(await recommend(h, [route.id]), route.id).best;
    assert.ok(initial);
    assert.equal(initial.scoreChange, null);
    morning = afternoon = 14;
    await next(1);
    const changed = routeEntry(await recommend(h, [route.id]), route.id).best;
    assert.ok(changed?.scoreChange && changed.scoreChange.by < 0);
    morning = 2;
    afternoon = 18;
    await next(2);
    const plan = await track(h, initial.recommendationRef);
    const fixed = routeEntry(await recommend(h, [route.id]), route.id);
    assert.ok(fixed.best);
    assert.equal(fixed.best.departureAt, initial.departureAt);
    assert.ok(fixed.best.score < changed.score);
    assert.deepEqual(fixed.best.scoreChange, changed.scoreChange);
    morning = 7;
    await next(3);
    const improved = routeEntry(await recommend(h, [route.id]), route.id);
    assert.ok(improved.best && improved.betterDeparture);
    assert.deepEqual(improved.best.scoreChange, {
      from: Math.round(fixed.best.score),
      to: Math.round(improved.best.score),
      by: Math.round(improved.best.score) - Math.round(fixed.best.score),
      changedAt: at,
    });
    await next(4);
    const moved = await track(
      h,
      improved.betterDeparture.recommendationRef,
      plan,
    );
    const afterMove = routeEntry(await recommend(h, [route.id]), route.id).best;
    assert.equal(afterMove?.departureAt, moved.ride.departureAt);
    assert.ok(afterMove && afterMove.score > improved.best.score);
    assert.deepEqual(afterMove.scoreChange, improved.best.scoreChange);
    await next(5);
    await h.send(`/tracked-rides/${moved.ride.id}`, { method: 'DELETE' });
    const released = routeEntry(await recommend(h, [route.id]), route.id);
    assert.equal(released.trackedDeparture, undefined);
    assert.deepEqual(released.best?.scoreChange, improved.best.scoreChange);
  },
);

for (const morningOnly of [false, true]) {
  run(
    `better-time monitoring keeps the original scope and its own route even when another wins (morning-only: ${morningOnly})`,
    async (h) => {
      const route = await setup(h);
      const other = await upload(h, 'Other ride', -2);
      const originalScope = morningOnly
        ? { riding: { window: { start: '09:00', end: '12:00' } } }
        : {};
      const pick = routeEntry(
        await recommend(h, [route.id, other.id], originalScope),
        route.id,
      ).best;
      assert.ok(pick);
      const plan = await track(h, pick.recommendationRef);
      await h.send(`/push-devices/${crypto.randomUUID()}`, {
        method: 'PUT',
        body: JSON.stringify({
          token: 'a'.repeat(64),
          environment: 'sandbox',
          topic: 'com.danbarclay.rideon',
          platform: 'ios',
        }),
      });
      const monitor = () =>
        h.send('/__test/monitor', {
          body: JSON.stringify({ ownerId: 'alice', planId: plan.ride.id }),
        });
      assert.equal((await monitor()).status, 200);
      await clearCache(h);
      await h.restart({ TEST_NOW: '2026-10-09T12:01:00.000Z' });
      h.use(
        metOffice(({ request }) => {
          const own =
            Number(new URL(request.url).searchParams.get('longitude')) > -1.5;
          return HttpResponse.json(
            hourlyForecast(request, {
              modelRunDate: '2026-10-09T12:01:00.000Z',
              values: (hour) => ({
                screenTemperature: own && hour < 12 ? 2 : 18,
                windSpeed10m: own ? 3 : 0,
                max10mWindGust: own ? 4 : 0,
                significantWeatherCode: own ? 3 : 1,
              }),
            }),
          );
        }),
      );
      const tile = routeEntry(
        await recommend(h, [route.id, other.id], {
          riding: { window: { start: '13:00', end: '17:00' } },
        }),
        route.id,
      );
      assert.ok(tile.betterDeparture);
      await h.send(`/tracked-rides/${plan.ride.id}/refresh`, {
        method: 'POST',
      });
      assert.equal((await monitor()).status, 200);
      const current = await json<Tracked>(
        await h.send(`/tracked-rides/${plan.ride.id}`),
      );
      assert.equal(
        current.ride.latestAssessment?.context.best?.routeId,
        other.id,
      );
      const events = await json<{
        notifications: {
          decision: {
            reasons: string[];
            alternative: { routeId: string; departureAt: string } | null;
          };
        }[];
      }>(await h.send(`/tracked-rides/${plan.ride.id}/notifications`));
      const alert = first(events.notifications).decision;
      assert.equal(alert.reasons.includes('better_option'), !morningOnly);
      if (!morningOnly) {
        assert.equal(alert.alternative?.routeId, route.id);
        assert.equal(
          alert.alternative?.departureAt,
          tile.betterDeparture.departureAt,
        );
      }
      assert.deepEqual(current.ride.baseline, plan.ride.baseline);
    },
  );
}

run(
  'tracked best stays fixed inside and outside the window, reranks honestly, and can move and undo',
  async (h) => {
    const { route, pick, plan } = await seed(h);
    const other = await upload(h, 'Other ride', -2);
    await clearCache(h);
    h.use(
      metOffice(({ request }) => {
        const isTracked =
          Number(new URL(request.url).searchParams.get('longitude')) > -1.5;
        return HttpResponse.json(
          hourlyForecast(request, {
            values: (hour) => ({
              screenTemperature: isTracked ? (hour < 12 ? 2 : 18) : 13,
              feelsLikeTemperature: isTracked ? (hour < 12 ? 1 : 17) : 12,
            }),
          }),
        );
      }),
    );
    const extra = {
      riding: { window: { start: '13:00', end: '17:00' } },
      preferences: {
        minimumStandards: { minimumTemperature: { kind: 'fixed', valueC: 10 } },
      },
    };
    const ranked = await recommend(h, [route.id, other.id], extra);
    const fixed = routeEntry(ranked, route.id);
    assert.ok(fixed.best && fixed.betterDeparture);
    assert.equal(fixed.best.departureAt, pick.departureAt);
    assert.deepEqual(fixed.trackedDeparture, {
      trackedRideId: plan.ride.id,
      departureAt: pick.departureAt,
      finishAt: fixed.best.finishAt,
      status: 'assessed',
      reasonCode: null,
    });
    assert.equal(fixed.best.standards.status, 'below');
    assert.equal(fixed.verdict.status, 'below_minimums');
    assert.equal(ranked.recommendation?.routeId, other.id);
    assert.equal(ranked.recommendation.kind, 'best_pick');
    assert.equal(ranked.minimumStandardsStatus, 'match_found');
    assert.equal(first(ranked.rankings).routeId, other.id);
    assert.equal(fixed.departuresAssessed, 1);
    assert.ok(
      fixed.best.rideHours.length &&
        fixed.best.windStretches.length &&
        fixed.best.temperatureAlongRide.points.length &&
        fixed.best.forecastDetails.locations.length,
    );
    assert.equal(fixed.betterDeparture.standards.status, 'meets');
    const alone = await recommend(h, [route.id], extra);
    assert.equal(alone.minimumStandardsStatus, 'none_meet');
    assert.equal(alone.recommendation?.kind, 'best_available');
    assert.notEqual(fixed.betterDeparture.departureAt, pick.departureAt);
    assert.equal(Object.hasOwn(fixed.betterDeparture, 'scoreChange'), false);
    assert.notEqual(first(ranked.days).best?.departureAt, pick.departureAt);
    const otherAlone = first((await recommend(h, [other.id], extra)).rankings);
    assert.equal(
      otherAlone.best?.score,
      routeEntry(ranked, other.id).best?.score,
    );
    assert.equal(otherAlone.trackedDeparture, undefined);
    const inside = routeEntry(await recommend(h, [route.id]), route.id);
    assert.equal(inside.best?.departureAt, pick.departureAt);
    const moved = await track(h, fixed.betterDeparture.recommendationRef, plan);
    assert.equal(moved.ride.departureAt, fixed.betterDeparture.departureAt);
    assert.equal(moved.ride.refresh.result, 'assessed');
    const undone = await track(h, fixed.best.recommendationRef, moved);
    assert.equal(undone.ride.departureAt, pick.departureAt);
    assert.equal(undone.ride.refresh.result, 'assessed');
    assert.deepEqual(
      undone.ride.baseline.context.inputs[0]?.riding.window,
      extra.riding.window,
    );
    assert.equal(
      undone.ride.baseline.context.pinnedInput?.riding.window,
      'daylight',
    );
    assert.equal(
      (await referenceFor(undone.ride.baseline, undone.ride.createdAt))
        .alternative,
      `${route.id}/${fixed.betterDeparture.departureAt}`,
    );
    // Untracked alternatives remain the normal search alternatives, independently of the pin.
    await h.send(`/tracked-rides/${undone.ride.id}`, { method: 'DELETE' });
    const normal = routeEntry(
      await recommend(h, [route.id, other.id], extra),
      route.id,
    );
    assert.deepEqual(
      normal.alternatives.map((d) => d.departureAt),
      fixed.alternatives.map((d) => d.departureAt),
    );
    assert.notEqual(normal.best?.departureAt, pick.departureAt);
    assert.equal(normal.trackedDeparture, undefined);
  },
);

run(
  'a pin outside selected dates has fresh weather and a trackable reference with exactly the requested comparison scope',
  async (h) => {
    const { route, pick, plan } = await seed(h);
    const result = await recommend(h, [route.id], {
      date: undefined,
      days: { kind: 'dates', dates: ['2026-10-11'] },
    });
    const fixed = routeEntry(result, route.id);
    assert.equal(fixed.best?.departureAt, pick.departureAt);
    assert.equal(fixed.betterDeparture, null);
    assert.deepEqual(
      result.days.map((d) => d.date),
      ['2026-10-11'],
    );
    assert.equal(result.weather.quality.refreshAfterSeconds, 6 * 3600);
    assert.ok(result.weather.refreshAt && fixed.best?.recommendationRef);
    await h.send(`/tracked-rides/${plan.ride.id}`, { method: 'DELETE' });
    const account = await json<Tracked>(await h.send('/tracked-rides'));
    const undo = await track(h, fixed.best.recommendationRef, account);
    assert.equal(undo.ride.refresh.result, 'assessed');
    assert.deepEqual(
      undo.ride.baseline.context.inputs.map((i) => i.date),
      ['2026-10-11'],
    );
    assert.equal(undo.ride.baseline.context.pinnedInput?.date, '2026-10-10');
    assert.equal(
      undo.ride.latestAssessment?.pick.candidate.departureAt,
      pick.departureAt,
    );
  },
);

run(
  'a fixed reference survives an expired search without losing the plan timezone or warning preferences',
  async (h) => {
    const { route, pick, plan } = await seed(h);
    const fixed = routeEntry(
      await recommend(h, [route.id], {
        date: undefined,
        days: { kind: 'dates', dates: ['2026-10-08'] },
      }),
      route.id,
    );
    assert.equal(fixed.best?.departureAt, pick.departureAt);
    assert.ok(fixed.best?.recommendationRef);
    await h.send(`/tracked-rides/${plan.ride.id}`, { method: 'DELETE' });
    const account = await json<Tracked>(await h.send('/tracked-rides'));
    const undo = await track(h, fixed.best.recommendationRef, account);
    assert.equal(undo.ride.timeZone, 'Europe/London');
    assert.equal(undo.ride.refresh.result, 'assessed');
    assert.deepEqual(undo.ride.baseline.context.inputs, []);
    assert.ok(undo.ride.latestAssessment);
    assert.equal(
      alertConditions(undo.ride.latestAssessment).cold?.limitC,
      undo.ride.latestAssessment.context.pinnedInput?.preferences.temperature
        .comfortMinC,
    );
  },
);

run(
  'replaced and foreign plans never pin the old route or leak a deleted route',
  async (h) => {
    const { route, plan } = await seed(h);
    const bobUpload = await json<{ route: { id: string } }>(
      await h.send('/routes', {
        token: BOB_TOKEN,
        contentType: 'application/gpx+xml',
        body: routeGpx('Bob ride'),
      }),
    );
    const bob = await recommend(h, [bobUpload.route.id], {}, BOB_TOKEN);
    assert.equal(first(bob.rankings).trackedDeparture, undefined);
    const other = await upload(h, 'Replacement', -2);
    const otherPick = first((await recommend(h, [other.id])).rankings).best;
    assert.ok(otherPick);
    const replacement = await track(h, otherPick.recommendationRef, plan);
    const result = await recommend(h, [route.id, other.id], {
      riding: { window: { start: '13:00', end: '17:00' } },
    });
    assert.equal(routeEntry(result, route.id).trackedDeparture, undefined);
    assert.equal(
      routeEntry(result, other.id).trackedDeparture?.trackedRideId,
      replacement.ride.id,
    );
    const patch = await h.send(`/tracked-rides/${plan.ride.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        expectedTrackingVersion: plan.trackingVersion,
        alerts: { triggers: all },
      }),
    });
    assert.equal(patch.status, 409);
    assert.equal(
      (await json<{ error: { code: string } }>(patch)).error.code,
      'TRACKING_INACTIVE',
    );
    const db = await h.runtime.getD1Database('ROUTES_DB');
    await db
      .prepare('DELETE FROM routes WHERE owner_id = ? AND id = ?')
      .bind('alice', other.id)
      .run();
    const foreign = await h.send('/recommendations', {
      token: BOB_TOKEN,
      body: JSON.stringify({
        ...settings,
        routeIds: [other.id],
        date: '2026-10-10',
      }),
    });
    assert.equal(foreign.status, 404);
  },
);

for (const cause of ['weather', 'daylight', 'elevation', 'route'] as const) {
  run(
    `an unavailable pin never falls back to a different departure (${cause})`,
    async (h) => {
      const { route, pick, plan } = await seed(h);
      let extra: Record<string, unknown> = {
        riding: { window: { start: '13:00', end: '17:00' } },
      };
      if (cause === 'weather') {
        await clearCache(h);
        h.use(
          metOffice(({ request }) =>
            HttpResponse.json(hourlyForecast(request, { firstHour: 12 })),
          ),
        );
      } else if (cause === 'daylight') {
        await modifyRoute(h, route.id, (r) => ({
          ...r,
          distanceM: r.distanceM * 10,
        }));
      } else if (cause === 'elevation')
        extra = {
          ...extra,
          preferences: { climbing: { preference: 'hillier' } },
        };
      else {
        const db = await h.runtime.getD1Database('ROUTES_DB');
        await db
          .prepare('DELETE FROM routes WHERE owner_id = ? AND id = ?')
          .bind('alice', route.id)
          .run();
      }
      const fixed = routeEntry(await recommend(h, [route.id], extra), route.id);
      assert.equal(fixed.best, null);
      assert.equal(fixed.betterDeparture, null);
      assert.equal(fixed.trackedDeparture?.trackedRideId, plan.ride.id);
      assert.equal(fixed.trackedDeparture.departureAt, pick.departureAt);
      assert.equal(fixed.trackedDeparture.status, 'unavailable');
      assert.equal(
        fixed.trackedDeparture.reasonCode,
        {
          weather: 'forecast_unavailable',
          daylight: 'pinned_departure_no_longer_fits',
          elevation: 'missing_elevation',
          route: 'route_unavailable',
        }[cause],
      );
      assert.ok(['incomplete', 'doesnt_fit'].includes(fixed.verdict.status));
    },
  );
}

run(
  'departed plans do not pin rankings and a request override does not edit saved monitoring inputs',
  async (h) => {
    const { route, pick, plan } = await seed(h);
    const override = {
      riding: { averageSpeedKph: 30, window: { start: '13:00', end: '17:00' } },
    };
    const fixed = routeEntry(
      await recommend(h, [route.id], override),
      route.id,
    );
    assert.ok(fixed.best);
    assert.ok(fixed.best.finishAt < pick.finishAt);
    const detail = await json<Tracked>(
      await h.send(`/tracked-rides/${plan.ride.id}`),
    );
    assert.equal(detail.ride.finishAt, plan.ride.finishAt);
    assert.equal(
      detail.ride.baseline.context.inputs[0]?.riding.averageSpeedKph,
      20,
    );
    await h.restart({ TEST_NOW: pick.departureAt });
    const departed = routeEntry(
      await recommend(h, [route.id], override),
      route.id,
    );
    assert.equal(departed.trackedDeparture, undefined);
    assert.notEqual(departed.best?.departureAt, pick.departureAt);
    const patch = await h.send(`/tracked-rides/${plan.ride.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        expectedTrackingVersion: plan.trackingVersion,
        alerts: { triggers: all },
      }),
    });
    assert.equal(patch.status, 409);
    assert.equal(
      (await json<{ error: { code: string } }>(patch)).error.code,
      'TRACKING_INACTIVE',
    );
  },
);

run(
  'alert PATCH is strict, owner-scoped, retry-safe and preserves baseline and monitoring state',
  async (h) => {
    const { plan } = await seed(h);
    const db = await h.runtime.getD1Database('ROUTES_DB');
    await h.send('/__test/monitor', {
      body: JSON.stringify({ ownerId: 'alice', planId: plan.ride.id }),
    });
    const before = await json<Tracked>(
      await h.send(`/tracked-rides/${plan.ride.id}`),
    );
    const monitor = () =>
      db
        .prepare(
          'SELECT * FROM tracking_monitors WHERE owner_id = ? AND plan_id = ?',
        )
        .bind('alice', plan.ride.id)
        .first();
    const monitorBefore = await monitor();
    const alerts = { triggers: { ...all, rain: false, wind: false } };
    const patch = (body: unknown, token?: string, id = plan.ride.id) =>
      h.send(`/tracked-rides/${id}`, {
        method: 'PATCH',
        token,
        body: JSON.stringify(body),
      });
    const body = { expectedTrackingVersion: before.trackingVersion, alerts };
    for (const invalid of [
      {},
      { ...body, other: true },
      { ...body, expectedTrackingVersion: -1 },
      { ...body, alerts: { triggers: { rain: true } } },
      { ...body, alerts: { triggers: { ...all, cold: 'false' } } },
      { ...body, alerts: { triggers: { ...all, score: true } } },
      {
        ...body,
        alerts: {
          triggers: {
            rain: false,
            wind: false,
            cold: false,
            betterTime: false,
          },
        },
      },
    ]) {
      const r = await patch(invalid);
      assert.equal(r.status, 400);
      assert.equal(
        (await json<{ error: { code: string } }>(r)).error.code,
        'VALIDATION',
      );
    }
    assert.equal((await patch(body, BOB_TOKEN)).status, 404);
    assert.equal(
      (await patch(body, undefined, crypto.randomUUID())).status,
      404,
    );
    const changed = await patch(body);
    assert.equal(changed.status, 200);
    const after = await json<Tracked>(changed);
    assert.deepEqual(after.ride.alerts, alerts);
    assert.equal(after.trackingVersion, before.trackingVersion + 1);
    assert.equal(after.ride.version, before.ride.version + 1);
    assert.equal(after.activeTrackedRideId, plan.ride.id);
    assert.deepEqual(after.ride.baseline, before.ride.baseline);
    assert.deepEqual(after.ride.latestAssessment, before.ride.latestAssessment);
    assert.deepEqual(after.ride.comparison, before.ride.comparison);
    assert.equal(after.ride.departureAt, before.ride.departureAt);
    assert.deepEqual(await monitor(), monitorBefore);
    await h.restart();
    const replay = await patch(body);
    assert.equal(replay.status, 200);
    assert.deepEqual(await json<Tracked>(replay), after);
    const stale = await patch({ ...body, alerts: { triggers: all } });
    assert.equal(stale.status, 409);
    assert.equal(
      (await json<{ error: { code: string } }>(stale)).error.code,
      'TRACKING_VERSION_CONFLICT',
    );
    const listing = await json<{
      capabilities: { fixedDeparture: boolean; alertEdits: boolean };
    }>(await h.send('/tracked-rides'));
    assert.equal(listing.capabilities.fixedDeparture, true);
    assert.equal(listing.capabilities.alertEdits, true);
    assert.equal(after.ride.capabilities.fixedDeparture, true);
    assert.equal(after.ride.capabilities.alertEdits, true);
    await h.send(`/tracked-rides/${plan.ride.id}`, { method: 'DELETE' });
    const stopped = await patch(body);
    assert.equal(stopped.status, 409);
    assert.equal(
      (await json<{ error: { code: string } }>(stopped)).error.code,
      'TRACKING_INACTIVE',
    );
  },
);

run(
  'concurrent alert edits accept only one distinct stale write',
  async (h) => {
    const { plan } = await seed(h);
    const edits = [
      { ...all, rain: false },
      { ...all, cold: false },
    ];
    const results = await Promise.all(
      edits.map((triggers) =>
        h.send(`/tracked-rides/${plan.ride.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            expectedTrackingVersion: plan.trackingVersion,
            alerts: { triggers },
          }),
        }),
      ),
    );
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    const after = await json<Tracked>(
      await h.send(`/tracked-rides/${plan.ride.id}`),
    );
    assert.equal(after.trackingVersion, plan.trackingVersion + 1);
  },
);
