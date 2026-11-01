/** Explicit live check: run with bun scripts/evaluate-local.ts GPX_DIRECTORY YYYY-MM-DD REPORT_PATH [--reuse]. */
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

const [directory, date, output, reuse] = Bun.argv.slice(2);
if (!directory || !date || !output || !z.iso.date().safeParse(date).success)
  throw new Error('Supply GPX directory, YYYY-MM-DD and report path.');
const session = z
  .object({ token: z.string().min(32), expiresAt: z.iso.datetime() })
  .parse(
    JSON.parse(
      await Bun.file(new URL('../.local-session.json', import.meta.url)).text(),
    ),
  );
if (Date.parse(session.expiresAt) <= Date.now())
  throw new Error('Local session expired. Run bun run dev:session again.');
const headers = { Authorization: `Bearer ${session.token}` };
const baseUrl = 'http://localhost:8787';
const jsonResponse = async (response: Response) => {
  if (!response.ok)
    throw new Error(
      `Local API returned HTTP ${response.status}: ${await response.text()}`,
    );
  return response.json();
};
const uploads: unknown[] = [];
const routeIds: string[] = [];
let previousTiming: unknown;
if (reuse === '--reuse') {
  const previous = z
    .object({
      request: z.object({ routeIds: z.array(z.uuid()) }),
      uploads: z.array(z.unknown()).default([]),
      firstRequestMs: z.number(),
      repeatedMedianMs: z.number().optional(),
      repeatedP95Ms: z.number().optional(),
      baselineBeforeLookupOptimization: z.unknown().optional(),
    })
    .parse(JSON.parse(await Bun.file(output).text()));
  routeIds.push(...previous.request.routeIds);
  uploads.push(...previous.uploads);
  previousTiming = previous.baselineBeforeLookupOptimization ?? {
    firstRequestMs: previous.firstRequestMs,
    repeatedMedianMs: previous.repeatedMedianMs,
    repeatedP95Ms: previous.repeatedP95Ms,
  };
} else {
  for (const name of (await readdir(directory))
    .filter((name) => name.toLowerCase().endsWith('.gpx'))
    .sort()) {
    const response = await fetch(`${baseUrl}/routes`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/gpx+xml' },
      body: Bun.file(join(directory, name)),
    });
    const data = z
      .object({ route: z.object({ id: z.uuid() }).passthrough() })
      .parse(await jsonResponse(response));
    routeIds.push(data.route.id);
    uploads.push({ file: name, ...data.route });
  }
}
const request = {
  routeIds,
  date,
  timeZone: 'Europe/London',
  riding: { averageSpeedKph: 20, window: 'daylight' },
  weather: { mode: 'strict', providerId: 'met-office' },
};
const run = async () => {
  const start = performance.now();
  const response = await fetch(`${baseUrl}/recommendations`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  const result = (await jsonResponse(response)) as Record<string, unknown>;
  return {
    milliseconds: Math.round((performance.now() - start) * 100) / 100,
    result,
  };
};
const first = await run();
const timings: number[] = [];
const cacheObservations: unknown[] = [];
for (let index = 0; first.result.recommendedRouteId && index < 10; index++) {
  const sample = await run();
  timings.push(sample.milliseconds);
  cacheObservations.push(
    z
      .object({
        weather: z.object({
          cache: z.object({ hits: z.number(), misses: z.number() }),
        }),
      })
      .parse(sample.result).weather.cache,
  );
}
const ordered = [...timings].sort((a, b) => a - b);
const report = {
  checkedAt: new Date().toISOString(),
  environment:
    'Local Cloudflare Workers runtime with local D1/KV and live Met Office forecasts. These timings are not deployed latency benchmarks.',
  request,
  uploads,
  baselineBeforeLookupOptimization: previousTiming,
  firstRequestMs: first.milliseconds,
  repeatedRequestTimingsMs: timings,
  repeatedMedianMs: ordered[4],
  repeatedP95Ms: ordered[9],
  repeatedCacheObservations: cacheObservations,
  response: first.result,
};
await Bun.write(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(
  JSON.stringify({
    routes: routeIds.length,
    firstRequestMs: report.firstRequestMs,
    repeatedMedianMs: report.repeatedMedianMs,
    repeatedP95Ms: report.repeatedP95Ms,
    cache: cacheObservations,
    recommendedRouteId: first.result.recommendedRouteId,
    output,
  }),
);
