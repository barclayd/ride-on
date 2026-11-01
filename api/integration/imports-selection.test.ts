import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HttpResponse } from 'msw/http';
import { z } from 'zod';
import { selectionSchema } from '../src/routes/selection.ts';
import { first, recommendMetOffice as recommend, upload } from './client.ts';
import { hourlyForecast, metOffice, routeGpx } from './fixtures.ts';
import {
  ALICE_TOKEN,
  BOB_TOKEN,
  createHarness,
  type Harness,
  RIDE_DATE,
} from './harness.ts';

const integration = (name: string, run: (h: Harness) => Promise<void>) =>
  test(name, { timeout: 20_000 }, async () => {
    const h = await createHarness();
    try {
      await run(h);
    } finally {
      await h.dispose();
      assert.deepEqual(h.unexpected, []);
      assert.deepEqual(h.handlerErrors, []);
    }
  });
const summary = z.object({
  id: z.uuid(),
  name: z.string(),
  version: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  distanceM: z.number(),
  source: z
    .object({ providerId: z.string(), externalId: z.string() })
    .nullable(),
});
const readImport = async (response: { json: () => Promise<unknown> }) =>
  z
    .object({
      outcome: z.enum(['created', 'updated', 'unchanged']),
      route: summary,
    })
    .parse(await response.json());
const readSelection = async (response: { json: () => Promise<unknown> }) =>
  z.object({ selection: selectionSchema }).parse(await response.json())
    .selection;
const list = async (h: Harness, query = '', token = ALICE_TOKEN) => {
  const response = await h.send(`/routes${query}`, { token });
  assert.equal(response.status, 200);
  return z
    .object({
      routes: z.array(summary),
      nextCursor: z.uuid().nullable(),
      limit: z.number(),
    })
    .parse(await response.json());
};
const source = { providerId: 'cycle-travel', externalId: '12345' };
const payload = { source, gpx: routeGpx('Imported ride', -1) };
const importRide = (
  h: Harness,
  changes: Record<string, unknown> = {},
  token = ALICE_TOKEN,
) =>
  h.send('/route-imports', {
    token,
    body: JSON.stringify({ ...payload, ...changes }),
  });
const select = (
  h: Harness,
  routeIds: string[],
  expectedVersion = 0,
  token = ALICE_TOKEN,
) =>
  h.send('/route-selection', {
    method: 'PUT',
    token,
    body: JSON.stringify({ routeIds, expectedVersion }),
  });

