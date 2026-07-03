export type ValhallaEdge = {
  length?: number;
  road_class?: string;
  surface?: string;
  use?: string;
};

export type SurfaceBuckets = {
  busyRoad: number;
  paved: number;
  unpaved: number;
  path: number;
  unknown: number;
};

export type SuggestedType = 'road' | 'gravel' | 'mixed';

const BUSY_ROAD_CLASSES = new Set([
  'motorway',
  'trunk',
  'primary',
  'secondary',
]);
const PAVED_SURFACES = new Set(['paved_smooth', 'paved', 'paved_rough']);
const UNPAVED_SURFACES = new Set(['compacted', 'dirt', 'gravel']);
const PATH_USES = new Set(['cycleway', 'footway', 'path']);

// Priority order: a busy road classification always wins (safety-relevant
// regardless of surface). Dedicated path/cycleway infrastructure is checked
// next — a paved canal towpath or cycleway is "path", not generic "paved",
// because the interesting distinction for a rider is segregated-infra vs
// shared-road, not the tarmac itself. Only then do we fall back to the
// surface texture on ordinary roads, and finally "unknown" for edges
// Valhalla didn't return enough attributes for.
const classifyEdge = (edge: ValhallaEdge): keyof SurfaceBuckets => {
  if (edge.road_class && BUSY_ROAD_CLASSES.has(edge.road_class)) {
    return 'busyRoad';
  }
  if ((edge.use && PATH_USES.has(edge.use)) || edge.surface === 'path') {
    return 'path';
  }
  if (edge.surface && PAVED_SURFACES.has(edge.surface)) {
    return 'paved';
  }
  if (edge.surface && UNPAVED_SURFACES.has(edge.surface)) {
    return 'unpaved';
  }
  return 'unknown';
};

export const aggregateSurfaces = (
  edges: readonly ValhallaEdge[],
): { buckets: SurfaceBuckets; lengthKm: number } => {
  const totals: SurfaceBuckets = {
    busyRoad: 0,
    paved: 0,
    unpaved: 0,
    path: 0,
    unknown: 0,
  };
  let lengthKm = 0;

  for (const edge of edges) {
    const length = edge.length ?? 0;
    lengthKm += length;
    totals[classifyEdge(edge)] += length;
  }

  if (lengthKm === 0) {
    return {
      buckets: { ...totals, unknown: edges.length > 0 ? 1 : 0 },
      lengthKm: 0,
    };
  }

  const buckets = Object.fromEntries(
    Object.entries(totals).map(([key, value]) => [key, value / lengthKm]),
  ) as SurfaceBuckets;

  return { buckets, lengthKm };
};

export const suggestType = (buckets: SurfaceBuckets): SuggestedType => {
  if (buckets.paved + buckets.busyRoad >= 0.9) {
    return 'road';
  }
  if (buckets.unpaved + buckets.path >= 0.35) {
    return 'gravel';
  }
  return 'mixed';
};
