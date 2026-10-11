// Local synthetic benchmark only: no network, credentials or personal routes.
import { performance } from 'node:perf_hooks';
import { encodeGeometry } from '../src/rides/geometry.ts';
import { prepareHistory } from '../src/rides/overlap.ts';
import type { HistorySnapshot } from '../src/rides/store.ts';
import { importGpx } from '../src/routes/gpx.ts';

const base = await importGpx(
  '<gpx version="1.1"><trk><trkseg><trkpt lat="51" lon="-1"/><trkpt lat="51.002" lon="-1"/></trkseg></trk></gpx>',
);
const routes = Array.from({ length: 12 }, (_, routeIndex) => ({
  ...base,
  id: crypto.randomUUID(),
  sourceHash: `synthetic-${routeIndex}`,
  distanceM: 100_000,
  geometry: encodeGeometry(
    Array.from({ length: 9001 }, (_, i) => ({
      latitude: 50.5 + i * 0.0001,
      longitude:
        -1 + routeIndex * 0.001 * Math.min(1, Math.max(0, (i - 1800) / 100)),
    })),
  ),
}));
const snapshot: HistorySnapshot = {
  revision: 28,
  limited: false,
  entries: Array.from({ length: 28 }, (_, i) => ({
    id: crypto.randomUUID(),
    sourceHash: `synthetic-${i % 8}`,
    riddenOn: `2026-10-${String(1 + (i % 9)).padStart(2, '0')}`,
    timeZone: 'Europe/London',
  })),
  geometries: new Map(
    routes.flatMap((r) =>
      r.geometry ? [[r.sourceHash, r.geometry] as const] : [],
    ),
  ),
};
const start = performance.now();
const history = prepareHistory(
  routes,
  { mode: 'prefer-variety', lookbackDays: 28 },
  snapshot,
  '2026-10-10T07:00:00Z',
  '2026-10-14T17:00:00Z',
);
const prepared = performance.now();
let assessments = 0;
for (let day = 10; day <= 14; day++)
  for (const route of routes)
    for (let hour = 7; hour <= 17; hour++) {
      history.assess(
        route.id,
        `2026-10-${day}T${String(hour).padStart(2, '0')}:00:00Z`,
      );
      assessments++;
    }
console.log(
  JSON.stringify({
    scope: 'local synthetic wall-clock, not production CPU',
    routes: routes.length,
    routeKm: 100,
    historyEvents: snapshot.entries.length,
    uniqueHistoricalPaths: 8,
    departureAssessments: assessments,
    status: history.status,
    preparationMs: Math.round(prepared - start),
    totalMs: Math.round(performance.now() - start),
  }),
);
if (history.status !== 'assessed')
  throw new Error('Benchmark exceeded supported assessment limits');