integration(
  'surface enrichment survives storage, preserves identity and scores, and remains owner scoped',
  async (h) => {
    const initial = await readImport(await importRide(h));
    await select(h, [initial.route.id]);
    const surfaceUrl = `/routes/${initial.route.id}/surface`;
    const readSurface = async () =>
      z
        .object({
          routeId: z.uuid(),
          version: z.number(),
          surface: z
            .object({
              sourceHash: z.string(),
              capturedAt: z.iso.datetime(),
              geometryDistanceM: z.number(),
              source: z.object({
                providerId: z.literal('cycle-travel'),
                formatVersion: z.number(),
                mappingVersion: z.number(),
              }),
              sections: z.array(
                z.object({
                  fromM: z.number(),
                  toM: z.number(),
                  surface: z.string(),
                  sourceCode: z.string(),
                }),
              ),
            })
            .nullable(),
          summary: z.object({
            status: z.string(),
            unknownM: z.number(),
            unpavedFraction: z.number().nullable(),
          }),
        })
        .parse(await (await h.send(surfaceUrl)).json());
    assert.equal((await readSurface()).summary.status, 'unavailable');
    assert.equal((await readSurface()).summary.unpavedFraction, null);
    const surface = {
      schemaVersion: 1,
      source: {
        providerId: 'cycle-travel',
        method: 'route-instructions',
        formatVersion: 2,
        mappingVersion: 1,
      },
      geometryDistanceM: initial.route.distanceM,
      sections: [
        {
          fromM: 0,
          toM: initial.route.distanceM / 2,
          surface: 'paved',
          sourceCode: 'mode:13',
        },
        {
          fromM: initial.route.distanceM / 2,
          toM: initial.route.distanceM,
          surface: 'unpaved',
          sourceCode: 'mode:15',
        },
      ],
    };
    assert.equal((await importRide(h, { surface })).status, 409);
    const enriched = await readImport(
      await importRide(h, { surface, expectedVersion: 1 }),
    );
    assert.equal(enriched.outcome, 'updated');
    assert.equal(enriched.route.version, 2);
    assert.equal(enriched.route.id, initial.route.id);
    assert.equal(enriched.route.createdAt, initial.route.createdAt);
    assert.deepEqual(
      (await readSelection(await h.send('/route-selection'))).routeIds,
      [initial.route.id],
    );
    const evidence = await readSurface();
    assert.equal(evidence.summary.status, 'complete');
    assert.equal(evidence.summary.unpavedFraction, 0.5);
    assert.equal(evidence.surface?.sections.length, 2);
    assert.ok(evidence.surface?.sourceHash);
    assert.equal((await h.send(surfaceUrl, { token: BOB_TOKEN })).status, 404);
    assert.equal((await h.send(surfaceUrl, { token: null })).status, 401);
    await h.restart();
    assert.deepEqual(await readSurface(), evidence);
    const replay = await readImport(
      await importRide(h, { surface, expectedVersion: 2 }),
    );
    assert.equal(replay.outcome, 'unchanged');
    assert.deepEqual(replay.route, enriched.route);
    assert.equal(
      (await importRide(h, { surface, expectedVersion: 1 })).status,
      409,
    );
    assert.equal((await readImport(await importRide(h))).outcome, 'unchanged');
    assert.deepEqual(await readSurface(), evidence);
    assert.equal(h.requests.length, 0);

    // Surface evidence must not enter phase-one ranking, nor alter immutable ride geometry.
    h.use(metOffice());
    const before = await recommend(h, [initial.route.id]);
    assert.equal(
      (
        await importRide(h, {
          surface: {
            ...surface,
            sections: surface.sections.map((s) => ({
              ...s,
              surface: 'rough-unpaved',
              sourceCode: 'mode:16',
            })),
          },
          expectedVersion: 2,
        })
      ).status,
      200,
    );
    const after = await recommend(h, [initial.route.id]);
    assert.deepEqual(after.rankings, before.rankings);
    const db = await h.runtime.getD1Database('ROUTES_DB');
    const geometries = await db
      .prepare(
        'SELECT count(*) AS count FROM ride_geometries WHERE owner_id = ?',
      )
      .bind('alice')
      .first<{ count: number }>();
    assert.equal(geometries?.count, 1);
    // Name-only changes from older clients preserve evidence; changed source bytes discard it.
    assert.equal(
      (await importRide(h, { name: 'Renamed', expectedVersion: 3 })).status,
      200,
    );
    assert.equal((await readSurface()).summary.unpavedFraction, 1);
    assert.equal(
      (
        await importRide(h, {
          gpx: routeGpx('New geometry', 1),
          expectedVersion: 4,
        })
      ).status,
      200,
    );
    assert.equal((await readSurface()).surface, null);
    assert.equal((await readSurface()).summary.status, 'unavailable');
  },
);

integration(
  'invalid surface evidence is rejected atomically, including mismatched source and ranges',
  async (h) => {
    const initial = await readImport(await importRide(h));
    const surface = {
      schemaVersion: 1,
      source: {
        providerId: 'cycle-travel',
        method: 'route-instructions',
        formatVersion: 2,
        mappingVersion: 1,
      },
      geometryDistanceM: initial.route.distanceM,
      sections: [
        {
          fromM: 0,
          toM: initial.route.distanceM,
          surface: 'paved',
          sourceCode: 'mode:13',
        },
      ],
    };
    for (const invalid of [
      { ...surface, geometryDistanceM: 100 },
      {
        ...surface,
        sections: [
          { ...surface.sections[0], toM: initial.route.distanceM + 10 },
        ],
      },
      { ...surface, sections: [...surface.sections, ...surface.sections] },
    ])
      assert.equal(
        (await importRide(h, { surface: invalid, expectedVersion: 1 })).status,
        422,
      );
    assert.equal(
      (
        await importRide(h, {
          source: { providerId: 'strava', externalId: '77' },
          surface,
        })
      ).status,
      422,
    );
    assert.deepEqual((await list(h)).routes, [initial.route]);
    assert.equal(h.requests.length, 0);
  },
);

