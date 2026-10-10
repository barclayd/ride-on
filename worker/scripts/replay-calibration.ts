/** Offline only: no credentials, server or new forecasts. See docs/api.md. */
import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { recommendRides } from '../src/recommendations/engine.ts';
import { recommendationSchema } from '../src/recommendations/input.ts';
import { importGpx } from '../src/routes/gpx.ts';
import { cachedForecastSchema } from '../src/weather/cache.ts';

const [directory, originalPath, snapshotPath, profilePath, outputPath] =
  Bun.argv.slice(2);
if (!directory || !originalPath || !snapshotPath || !profilePath || !outputPath)
  throw new Error(
    'Supply GPX_DIRECTORY BASELINE_REPORT SNAPSHOT PROFILE OUTPUT-live-check.json.',
  );
if (
  !outputPath.endsWith('-live-check.json') ||
  [originalPath, snapshotPath, profilePath].some(
    (path) => resolve(path) === resolve(outputPath),
  )
)
  throw new Error(
    'Use a separate ignored output file ending in -live-check.json.',
  );
const candidateSchema = z.object({
  departureAt: z.iso.datetime(),
  score: z.number(),
});
const rankingSchema = z.object({
  routeId: z.uuid(),
  routeName: z.string(),
  sourceHash: z.string(),
  best: candidateSchema,
  alternatives: z.array(candidateSchema),
  departuresAssessed: z.number(),
  departuresUnknown: z.number(),
});
const original = z
  .object({
    checkedAt: z.iso.datetime(),
    request: recommendationSchema,
    response: z.object({ rankings: z.array(rankingSchema).min(1) }),
    offlineReplay: z
      .object({ evaluation: z.object({ rankings: z.array(rankingSchema) }) })
      .optional(),
  })
  .parse(JSON.parse(await Bun.file(originalPath).text()));
const snapshot = z
  .object({
    capturedAt: z.iso.datetime(),
    forecasts: z.array(cachedForecastSchema).min(1),
  })
  .parse(JSON.parse(await Bun.file(snapshotPath).text()));
const profile = z
  .object({ request: z.object({ preferences: z.unknown() }) })
  .parse(JSON.parse(await Bun.file(profilePath).text()));
// Only preferences are varied. The saved source, statistics, day and clock are retained.
const input = recommendationSchema.parse({
  ...original.request,
  preferences: profile.request.preferences,
});
const expected = new Map(
  original.response.rankings.map((r) => [r.sourceHash, r]),
);
if (
  expected.size !== original.request.routeIds.length ||
  original.response.rankings.some(
    (r) => !original.request.routeIds.includes(r.routeId),
  )
)
  throw new Error(
    'The original report must contain one assessed route for every requested ID.',
  );
const routes = await Promise.all(
  (await readdir(directory))
    .filter((f) => f.toLowerCase().endsWith('.gpx'))
    .sort()
    .map(async (file) => {
      const route = await importGpx(
        await Bun.file(join(directory, file)).text(),
      );
      const previous = expected.get(route.sourceHash);
      if (!previous)
        throw new Error('A GPX file does not match the original report.');
      const ids = new Map(
        route.weatherLocations.map((location, index) => [
          location.id,
          `${previous.routeId}:replay:${index}`,
        ]),
      );
      const rebind = (id: string) => {
        const value = ids.get(id);
        if (!value) throw new Error('Route weather location is missing.');
        return value;
      };
      return {
        ...route,
        id: previous.routeId,
        name: previous.routeName,
        legs: route.legs.map((leg) => ({
          ...leg,
          weatherLocationId: rebind(leg.weatherLocationId),
        })),
        weatherLocations: route.weatherLocations.map((location) => ({
          ...location,
          id: rebind(location.id),
        })),
      };
    }),
);
if (
  routes.length !== expected.size ||
  new Set(routes.map((r) => r.id)).size !== expected.size
)
  throw new Error(
    'The GPX directory must contain exactly the original route set.',
  );
const coordinateKey = (c: { latitude: number; longitude: number }) =>
  `${c.latitude},${c.longitude}`;
