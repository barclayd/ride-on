import { AppError } from '../errors.ts';
import { routeSchema } from './model.ts';
import {
  type RouteSource,
  type RouteSourceProvider,
  routeSourceSchema,
} from './sources.ts';
import type { RouteRecord, RouteStore } from './store.ts';

const conflict = () =>
  new AppError(
    409,
    'ROUTE_VERSION_CONFLICT',
    'This source route already exists or has changed. Read GET /routes filtered by its source and retry with the current version.',
  );

export const importSourceRoute = async (
  input: {
    ownerId: string;
    source: RouteSource;
    gpx: string;
    name?: string;
    expectedVersion?: number;
    importedAt: string;
  },
  provider: RouteSourceProvider,
  store: Pick<RouteStore, 'findSource' | 'createImported' | 'replaceImported'>,
): Promise<{
  outcome: 'created' | 'updated' | 'unchanged';
  record: RouteRecord;
}> => {
  const source = routeSourceSchema.parse({
    providerId: provider.descriptor.id,
    externalId: provider.normalizeExternalId(input.source.externalId),
  });
  const route = routeSchema.parse(
    await provider.importRoute({
      externalId: source.externalId,
      gpx: input.gpx,
      name: input.name,
      importedAt: input.importedAt,
    }),
  );
  const current = await store.findSource(input.ownerId, source);
  if (!current) {
    if (input.expectedVersion !== undefined) throw conflict();
    const record: RouteRecord = {
      route,
      source,
      version: 1,
      updatedAt: input.importedAt,
    };
    if (await store.createImported(input.ownerId, record))
      return { outcome: 'created', record };
    // A simultaneous first import won the unique source constraint. Identical retries are safe.
    const winner = await store.findSource(input.ownerId, source);
    if (
      winner?.route.sourceHash === route.sourceHash &&
      winner.route.name === route.name
    )
      return { outcome: 'unchanged', record: winner };
    throw conflict();
  }
  if (
    input.expectedVersion !== undefined &&
    input.expectedVersion !== current.version
  )
    throw conflict();
  if (
    current.route.sourceHash === route.sourceHash &&
    current.route.name === route.name
  )
    return { outcome: 'unchanged', record: current };
  if (input.expectedVersion === undefined) throw conflict();
  const record: RouteRecord = {
    route: {
      ...route,
      id: current.route.id,
      createdAt: current.route.createdAt,
    },
    source,
    version: current.version + 1,
    updatedAt: input.importedAt,
  };
  if (
    !(await store.replaceImported(input.ownerId, record, input.expectedVersion))
  )
    throw conflict();
  return { outcome: 'updated', record };
};