integration(
  'provider discovery, imports and source lookup preserve large IDs, ownership and durable identities',
  async (h) => {
    const discovery = await h.send('/route-sources');
    assert.equal(discovery.status, 200);
    assert.equal(discovery.headers.get('Cache-Control'), 'no-store');
    const providers = z
      .object({
        sources: z.array(
          z.object({
            id: z.string(),
            importModes: z.array(z.literal('gpx-upload')),
            accountConnection: z.literal(false),
          }),
        ),
      })
      .parse(await discovery.json()).sources;
    assert.deepEqual(
      providers.map((p) => p.id),
      ['cycle-travel', 'garmin', 'strava'],
    );
    const externalId = '9876543210123456789';
    const ids: string[] = [];
    for (const { id: providerId } of providers) {
      const response = await importRide(h, {
        source: { providerId, externalId },
      });
      assert.equal(response.status, 201);
      const imported = await readImport(response);
      assert.equal(imported.outcome, 'created');
      assert.equal(imported.route.source?.externalId, externalId);
      assert.equal(imported.route.version, 1);
      assert.equal(
        response.headers.get('Location'),
        `/routes/${imported.route.id}`,
      );
      ids.push(imported.route.id);
    }
    assert.equal(new Set(ids).size, 3);
    const bob = await readImport(
      await importRide(
        h,
        { source: { providerId: 'strava', externalId } },
        BOB_TOKEN,
      ),
    );
    assert.ok(!ids.includes(bob.route.id));
    assert.equal(
      (await h.send(`/routes/${first(ids)}`, { token: BOB_TOKEN })).status,
      404,
    );
    await h.restart();
    assert.equal((await list(h)).routes.length, 3);
    assert.equal((await list(h, '', BOB_TOKEN)).routes.length, 1);
    const found = await list(
      h,
      `?sourceProviderId=strava&sourceExternalId=${externalId}`,
    );
    assert.equal(found.routes.length, 1);
    assert.equal(found.routes[0]?.id, ids[2]);
    assert.deepEqual(
      (await readSelection(await h.send('/route-selection'))).routeIds,
      [],
    );
    assert.equal(h.requests.length, 0);
  },
);

integration(
  'identical concurrent imports converge on one route and do not advance its version',
  async (h) => {
    const responses = await Promise.all([
      importRide(h),
      importRide(h),
      importRide(h),
    ]);
    assert.deepEqual(responses.map((r) => r.status).sort(), [200, 200, 201]);
    const results = await Promise.all(responses.map(readImport));
    assert.equal(new Set(results.map((r) => r.route.id)).size, 1);
    assert.ok(results.every((r) => r.route.version === 1));
    assert.equal((await list(h)).routes.length, 1);
    const repeat = await readImport(await importRide(h));
    assert.equal(repeat.outcome, 'unchanged');
    assert.deepEqual(repeat.route, first(results).route);
  },
);

integration(
  'refreshes preserve identity and selection, require a current version, and change the geometry used by scoring',
  async (h) => {
    h.use(
      metOffice(({ request }) => HttpResponse.json(hourlyForecast(request))),
    );
    const initial = await readImport(await importRide(h));
    assert.equal((await select(h, [initial.route.id])).status, 200);
    const changed = { gpx: routeGpx('Refreshed ride', 1, true) };
    assert.equal((await importRide(h, changed)).status, 409);
    assert.equal(
      (await importRide(h, { ...changed, expectedVersion: 2 })).status,
      409,
    );
    assert.deepEqual(first((await list(h)).routes), initial.route);
    await h.restart({ TEST_NOW: '2026-10-09T13:00:00.000Z' });
    const updatedResponse = await importRide(h, {
      ...changed,
      expectedVersion: 1,
    });
    assert.equal(updatedResponse.status, 200);
    const updated = await readImport(updatedResponse);
    assert.equal(updated.outcome, 'updated');
    assert.equal(updated.route.id, initial.route.id);
    assert.equal(updated.route.createdAt, initial.route.createdAt);
    assert.notEqual(updated.route.updatedAt, initial.route.updatedAt);
    assert.equal(updated.route.version, 2);
    assert.equal(updated.route.name, 'Refreshed ride');
    assert.equal((await importRide(h, { expectedVersion: 1 })).status, 409);
    const selection = await readSelection(await h.send('/route-selection'));
    assert.deepEqual(selection.routeIds, [initial.route.id]);
    assert.equal(selection.version, 1);
    const result = await recommend(h, selection.routeIds);
    assert.equal(result.rankings.length, 1);
    assert.equal(result.rankings[0]?.routeId, initial.route.id);
    assert.ok(h.requests.length > 0);
    assert.ok(
      h.requests.every(
        (r) => new URL(r.url).searchParams.get('longitude') === '1',
      ),
    );
    // The stored legs must now point south, not retain the old northbound direction.
    const db = await h.runtime.getD1Database('ROUTES_DB');
    const row = await db
      .prepare('SELECT route_json FROM routes WHERE owner_id = ? AND id = ?')
      .bind('alice', initial.route.id)
      .first<{ route_json: string }>();
    const route = z
      .object({ legs: z.array(z.object({ bearingDegrees: z.number() })) })
      .parse(JSON.parse(row?.route_json ?? '{}'));
    assert.ok(
      route.legs.every((leg) => Math.abs(leg.bearingDegrees - 180) < 0.01),
    );
  },
);

