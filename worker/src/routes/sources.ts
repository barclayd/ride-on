import { z } from 'zod';
import { validateInput } from '../request.ts';
import { importGpx } from './gpx.ts';
import type { Route } from './model.ts';

export const routeSourceSchema = z.strictObject({
  providerId: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  externalId: z.string().min(1).max(200),
});
export type RouteSource = z.infer<typeof routeSourceSchema>;
export const importRouteSchema = z.strictObject({
  source: routeSourceSchema,
  gpx: z.string().min(1).max(5_000_000),
  name: z.string().trim().min(1).max(160).optional(),
  expectedVersion: z
    .number()
    .int()
    .positive()
    .max(Number.MAX_SAFE_INTEGER - 1)
    .optional(),
});

/** Source adapters own source identifiers and input formats, never ranking or persistence. */
export type RouteSourceProvider = Readonly<{
  descriptor: Readonly<{
    id: string;
    name: string;
    importModes: readonly ['gpx-upload'];
    accountConnection: false;
  }>;
  normalizeExternalId: (externalId: string) => string;
  importRoute: (
    input: Readonly<{
      externalId: string;
      gpx: string;
      name?: string;
      importedAt: string;
    }>,
  ) => Promise<Route>;
}>;

// Keep IDs as strings: Strava route IDs can exceed JavaScript's safe integer range.
const numericId = z
  .string()
  .regex(
    /^[1-9][0-9]{0,39}$/,
    'Use the saved route/course ID as a decimal string, not its URL.',
  );
const gpxSource = (id: string, name: string): RouteSourceProvider => ({
  descriptor: {
    id,
    name,
    importModes: ['gpx-upload'],
    accountConnection: false,
  },
  normalizeExternalId: (value) => validateInput(numericId, value),
  importRoute: (input) => importGpx(input.gpx, input.name, input.importedAt),
});

/** GPX exported by the user/client; these adapters do not sign in to external accounts. */
export const routeSourceProviders: ReadonlyMap<string, RouteSourceProvider> =
  new Map([
    ['cycle-travel', gpxSource('cycle-travel', 'Cycle.travel')],
    ['garmin', gpxSource('garmin', 'Garmin Connect')],
    ['strava', gpxSource('strava', 'Strava')],
  ]);
