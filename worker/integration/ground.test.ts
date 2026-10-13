import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HttpResponse, http } from 'msw/http';
import type { collectGroundEvidence } from '../src/ground/service.ts';
import type { Route } from '../src/routes/model.ts';
import { groundResponse, groundRoute } from '../test/fixtures/ground.ts';
import { BOB_TOKEN, createHarness, type Harness } from './harness.ts';

type Evidence = Awaited<ReturnType<typeof collectGroundEvidence>>;
const endpoint = 'https://api.open-meteo.com/v1/forecast';
const integration = (name: string, run: (h: Harness) => Promise<void>) =>
  test(name, { timeout: 30000 }, async () => {
    const h = await createHarness();
    try {
      await run(h);
    } finally {
      await h.dispose();
      assert.deepEqual(h.unexpected, []);
      assert.deepEqual(h.handlerErrors, []);
    }
  });
const save = async (h: Harness, route: Route) => {
  const db = await h.runtime.getD1Database('ROUTES_DB');
  await db
    .prepare(
      'INSERT INTO routes (owner_id, id, name, created_at, route_json) VALUES (?, ?, ?, ?, ?)',
    )
    .bind('alice', route.id, route.name, route.createdAt, JSON.stringify(route))
    .run();
  return route.id;
};
const evidence = async (h: Harness, ids: string[]) => {
  const response = await h.send('/ground-evidence', {
    body: JSON.stringify({ routeIds: ids }),
  });
  assert.equal(response.status, 200);
  return (await response.json()) as Evidence;
};
const fixture = () =>
  http.get(endpoint, ({ request }) =>
    HttpResponse.json(groundResponse(new URL(request.url))),
  );
const cell = (response: Evidence) => {
  const first = response.cells[0];
  assert.ok(first);
  return first;
};

integration(
  'ground history shares persistent cache across routes and owner settings without hourly cache rollover',
  async (h) => {
    h.use(fixture());
    const id = await save(h, groundRoute());
    const first = await evidence(h, [id]);
    assert.equal(first.scoringApplied, false);
    assert.equal(first.usage.httpRequests, 1);
    assert.equal(first.usage.reservedUnits, 3);
    assert.equal(first.usage.actualBillableCalls, null);
    assert.equal(cell(first).history[0]?.rain.totalMm, 24);
    assert.equal(cell(first).history[4]?.rain.totalMm, 672);
    assert.equal(cell(first).history[4]?.rain.forecastHours, 0);
    assert.equal(cell(first).hours.length, 840);
    assert.equal(
      cell(first).hours.filter((hour) => hour.basis === 'forecast').length,
      155,
    );
    const shared = await save(h, groundRoute('unknown'));
    await h.restart({ TEST_NOW: '2026-10-09T13:00:00.000Z' });
    const second = await evidence(h, [shared, id]);
    assert.equal(second.usage.httpRequests, 0);
    assert.equal(second.coverage.requiredCells, 1);
    assert.equal(cell(second).history[0]?.rain.forecastHours, 1);
    assert.equal(h.requests.length, 1);
    // The request has no preference input; settings updates never fetch ground data.
    const profile = await h.send('/users', {
      body: JSON.stringify({ displayName: 'Synthetic rider' }),
    });
    assert.equal(profile.status, 201);
    assert.equal(h.requests.length, 1);
    const rejected = await h.send('/ground-evidence', {
      body: JSON.stringify({ routeIds: [id], preferences: {} }),
    });
    assert.equal(rejected.status, 400);
    assert.equal(h.requests.length, 1);
  },
);

integration(
  'ground refresh requests only recent days, preserves old history and extends one day at midnight',
  async (h) => {
    h.use(fixture());
    const id = await save(h, groundRoute());
    await evidence(h, [id]);
    await h.restart({ TEST_NOW: '2026-10-09T15:00:00.000Z' });
    await evidence(h, [id]);
    const refresh = new URL(h.requests[1]?.url ?? '');
    assert.equal(refresh.searchParams.get('start_date'), '2026-10-09');
    assert.equal(refresh.searchParams.get('end_date'), '2026-10-10');
    await h.restart({ TEST_NOW: '2026-10-10T00:00:00.000Z' });
    const next = await evidence(h, [id]);
    const midnight = new URL(h.requests[2]?.url ?? '');
    assert.equal(midnight.searchParams.get('start_date'), '2026-10-07');
    assert.equal(midnight.searchParams.get('end_date'), '2026-10-16');
    assert.equal(cell(next).history[4]?.rain.totalMm, 672);
    const old = cell(next).days.find((day) => day.date === '2026-09-20');
    assert.equal(old?.retrievedAt, '2026-10-09T12:00:00.000Z');
  },
);