integration(
  'simultaneous conflicting refreshes cannot overwrite each other',
  async (h) => {
    const original = await readImport(await importRide(h));
    const responses = await Promise.all([
      importRide(h, { name: 'First update', expectedVersion: 1 }),
      importRide(h, { name: 'Second update', expectedVersion: 1 }),
    ]);
    assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
    const current = first((await list(h)).routes);
    assert.equal(current.id, original.route.id);
    assert.equal(current.version, 2);
    const winner = responses.find((r) => r.status === 200);
    assert.ok(winner);
    assert.deepEqual(current, (await readImport(winner)).route);
  },
);

integration(
  'selection is explicit, survives refreshes/restarts and never expands recommendations to the whole library',
  async (h) => {
    h.use(
      metOffice(({ request }) => HttpResponse.json(hourlyForecast(request))),
    );
    const a = await readImport(await importRide(h));
    const b = await upload(h, 'Already ridden', 1);
    assert.deepEqual(await readSelection(await h.send('/route-selection')), {
      version: 0,
      routeIds: [],
      updatedAt: null,
    });
    assert.equal((await select(h, [b.id, a.route.id])).status, 200);
    const selected = await readSelection(await select(h, [a.route.id], 1));
    assert.equal(selected.version, 2);
    assert.equal(
      (await importRide(h, { name: 'Fresh name', expectedVersion: 1 })).status,
      200,
    );
    await h.restart();
    assert.deepEqual(
      await readSelection(await h.send('/route-selection')),
      selected,
    );
    assert.equal((await list(h)).routes.length, 2);
    const result = await recommend(h, selected.routeIds);
    assert.deepEqual(
      result.rankings.map((r) => r.routeId),
      [a.route.id],
    );
    assert.ok(
      h.requests.every(
        (r) => new URL(r.url).searchParams.get('longitude') === '-1',
      ),
    );
    // Explicit request choices override no global state; one-off comparisons don't change the shortlist.
    const oneOff = await recommend(h, [b.id]);
    assert.deepEqual(
      oneOff.rankings.map((r) => r.routeId),
      [b.id],
    );
    assert.deepEqual(
      await readSelection(await h.send('/route-selection')),
      selected,
    );
    assert.equal((await select(h, [], 2)).status, 200);
    const empty = await readSelection(await h.send('/route-selection'));
    assert.deepEqual(empty.routeIds, []);
    const calls = h.requests.length;
    assert.equal(
      (
        await h.send('/recommendations', {
          body: JSON.stringify({ routeIds: empty.routeIds, date: RIDE_DATE }),
        })
      ).status,
      400,
    );
    assert.equal(h.requests.length, calls);
  },
);

integration(
  'selection validates ownership, duplicates, limits and versions without partially writing',
  async (h) => {
    const alice = await upload(h);
    const bob = await readImport(await importRide(h, {}, BOB_TOKEN));
    assert.equal((await select(h, [alice.id, bob.route.id])).status, 404);
    assert.equal((await select(h, [alice.id, alice.id])).status, 400);
    assert.equal(
      (
        await select(
          h,
          Array.from({ length: 13 }, () => crypto.randomUUID()),
        )
      ).status,
      400,
    );
    assert.equal((await select(h, [alice.id], 0, BOB_TOKEN)).status, 404);
    assert.equal(
      (
        await h.send('/route-selection', {
          method: 'PUT',
          body: JSON.stringify({ routeIds: [alice.id] }),
        })
      ).status,
      400,
    );
    assert.equal(
      (await readSelection(await h.send('/route-selection'))).version,
      0,
    );
    const raced = await Promise.all([select(h, [alice.id]), select(h, [])]);
    assert.deepEqual(raced.map((r) => r.status).sort(), [200, 409]);
    const saved = await readSelection(await h.send('/route-selection'));
    assert.equal(saved.version, 1);
    assert.equal((await select(h, [], 0)).status, 409);
    assert.deepEqual(
      await readSelection(await h.send('/route-selection')),
      saved,
    );
    assert.deepEqual(
      (
        await readSelection(
          await h.send('/route-selection', { token: BOB_TOKEN }),
        )
      ).routeIds,
      [],
    );
    assert.equal(h.requests.length, 0);
  },
);