const captured = new Map(
  snapshot.forecasts.map((f) => [
    coordinateKey(f.location.requested.coordinate),
    f,
  ]),
);
if (captured.size !== snapshot.forecasts.length)
  throw new Error('Snapshot contains ambiguous duplicate locations.');
const allowedProviders =
  original.request.weather.mode === 'strict'
    ? [original.request.weather.providerId]
    : original.request.weather.providerIds;
if (
  snapshot.forecasts.some(
    (f) => !allowedProviders.includes(f.provenance.source.providerId),
  ) ||
  new Set(snapshot.forecasts.map((f) => JSON.stringify(f.provenance.source)))
    .size !== 1
)
  throw new Error(
    'Snapshot source is inconsistent with the original provider policy.',
  );
const forecasts = routes.flatMap((route) =>
  route.weatherLocations.map((location) => {
    const forecast = captured.get(coordinateKey(location.coordinate));
    if (!forecast) throw new Error('A route location has no saved forecast.');
    return {
      ...forecast,
      location: { ...forecast.location, requested: location },
    };
  }),
);
const clock = Date.parse(original.checkedAt);
const baseline = recommendRides(
  routes,
  original.request,
  forecasts,
  clock,
  10_000,
  100,
);
const priorRankings =
  original.offlineReplay?.evaluation.rankings ?? original.response.rankings;
if (priorRankings.length !== baseline.rankings.length)
  throw new Error('Baseline route coverage does not reproduce.');
for (const [index, expectedRide] of priorRankings.entries()) {
  const actual = baseline.rankings[index];
  if (
    !actual ||
    actual.routeId !== expectedRide.routeId ||
    actual.best?.departureAt !== expectedRide.best.departureAt ||
    actual.best.score !== expectedRide.best.score ||
    actual.departuresAssessed !== expectedRide.departuresAssessed ||
    actual.departuresUnknown !== expectedRide.departuresUnknown
  )
    throw new Error(
      'Baseline replay differs; investigate before attributing changes to preferences.',
    );
  const candidates = [actual.best, ...actual.alternatives];
  if (
    expectedRide.alternatives.some(
      (old) =>
        !candidates.some(
          (c) => c?.departureAt === old.departureAt && c.score === old.score,
        ),
    )
  )
    throw new Error(
      'A saved alternative does not reproduce under the baseline preferences.',
    );
}
const calibrated = recommendRides(routes, input, forecasts, clock, 10_000, 100);
const comparison = calibrated.rankings.map((ride) => {
  const previous = baseline.rankings.find((r) => r.routeId === ride.routeId);
  if (!previous) throw new Error('Route disappeared from baseline.');
  return {
    routeName: ride.routeName,
    routeId: ride.routeId,
    before: {
      rank: previous.rank,
      score: previous.best?.score,
      departureAt: previous.best?.departureAt,
    },
    after: {
      rank: ride.rank,
      score: ride.best?.score,
      departureAt: ride.best?.departureAt,
    },
  };
});
await Bun.write(
  outputPath,
  `${JSON.stringify(
    {
      evaluatedAt: new Date().toISOString(),
      evaluationMode: 'offline-saved-forecast',
      forecastCapturedAt: snapshot.capturedAt,
      originalCheckedAt: original.checkedAt,
      baselineReproduced: true,
      routeHashesMatched: true,
      weatherRequests: 0,
      sourcePolicy: original.request.weather,
      forecast: original.request.forecast,
      note: 'Only profile preferences changed. This is a replay of saved evidence, not a fresh forecast or new HTTP call. Scores remain provisional; no minimum standards were inferred.',
      request: input,
      baseline,
      calibrated,
      comparison,
    },
    null,
    2,
  )}\n`,
);
console.log(
  JSON.stringify(
    {
      baselineReproduced: true,
      weatherRequests: 0,
      candidatesAssessed: calibrated.rankings.reduce(
        (n, r) => n + r.departuresAssessed,
        0,
      ),
      candidatesUnknown: [
        ...calibrated.rankings,
        ...calibrated.unranked,
      ].reduce((n, r) => n + r.departuresUnknown, 0),
      unrankedRoutes: calibrated.unranked.length,
      comparison,
    },
    null,
    2,
  ),
);