integration(
  'fully paved routes, disabled mode, auth failures and foreign routes make no provider calls',
  async (h) => {
    const paved = await save(h, groundRoute('paved'));
    const result = await evidence(h, [paved]);
    assert.equal(result.routes[0]?.status, 'not-applicable');
    assert.equal(result.cells.length, 0);
    const gravel = await save(h, groundRoute());
    for (const [token, status] of [
      [null, 401],
      [BOB_TOKEN, 404],
    ] as const) {
      assert.equal(
        (
          await h.send('/ground-evidence', {
            token,
            body: JSON.stringify({ routeIds: [gravel] }),
          })
        ).status,
        status,
      );
    }
    await h.restart({ GROUND_EVIDENCE_MODE: 'off' });
    assert.equal(
      (
        await h.send('/ground-evidence', {
          body: JSON.stringify({ routeIds: [gravel] }),
        })
      ).status,
      503,
    );
    assert.equal(h.requests.length, 0);
  },
);

integration(
  'missing values, absent hours and forecast gaps never become zero rainfall',
  async (h) => {
    h.use(
      http.get(endpoint, ({ request }) => {
        const data = groundResponse(new URL(request.url));
        const index = data.hourly.time.indexOf(
          Date.parse('2026-10-09T12:00:00Z') / 1000,
        );
        data.hourly.rain[index] = null;
        data.hourly.precipitation[index] = -1;
        data.hourly.et0_fao_evapotranspiration[index] = null;
        // Drop the last timestamp AND associated values to simulate limited horizon.
        for (const values of Object.values(data.hourly)) values.pop();
        return HttpResponse.json(data);
      }),
    );
    const result = cell(await evidence(h, [await save(h, groundRoute())]));
    assert.equal(result.history[0]?.rain.totalMm, null);
    assert.equal(result.history[0]?.rain.knownTotalMm, 23);
    assert.equal(result.history[0]?.precipitation.totalMm, null);
    assert.equal(result.hours.at(-1)?.rainMm, null);
    assert.equal(result.days.at(-1)?.refreshAt, '2026-10-09T12:15:00.000Z');
  },
);

for (const failure of [
  'unit',
  'timestamps',
  'length',
  'grid',
  'http',
  'oversize',
  'redirect',
] as const)
  integration(
    `invalid ground provider ${failure} returns explicit unavailable evidence`,
    async (h) => {
      h.use(
        http.get(endpoint, ({ request }) => {
          if (failure === 'http')
            return new HttpResponse(null, { status: 503 });
          if (failure === 'redirect')
            return new HttpResponse(null, {
              status: 302,
              headers: { Location: 'https://example.invalid/' },
            });
          if (failure === 'oversize')
            return new HttpResponse(' '.repeat(2_000_001));
          const data = groundResponse(new URL(request.url));
          if (failure === 'unit') data.hourly_units.rain = 'inch';
          if (failure === 'timestamps')
            data.hourly.time[1] = data.hourly.time[0] ?? 0;
          if (failure === 'length') data.hourly.rain.pop();
          if (failure === 'grid') data.latitude = 40;
          return HttpResponse.json(data);
        }),
      );
      const result = await evidence(h, [await save(h, groundRoute())]);
      assert.equal(cell(result).refreshStatus, 'provider-unavailable');
      assert.equal(cell(result).history[0]?.rain.totalMm, null);
      assert.equal(cell(result).history[0]?.rain.knownTotalMm, null);
      assert.equal(result.usage.httpRequests, 1);
      assert.equal(h.requests.length, 1);
    },
  );

integration(
  'failed refresh retains old values with stale flags and original provenance',
  async (h) => {
    const id = await save(h, groundRoute());
    h.use(fixture());
    await evidence(h, [id]);
    await h.restart({ TEST_NOW: '2026-10-09T16:00:00.000Z' });
    h.use(http.get(endpoint, () => new HttpResponse(null, { status: 503 })));
    const result = cell(await evidence(h, [id]));
    assert.equal(result.refreshStatus, 'provider-unavailable');
    assert.equal(result.history[0]?.rain.totalMm, 24);
    assert.equal(result.history[0]?.rain.forecastHours, 4);
    assert.equal(
      result.days.find((day) => day.date === '2026-10-09')?.stale,
      true,
    );
    assert.equal(
      result.days.find((day) => day.date === '2026-10-09')?.retrievedAt,
      '2026-10-09T12:00:00.000Z',
    );
  },
);