integration(
  'all new endpoints authenticate before reading request bodies or data',
  async (h) => {
    for (const [path, method] of [
      ['/route-sources', 'GET'],
      ['/route-imports', 'POST'],
      ['/route-selection', 'GET'],
      ['/route-selection', 'PUT'],
      [`/routes/${crypto.randomUUID()}`, 'GET'],
    ]) {
      assert.ok(path && method);
      for (const token of [null, 'wrong-token'])
        assert.equal(
          (
            await h.send(path, {
              method,
              token,
              ...(method === 'POST' || method === 'PUT'
                ? { body: '{bad json' }
                : {}),
            })
          ).status,
          401,
        );
    }
    assert.equal(h.requests.length, 0);
  },
);

integration(
  'bad source identifiers, unsupported sources, URL fetch requests and invalid GPX never persist data',
  async (h) => {
    for (const changes of [
      { source: { ...source, externalId: 12345 } },
      {
        source: {
          ...source,
          externalId: 'https://cycle.travel/map/journey/12345',
        },
      },
      { source: { ...source, externalId: '0012345' } },
      { source: { ...source, externalId: "1' OR 1=1" } },
      { source: { ...source, ownerId: 'bob' } },
      { url: 'http://127.0.0.1/private.gpx' },
      { name: '   ' },
      { expectedVersion: 0 },
      { gpx: null },
    ])
      assert.equal((await importRide(h, changes)).status, 400);
    assert.equal(
      (await importRide(h, { source: { ...source, providerId: 'unknown' } }))
        .status,
      422,
    );
    assert.equal(
      (
        await importRide(h, {
          source: { ...source, providerId: 'constructor' },
        })
      ).status,
      422,
    );
    assert.equal((await importRide(h, { gpx: '<broken>' })).status, 422);
    assert.equal((await importRide(h, { expectedVersion: 1 })).status, 409);
    assert.equal((await list(h)).routes.length, 0);
    assert.equal(h.requests.length, 0);
  },
);

integration(
  'malformed and oversized import bodies are bounded; failed refreshes preserve the previous route',
  async (h) => {
    const original = await readImport(await importRide(h));
    assert.equal(
      (await importRide(h, { gpx: '<broken>', expectedVersion: 1 })).status,
      422,
    );
    assert.equal(
      (await h.send('/route-imports', { body: '{bad' })).status,
      400,
    );
    assert.equal(
      (
        await h.send('/route-imports', {
          body: payload.gpx,
          contentType: 'text/xml',
        })
      ).status,
      415,
    );
    assert.equal(
      (await h.send('/route-imports', { body: ' '.repeat(6_000_001) })).status,
      413,
    );
    // Multibyte GPX can fit the character limit while exceeding the 5 MB byte limit.
    const tooLarge = `<!--${'é'.repeat(2_500_001)}-->${payload.gpx}`;
    assert.equal(
      (await importRide(h, { gpx: tooLarge, expectedVersion: 1 })).status,
      413,
    );
    assert.deepEqual(first((await list(h)).routes), original.route);
  },
);

integration(
  'library pagination is stable across source refreshes and includes legacy uploads',
  async (h) => {
    const legacy = await upload(h, 'Legacy file');
    const a = await readImport(await importRide(h));
    await h.restart({ TEST_NOW: '2026-10-09T13:00:00.000Z' });
    const b = await readImport(
      await importRide(h, { source: { ...source, externalId: '54321' } }),
    );
    const page1 = await list(h, '?limit=1');
    assert.equal(first(page1.routes).id, b.route.id);
    assert.ok(page1.nextCursor);
    assert.equal(
      (await importRide(h, { name: 'Updated old route', expectedVersion: 1 }))
        .status,
      200,
    );
    const seen = page1.routes.map((r) => r.id);
    let cursor = page1.nextCursor;
    while (cursor) {
      const page = await list(h, `?limit=1&cursor=${cursor}`);
      assert.equal(page.routes.length, 1);
      seen.push(first(page.routes).id);
      cursor = page.nextCursor ?? '';
    }
    assert.equal(new Set(seen).size, 3);
    assert.deepEqual(
      [...seen].sort(),
      [legacy.id, a.route.id, b.route.id].sort(),
    );
    const old = z
      .object({ route: summary })
      .parse(await (await h.send(`/routes/${legacy.id}`)).json()).route;
    assert.equal(old.source, null);
    assert.equal(old.version, 1);
    assert.equal(old.updatedAt, old.createdAt);
    const bob = await readImport(await importRide(h, {}, BOB_TOKEN));
    assert.equal((await h.send(`/routes?cursor=${bob.route.id}`)).status, 400);
    for (const query of [
      '?limit=0',
      '?limit=101',
      '?cursor=bad',
      '?sourceExternalId=123',
      '?unexpected=1',
    ])
      assert.equal((await h.send(`/routes${query}`)).status, 400);
  },
);
