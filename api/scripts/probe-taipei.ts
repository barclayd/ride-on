/** Explicit live-weather probe: local Worker/D1/KV and synthetic Taipei routes.
 * Uses APPLE_WEATHER_CONFIG_JSON from the environment; never prints credentials.
 * Run with Node and --env-file pointing to your ignored .dev.vars file.
 * Calls the live WeatherKit API, so this consumes normal provider quota.
 */
import assert from 'node:assert/strict';
import { Temporal } from '@js-temporal/polyfill';
import { http } from 'msw/http';
import { z } from 'zod';
import { recommend } from '../integration/client.ts';
import { createHarness } from '../integration/harness.ts';
import { taipeiGpx, taipeiRoutes } from '../test/fixtures/taipei.ts';

const config = process.env.APPLE_WEATHER_CONFIG_JSON;
if (!config?.trim()) throw new Error('APPLE_WEATHER_CONFIG_JSON is required.');
const now = new Date().toISOString();
const date = Temporal.Instant.from(now)
  .toZonedDateTimeISO('Asia/Taipei')
  .toPlainDate()
  .add({ days: 1 })
  .toString();
const h = await createHarness();
try {
  await h.restart({ TEST_NOW: now, APPLE_WEATHER_CONFIG_JSON: config });
  // This is the only allowed live host. Unmatched subrequests fail closed.
  h.use(
    http.get(
      'https://weatherkit.apple.com/api/v1/weather/en/:latitude/:longitude',
      async ({ request }) =>
        fetch(request.url, {
          headers: request.headers,
          redirect: 'manual',
          signal: AbortSignal.timeout(15_000),
        }),
    ),
  );
  const routes: { id: string; name: string }[] = [];
  for (const fixture of taipeiRoutes) {
    const response = await h.send('/routes', {
      contentType: 'application/gpx+xml',
      body: taipeiGpx(fixture),
    });
    assert.equal(response.status, 201);
    routes.push(
      z
        .object({ route: z.object({ id: z.uuid(), name: z.string() }) })
        .parse(await response.json()).route,
    );
  }
  const ids = routes.map((r) => r.id);
  const settings = {
    date,
    timeZone: 'Asia/Taipei',
    riding: { window: { start: '06:30', end: '14:00' } },
  };
  const result = await recommend(h, ids, settings);
  const calls = h.requests.length;
  await h.restart();
  const cached = await recommend(h, ids, settings);
  assert.deepEqual(cached.rankings, result.rankings);
  assert.deepEqual(h.unexpected, []);
  assert.deepEqual(h.handlerErrors, []);
  const localTime = (iso: string) =>
    Temporal.Instant.from(iso)
      .toZonedDateTimeISO('Asia/Taipei')
      .toPlainTime()
      .toString();
  console.log(
    JSON.stringify(
      {
        scope:
          'Live Apple forecasts through local production API; synthetic Taipei routes; no CWA score or production writes',
        generatedAt: now,
        date,
        timeZone: result.timeZone,
        algorithmVersion: result.algorithmVersion,
        source: result.weather.selectedSource,
        upstreamCalls: calls,
        cacheReusedAfterRestart: h.requests.length === calls,
        recommendedRoute:
          routes.find((r) => r.id === result.recommendedRouteId)?.name ?? null,
        rankings: result.rankings.map((r) => ({
          name: routes.find((route) => route.id === r.routeId)?.name,
          distanceKm: Math.round(r.distanceM / 10) / 100,
          score: r.best.score,
          departureLocal: localTime(r.best.departureAt),
          finishLocal: localTime(r.best.finishAt),
          daylightLocal: {
            start: localTime(r.daylight.start),
            end: localTime(r.daylight.end),
          },
          departuresAssessed: r.departuresAssessed,
          departuresUnknown: r.departuresUnknown,
          conditions: r.best.conditions,
          drawbacks: r.best.drawbacks,
        })),
        unranked: result.unranked,
        weather: result.weather.locations.map((l) => ({
          status: l.status,
          issues: l.issues,
        })),
      },
      null,
      2,
    ),
  );
  assert.equal(result.rankings.length, 2, 'Both routes must be assessable.');
  assert.ok(result.rankings.every((r) => r.departuresUnknown === 0));
  assert.equal(result.weather.selectedSource?.providerId, 'apple-weather');
  assert.equal(h.requests.length, calls);
} finally {
  await h.dispose();
}
