/** Explicit live-weather probe: local Worker/D1/KV and synthetic Taipei routes.
 * Uses CWA_API_KEY and APPLE_WEATHER_CONFIG_JSON from the environment; never prints credentials.
 * Run with Node and --env-file pointing to your ignored .dev.vars file.
 * Calls the live CWA and WeatherKit APIs, so this consumes normal provider quota.
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
const cwaKey = process.env.CWA_API_KEY;
if (!cwaKey?.trim()) throw new Error('CWA_API_KEY is required.');
const now = new Date().toISOString();
const date = Temporal.Instant.from(now)
  .toZonedDateTimeISO('Asia/Taipei')
  .toPlainDate()
  .add({ days: 1 })
  .toString();
const h = await createHarness();
try {
  await h.restart({
    TEST_NOW: now,
    APPLE_WEATHER_CONFIG_JSON: config,
    CWA_API_KEY: cwaKey,
  });
  // These are the only allowed live hosts. Unmatched subrequests fail closed.
  h.use(
    http.get(
      'https://weatherkit.apple.com/api/v1/weather/en/:latitude/:longitude',
      async ({ request }) =>
        fetch(request.url, {
          headers: {
            Authorization: request.headers.get('Authorization') ?? '',
            Accept: 'application/json',
          },
          redirect: 'manual',
          signal: AbortSignal.timeout(15_000),
        }),
    ),
    http.get(
      'https://opendata.cwa.gov.tw/api/v1/rest/datastore/:dataset',
      async ({ request }) =>
        fetch(request.url, {
          headers: {
            Authorization: request.headers.get('Authorization') ?? '',
            Accept: 'application/json',
          },
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
    weatherProviderId: 'automatic',
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
          'Live CWA and Apple forecasts through local production API; synthetic Taipei routes; local storage only',
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
          fieldSources: r.best.forecastDetails.locations
            .flatMap((l) => l.fieldEvidence ?? [])
            .map((e) => ({
              field:
                e.descriptor.kind === 'scalar'
                  ? e.descriptor.measure.quantity
                  : e.descriptor.kind,
              sources: [
                ...new Set(
                  e.sources.map((s) => s.provenance.source.providerId),
                ),
              ],
            })),
        })),
        unranked: result.unranked,
        weather: result.weather.locations.map((l) => ({
          status: l.status,
          issues: l.issues,
          fields: l.fieldEvidence?.map((e) => ({
            descriptor: e.descriptor,
            sources: [
              ...new Set(e.sources.map((s) => s.provenance.source.providerId)),
            ],
            methods: [...new Set(e.sources.map((s) => s.method))],
          })),
        })),
      },
      null,
      2,
    ),
  );
  assert.equal(result.rankings.length, 2, 'Both routes must be assessable.');
  assert.ok(result.rankings.every((r) => r.departuresUnknown === 0));
  assert.equal(result.weather.selectedSource?.providerId, 'taiwan-weather');
  assert.equal(h.requests.length, calls);
  for (const route of result.rankings) {
    const evidence = route.best.forecastDetails.locations.flatMap(
      (l) => l.fieldEvidence ?? [],
    );
    for (const [quantity, source] of [
      ['air-temperature', 'cwa'],
      ['wind-speed', 'cwa'],
      ['wind-gust', 'apple-weather'],
      ['precipitation-rate', 'apple-weather'],
    ])
      assert.ok(
        evidence.some(
          (e) =>
            e.descriptor.kind === 'scalar' &&
            e.descriptor.measure.quantity === quantity &&
            e.sources.some((s) => s.provenance.source.providerId === source),
        ),
        `Missing ${source} ${quantity} evidence during the ride.`,
      );
  }
} finally {
  await h.dispose();
}
