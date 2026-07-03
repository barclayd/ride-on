import type { Context } from 'hono';
import { z } from 'zod';
import { CACHE_TTL_SECONDS, hashCoordinates } from './cache.ts';
import { AppError } from './errors.ts';
import { isValidLatLon, totalLengthKm } from './geo.ts';
import { decodePolyline } from './polyline.ts';
import { readJsonBody } from './request.ts';
import { simplifyToMax } from './simplify.ts';
import type {
  SuggestedType,
  SurfaceBuckets,
  ValhallaEdge,
} from './surfaces.ts';
import { aggregateSurfaces, suggestType } from './surfaces.ts';
import type { Bindings, Point } from './types.ts';

const MAX_POINTS = 50_000;
const MAX_ROUTE_KM = 400;
const MAX_SIMPLIFIED_POINTS = 500;
const VALHALLA_URL = 'https://valhalla1.openstreetmap.de/trace_attributes';
const VALHALLA_TIMEOUT_MS = 25_000;

type ClassifyResponse = {
  surfaces: SurfaceBuckets;
  suggestedType: SuggestedType;
  lengthKm: number;
  source: 'valhalla';
  cacheHit: boolean;
};

const classifyBodySchema = z.union(
  [
    z.object({
      coordinates: z
        .array(
          z
            .tuple([z.number(), z.number()])
            .refine(isValidLatLon, 'must be a valid [lat, lon] pair'),
        )
        .min(1),
    }),
    z.object({ polyline: z.string().min(1) }),
  ],
  'Request must include either "polyline" or "coordinates"',
);

const extractCoordinates = (
  body: z.output<typeof classifyBodySchema>,
): Point[] => {
  if ('coordinates' in body) {
    return body.coordinates;
  }

  let points: Point[];
  try {
    points = decodePolyline(body.polyline);
  } catch {
    throw new AppError(400, 'BAD_REQUEST', '"polyline" could not be decoded');
  }
  if (points.length === 0 || !points.every(isValidLatLon)) {
    throw new AppError(400, 'BAD_REQUEST', '"polyline" could not be decoded');
  }
  return points;
};

const callValhalla = async (
  points: readonly Point[],
): Promise<{ edges?: ValhallaEdge[] }> => {
  const body = {
    shape: points.map(([lat, lon]) => ({ lat, lon })),
    costing: 'bicycle',
    shape_match: 'map_snap',
    filters: {
      attributes: [
        'edge.surface',
        'edge.road_class',
        'edge.length',
        'edge.use',
      ],
      action: 'include',
    },
  };

  let response: Response;
  try {
    response = await fetch(VALHALLA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(VALHALLA_TIMEOUT_MS),
    });
  } catch {
    throw new AppError(
      503,
      'UPSTREAM_UNAVAILABLE',
      'Valhalla request failed or timed out',
    );
  }

  if (response.status === 429 || response.status >= 500) {
    const retryAfter = response.headers.get('Retry-After') ?? '30';
    throw new AppError(
      503,
      'UPSTREAM_UNAVAILABLE',
      'Valhalla is temporarily unavailable, try again shortly',
      { 'Retry-After': retryAfter },
    );
  }

  if (!response.ok) {
    throw new AppError(
      502,
      'UPSTREAM_ERROR',
      `Valhalla returned an unexpected error (${response.status})`,
    );
  }

  return (await response.json()) as { edges?: ValhallaEdge[] };
};

export const classifyHandler = async (c: Context<Bindings>) => {
  const body = await readJsonBody(c, classifyBodySchema);
  const points = extractCoordinates(body);

  if (points.length > MAX_POINTS) {
    throw new AppError(
      400,
      'TOO_MANY_POINTS',
      `Route has ${points.length} points, the max is ${MAX_POINTS}`,
    );
  }

  const routeLengthKm = totalLengthKm(points);
  if (routeLengthKm > MAX_ROUTE_KM) {
    throw new AppError(
      400,
      'ROUTE_TOO_LONG',
      `Route is ${routeLengthKm.toFixed(1)}km, the max is ${MAX_ROUTE_KM}km`,
    );
  }

  const simplified = simplifyToMax(points, MAX_SIMPLIFIED_POINTS);
  const cacheKey = await hashCoordinates(simplified);

  const cached = await c.env.CLASSIFY_CACHE.get<ClassifyResponse>(
    cacheKey,
    'json',
  );
  if (cached) {
    return c.json({ ...cached, cacheHit: true });
  }

  const valhallaResponse = await callValhalla(simplified);
  const { buckets, lengthKm } = aggregateSurfaces(valhallaResponse.edges ?? []);

  const result: ClassifyResponse = {
    surfaces: buckets,
    suggestedType: suggestType(buckets),
    lengthKm,
    source: 'valhalla',
    cacheHit: false,
  };

  await c.env.CLASSIFY_CACHE.put(cacheKey, JSON.stringify(result), {
    expirationTtl: CACHE_TTL_SECONDS,
  });

  return c.json(result);
};
