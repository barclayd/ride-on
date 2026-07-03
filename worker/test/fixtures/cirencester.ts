import type { Point } from '../../src/types.ts';

// Synthetic ~5km route anchored near Cirencester, Gloucestershire (51.7189, -1.9694),
// shaped like a real B-road out of town onto a short bridleway loop. Not an
// actual GPX export (no network access to fetch one for this fixture) — good
// enough to exercise decode -> simplify -> classify end to end.
const start: Point = [51.7189, -1.9694];
const points: Point[] = [];

for (let i = 0; i < 40; i++) {
  const t = i / 39;
  points.push([
    start[0] + t * 0.028,
    start[1] + t * 0.021 + Math.sin(t * Math.PI) * 0.004,
  ]);
}
// Short bridleway spur off the end of the road section.
for (let i = 1; i <= 10; i++) {
  const t = i / 10;
  const last = points[points.length - 1] as Point;
  points.push([last[0] + t * 0.006, last[1] - t * 0.004]);
}

export const cirencesterRoute: Point[] = points;

// Plausible mocked Valhalla trace_attributes response for the route above:
// mostly quiet paved B-road with a short unclassified stretch and a gravel
// bridleway spur at the end (~5.3km total).
export const cirencesterValhallaResponse = {
  edges: [
    { road_class: 'secondary', surface: 'paved', use: 'road', length: 1.2 },
    { road_class: 'tertiary', surface: 'paved', use: 'road', length: 1.8 },
    {
      road_class: 'unclassified',
      surface: 'paved_rough',
      use: 'road',
      length: 0.9,
    },
    { road_class: 'unclassified', surface: 'gravel', use: 'road', length: 0.6 },
    { road_class: 'unclassified', surface: 'gravel', use: 'path', length: 0.8 },
  ],
};
