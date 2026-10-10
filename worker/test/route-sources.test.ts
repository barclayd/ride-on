import { expect, test } from 'bun:test';
import { importGpx } from '../src/routes/gpx.ts';
import { importSourceRoute } from '../src/routes/import.ts';
import type { RouteSourceProvider } from '../src/routes/sources.ts';
import type { RouteRecord, RouteStore } from '../src/routes/store.ts';
import { simpleGpx } from './fixtures/rides.ts';

test('a new source owns its identifiers and normalization without changing storage or ranking contracts', async () => {
  const records = new Map<string, RouteRecord>();
  const store: Pick<
    RouteStore,
    'findSource' | 'createImported' | 'replaceImported'
  > = {
    findSource: async (owner, source) =>
      records.get(`${owner}:${source.providerId}:${source.externalId}`) ?? null,
    createImported: async (owner, record) => {
      records.set(
        `${owner}:${record.source?.providerId}:${record.source?.externalId}`,
        record,
      );
      return true;
    },
    replaceImported: async () => {
      throw new Error('An identical import should not be written again.');
    },
  };
  const provider: RouteSourceProvider = {
    descriptor: {
      id: 'club-library',
      name: 'Club library',
      importModes: ['gpx-upload'],
      accountConnection: false,
    },
    normalizeExternalId: (id) => id.trim().toLowerCase(),
    importRoute: (input) =>
      importGpx(input.gpx, `Club: ${input.externalId}`, input.importedAt),
  };
  const request = {
    ownerId: 'cyclist',
    source: { providerId: 'club-library', externalId: ' SUMMER-LOOP ' },
    gpx: simpleGpx,
    importedAt: '2026-10-10T09:00:00.000Z',
  };
  const created = await importSourceRoute(request, provider, store);
  expect(created.outcome).toBe('created');
  expect(created.record.source?.externalId).toBe('summer-loop');
  expect(created.record.route.name).toBe('Club: summer-loop');
  expect(created.record.route.legs.length).toBeGreaterThan(0);
  expect(created.record.route.weatherLocations.length).toBeGreaterThanOrEqual(
    2,
  );
  const again = await importSourceRoute(
    { ...request, source: { ...request.source, externalId: 'summer-loop' } },
    provider,
    store,
  );
  expect(again.outcome).toBe('unchanged');
  expect(again.record).toEqual(created.record);
});
