/** Explicit local benchmark. Synthetic GPX, ephemeral credentials and MSW only; no live quota. */
import { performance } from 'node:perf_hooks';
import { exportPKCS8, generateKeyPair } from 'jose';
import { HttpResponse, http } from 'msw/http';
import { z } from 'zod';
import { createHarness } from '../integration/harness.ts';
import { appleWeatherFixture } from '../test/fixtures/apple-weather.ts';

const h = await createHarness();
try {
  const keys = await generateKeyPair('ES256', { extractable: true });
  await h.restart({
    APPLE_WEATHER_CONFIG_JSON: JSON.stringify({
      teamId: 'TESTTEAM01',
      keyId: 'TESTKEY001',
      serviceId: 'cc.ride-on.benchmark',
      privateKey: await exportPKCS8(keys.privateKey),
    }),
  });
  h.use(
    http.get(
      'https://weatherkit.apple.com/api/v1/weather/en/:latitude/:longitude',
      ({ params }) =>
        HttpResponse.json(
          appleWeatherFixture({
            latitude: Number(params.latitude),
            longitude: Number(params.longitude),
            start: '2026-10-09T11:00:00Z',
            hours: 240,
          }),
        ),
    ),
  );
  const routeIds: string[] = [];
  for (let r = 0; r < 12; r++) {
    const points = Array.from(
      { length: 201 },
      (_, p) =>
        `<trkpt lat="${51.2 + p * 0.0045}" lon="${-1 + r * 0.005}"><ele>${50 + 10 * Math.sin(p / 10)}</ele></trkpt>`,
    ).join('');
    const res = await h.send('/routes', {
      contentType: 'application/gpx+xml',
      body: `<gpx version="1.1"><trk><name>Synthetic ${r}</name><trkseg>${points}</trkseg></trk></gpx>`,
    });
    if (res.status !== 201) throw new Error('Synthetic route import failed.');
    routeIds.push(
      z.object({ route: z.object({ id: z.string() }) }).parse(await res.json())
        .route.id,
    );
  }
  const measurements = [];
  for (const state of ['cold', 'warm'] as const) {
    const count = h.requests.length;
    const started = performance.now();
    const res = await h.send('/recommendations', {
      body: JSON.stringify({
        routeIds,
        days: { kind: 'range', start: '2026-10-10', end: '2026-10-14' },
        preferences: {
          climbing: { preference: 'flatter' },
          distance: { minKm: 80, maxKm: 120 },
        },
      }),
    });
    const body = await res.text();
    const durationMs = performance.now() - started;
    if (res.status !== 200) throw new Error(`Benchmark failed: ${res.status}`);
    const data = z
      .object({
        rankings: z.array(z.object({ departuresTested: z.number() })),
        days: z.array(z.unknown()),
      })
      .parse(JSON.parse(body));
    measurements.push({
      state,
      durationMs: Math.round(durationMs),
      upstreamCalls: h.requests.length - count,
      responseBytes: Buffer.byteLength(body),
      rankedRoutes: data.rankings.length,
      days: data.days.length,
      departureCandidates: data.rankings.reduce(
        (n, r) => n + r.departuresTested,
        0,
      ),
    });
  }
  if (h.unexpected.length || h.handlerErrors.length)
    throw new Error('Unexpected benchmark HTTP request.');
  console.log(
    JSON.stringify(
      {
        scope:
          'Local real Worker/D1/KV; mocked upstream; end-to-end wall time, not production CPU or network latency',
        routeDistanceKm: 100,
        routePoints: 201,
        measurements,
      },
      null,
      2,
    ),
  );
} finally {
  await h.dispose();
}