integration(
  'spatial cap exposes omitted sections instead of silently assessing the whole route',
  async (h) => {
    const route = groundRoute();
    route.distanceM = 13_000;
    route.surface = null;
    route.legs = Array.from({ length: 13 }, (_, i) => ({
      fromM: i * 1000,
      toM: (i + 1) * 1000,
      coordinate: { latitude: 51.5, longitude: -0.1 - i * 0.1 },
      bearingDegrees: 180,
      weatherLocationId: 's',
    }));
    h.use(fixture());
    const result = await evidence(h, [await save(h, route)]);
    assert.equal(result.coverage.requiredCells, 13);
    assert.equal(result.coverage.requestedCells, 12);
    assert.equal(result.coverage.omittedCellIds.length, 1);
    assert.equal(result.routes[0]?.omittedM, 1000);
    assert.equal(result.usage.httpRequests, 12);
  },
);

integration(
  'atomic daily budget and shared leases prevent concurrent duplicate fetches',
  async (h) => {
    const id = await save(h, groundRoute());
    let entered!: () => void;
    const entry = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    h.use(
      http.get(endpoint, async ({ request }) => {
        entered();
        await gate;
        return HttpResponse.json(groundResponse(new URL(request.url)));
      }),
    );
    const first = evidence(h, [id]);
    await entry;
    try {
      const concurrent = await evidence(h, [id]);
      assert.equal(cell(concurrent).refreshStatus, 'pending');
      assert.equal(concurrent.usage.httpRequests, 0);
    } finally {
      release();
    }
    await first;
    assert.equal(h.requests.length, 1);
    const db = await h.runtime.getD1Database('ROUTES_DB');
    await db
      .prepare('UPDATE ground_evidence_usage SET reserved_units = 399')
      .run();
    h.use(fixture());
    const secondId = await save(h, groundRoute('gravel', -1));
    const limited = await evidence(h, [secondId]);
    assert.equal(cell(limited).refreshStatus, 'budget-exhausted');
    assert.equal(limited.usage.httpRequests, 0);
    assert.equal(h.requests.length, 1);
    const usage = await db
      .prepare(
        'SELECT http_attempts, reserved_units FROM ground_evidence_usage',
      )
      .first();
    assert.deepEqual(usage, { http_attempts: 1, reserved_units: 399 });
  },
);

integration(
  'distinct cells racing for the last daily allocation cannot exceed the shared budget',
  async (h) => {
    const db = await h.runtime.getD1Database('ROUTES_DB');
    await db
      .prepare(
        'INSERT INTO ground_evidence_usage (date, http_attempts, reserved_units) VALUES (?, ?, ?)',
      )
      .bind('2026-10-09', 0, 397)
      .run();
    const a = await save(h, groundRoute('gravel', -1));
    const b = await save(h, groundRoute('gravel', -2));
    h.use(fixture());
    const results = await Promise.all([evidence(h, [a]), evidence(h, [b])]);
    assert.deepEqual(results.map((r) => cell(r).refreshStatus).sort(), [
      'budget-exhausted',
      'refreshed',
    ]);
    assert.equal(h.requests.length, 1);
    assert.equal(
      (
        await db
          .prepare('SELECT reserved_units FROM ground_evidence_usage')
          .first()
      )?.reserved_units,
      400,
    );
  },
);

integration(
  'corrupt cached dates are refetched; expired history and old usage are pruned',
  async (h) => {
    const id = await save(h, groundRoute());
    h.use(fixture());
    await evidence(h, [id]);
    const db = await h.runtime.getD1Database('ROUTES_DB');
    await db
      .prepare(
        "UPDATE ground_evidence_days SET day_json = '{}' WHERE date = '2026-09-20'",
      )
      .run();
    await db
      .prepare('INSERT INTO ground_evidence_days VALUES (?, ?, ?, ?)')
      .bind('expired', '2020-01-01', '{}', 0)
      .run();
    await db
      .prepare('INSERT INTO ground_evidence_usage VALUES (?, ?, ?)')
      .bind('2020-01-01', 1, 1)
      .run();
    const result = await evidence(h, [id]);
    assert.equal(result.usage.httpRequests, 1);
    assert.equal(cell(result).history[4]?.rain.totalMm, 672);
    const refresh = new URL(h.requests[1]?.url ?? '');
    assert.equal(refresh.searchParams.get('start_date'), '2026-09-20');
    assert.equal(refresh.searchParams.get('end_date'), '2026-09-20');
    assert.equal(
      await db
        .prepare(
          "SELECT * FROM ground_evidence_days WHERE cache_key = 'expired'",
        )
        .first(),
      null,
    );
    assert.equal(
      await db
        .prepare(
          "SELECT * FROM ground_evidence_usage WHERE date = '2020-01-01'",
        )
        .first(),
      null,
    );
  },
);
