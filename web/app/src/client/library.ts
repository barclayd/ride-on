import type { LibraryGeometry, Line } from '../geometry.ts';
import { cachedLines, saveLines } from './geometry-cache.ts';

export type LibraryRoute = {
  id: string;
  name: string;
  version: number;
  distanceM: number;
  ascentM: number;
  geometryStatus: 'available' | 'unavailable';
  createdAt: string;
  /** Where it was imported from; null for a GPX upload. */
  source: { providerId: string; externalId: string } | null;
  surfaceSummary: { unpavedFraction: number | null } | null;
};
export type Selection = { version: number; routeIds: string[] };
export type Library = {
  routes: LibraryRoute[];
  /** Shortlisted route ids, in the rider's order. */
  shortlist: string[];
  /** The selection's version, for the next write's `expectedVersion`. */
  version: number;
  /** Each route's line by route id. */
  lines: Map<string, Line>;
};

// Each geometry request stays well under the BFF's 100-route cap and a sensible URL length.
const chunk = 50;

/** A BFF call. SPEC §7.8: an expired session goes back to sign-in, then here. */
export const api = async (path: string, init: RequestInit = {}) => {
  const response = await fetch(path, init);
  if (response.status === 401)
    location.assign(
      `/sign-in?next=${encodeURIComponent(location.pathname + location.search)}`,
    );
  return response;
};

export const get = async <T>(path: string, signal?: AbortSignal) => {
  const response = await api(path, { signal });
  if (!response.ok) throw new Error(`${path} answered ${response.status}`);
  return (await response.json()) as T;
};

const allRoutes = async (signal?: AbortSignal) => {
  const routes: LibraryRoute[] = [];
  let cursor: string | null = null;
  do {
    const page: { routes: LibraryRoute[]; nextCursor: string | null } =
      await get(
        `/api/routes?limit=100${cursor ? `&cursor=${cursor}` : ''}`,
        signal,
      );
    routes.push(...page.routes);
    cursor = page.nextCursor;
  } while (cursor);
  return routes;
};

/** The rider's library, shortlist and lines: cached lines first, the rest from the BFF. */
export const loadLibrary = async (signal?: AbortSignal): Promise<Library> => {
  const [routes, { selection }] = await Promise.all([
    allRoutes(signal),
    get<{ selection: Selection }>('/api/route-selection', signal),
  ]);
  const keys = new Map(
    routes
      .filter((route) => route.geometryStatus === 'available')
      .map((route) => [route.id, `${route.id}@${route.version}`]),
  );
  const cached = await cachedLines([...keys.values()]).catch(
    () => new Map<string, Line>(),
  );
  const missing = [...keys].filter(([, key]) => !cached.has(key));
  const fetched = new Map<string, Line>();
  await Promise.all(
    Array.from({ length: Math.ceil(missing.length / chunk) }, async (_, i) => {
      const ids = missing.slice(i * chunk, (i + 1) * chunk).map(([id]) => id);
      const { features }: LibraryGeometry = await get(
        `/api/library-geometry?ids=${ids.join(',')}`,
        signal,
      );
      for (const feature of features)
        fetched.set(feature.id, feature.geometry.coordinates);
    }),
  );
  if (fetched.size) await saveLines(fetched).catch(() => {});
  const lines = new Map<string, Line>();
  for (const [key, line] of [...cached, ...fetched])
    lines.set(key.slice(0, key.lastIndexOf('@')), line);
  const ids = new Set(routes.map((route) => route.id));
  return {
    routes,
    shortlist: selection.routeIds.filter((id) => ids.has(id)),
    version: selection.version,
    lines,
  };
};
