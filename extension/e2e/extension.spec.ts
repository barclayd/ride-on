import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import path from 'node:path';
import {
  type BrowserContext,
  test as base,
  chromium,
  expect,
  type Page,
  type Worker,
} from '@playwright/test';
import type { Ride, RidePlan, RouteSummary, User } from '../lib/types';
import {
  addDays,
  applyPatch,
  longWeekday,
  newest,
  planningDates,
  shortDate,
} from '../ui/format';

const EXTENSION = path.resolve('.output/chrome-mv3-e2e');
const JOURNEYS = readFileSync(path.resolve('e2e/journeys.html'), 'utf8');
const day = (offset: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(
    Date.now() + offset * 86_400_000,
  );

// ---- Mock Ride On API v0.12 (port baked into the e2e build) ----

const APPLE_LEGAL =
  'https://developer.apple.com/weatherkit/data-source-attribution/';
// GET /weather-providers (API 0.14): one Met Office choice; products stay server-side.
const provider = (id: string, name: string, attribution: object) => ({
  id,
  name,
  configured: true,
  attribution: [attribution],
});
const METOFFICE = {
  text: 'Powered by Met Office data',
  url: 'https://www.metoffice.gov.uk/',
};
const PROVIDERS = [
  provider('apple-weather', 'Apple Weather', {
    text: 'Apple Weather',
    url: APPLE_LEGAL,
    logo: {
      lightUrl:
        'https://weatherkit.apple.com/assets/branding/en/Apple_Weather_blk_en_2X_090122.png',
      darkUrl:
        'https://weatherkit.apple.com/assets/branding/en/Apple_Weather_wht_en_2X_090122.png',
    },
    notice:
      'Ride On route assessments are derived from and modify Apple Weather data.',
  }),
  provider('met-office', 'Met Office', METOFFICE),
];
// The technical product behind each choice; a saved BPF profile reports 'met-office'.
const PRODUCTS: Record<string, string> = {
  'apple-weather': 'apple-weather',
  'met-office': 'met-office-bpf',
};

let calls: { method: string; path: string; body: any; key?: string }[] = [];
let user: User;
let selection: { version: number; routeIds: string[]; updatedAt: null };
let routes: Record<string, RouteSummary>;
let rides: Ride[];
let providerDown: boolean; // every forecast failed, as with a mis-chosen provider
let replays: Map<string, Ride>;

const reset = () => {
  calls = [];
  providerDown = false;
  replays = new Map();
  user = {
    id: 'u1',
    version: 1,
    displayName: 'Test Rider',
    weatherProviderId: 'met-office',
    settings: {
      timeZone: 'Europe/London',
      weather: { mode: 'strict', providerId: 'met-office-bpf' }, // an existing profile
      forecast: {
        representation: 'deterministic',
        freshnessBasis: 'model-run',
      },
      preferences: {
        temperature: { comfortMinC: 10, comfortMaxC: 22 },
        wind: { comfortableHeadwindKph: 15, comfortableCrosswindKph: 20 },
        climbing: { preference: 'neutral' },
        distance: null,
        minimumStandards: {},
        recentRides: { mode: 'neutral', lookbackDays: 28 },
      },
    },
  };
  selection = { version: 1, routeIds: ['r101'], updatedAt: null };
  routes = {
    r101: {
      id: 'r101',
      name: 'Hilly Loop',
      distanceM: 51_000,
      source: { providerId: 'cycle-travel', externalId: '101' },
      version: 1,
      updatedAt: '2026-01-01T00:00:00Z',
    },
  };
  rides = [];
};

const CONDITIONS = {
  temperatureC: { minimum: 9, maximum: 14 },
  averageWindSpeedKph: 15,
  averageHeadwindKph: 3,
  averageTailwindKph: 12,
  averageCrosswindKph: 4,
  maximumPrecipitationProbability: 0.05,
  windDistanceFractions: { headwind: 0.1, tailwind: 0.7, crosswind: 0.2 },
  precipitationSummary: 'dry' as const,
};
const coast = (): RouteSummary => ({
  id: 'r102',
  name: 'Coast & Back',
  distanceM: 35_000,
  source: { providerId: 'cycle-travel', externalId: '102' },
  version: 1,
  updatedAt: '2026-01-01T00:00:00Z',
});
const ride = (
  routeId: string,
  riddenOn: string,
  plan: Ride['plan'] = null,
): Ride => {
  const route = routes[routeId];
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    version: 1,
    routeId,
    route: { ...route, ascentM: null },
    riddenOn,
    timeZone: 'Europe/London',
    recordedAt: now,
    updatedAt: now,
    plan,
  };
};
// Yesterday 08:00–14:00, Hilly Loop at 08:00 London (07:00Z in summer time).
const PLAN = {
  departureAt: `${day(-1)}T07:00:00.000Z`,
  finishAt: `${day(-1)}T08:46:00.000Z`,
  conditions: CONDITIONS,
};
const META = {
  generatedAt: `${day(-1)}T06:00:00.000Z`,
  algorithmVersion: 'test',
  attribution: [METOFFICE],
};
const RIDE_PLAN: RidePlan = {
  schemaVersion: 1,
  ...PLAN,
  pickRank: 1,
  generatedAt: META.generatedAt,
  algorithmVersion: META.algorithmVersion,
  weather: { attribution: META.attribution },
};
const SHOWN = {
  dates: [day(-1), day(-1)],
  time: { mode: 'custom', start: '08:00', end: '14:00' },
  endsAt: `${day(-1)}T13:00:00.000Z`,
  picks: [{ routeId: 'r101', date: day(-1), ...PLAN, rank: 1 }],
  meta: META,
};

const weather = () => ({
  retrieval: { latestAt: new Date().toISOString() },
  attribution:
    PROVIDERS.find((p) => p.id === user.weatherProviderId)?.attribution ?? [],
});
const best = (date: string, i: number, score: number) => ({
  date,
  departureAt: `${date}T0${8 + i}:00:00Z`,
  finishAt: `${date}T1${1 + i}:00:00Z`,
  score,
  standards: { status: 'not_configured', failures: [] },
  conditions: CONDITIONS,
});

const nextWindows = (after: { window: unknown }) => {
  const window = (
    kind: string,
    date: string,
    score: number,
    w: unknown = after.window,
  ) => ({
    kind,
    date,
    window: w,
    effectiveWindow: null,
    recommendationKind: kind === 'tomorrow' ? 'best_available' : 'best_pick',
    warnings: kind === 'tomorrow' ? ['Showers likely after 13:00'] : [],
    best: { ...best(date, 0, score), routeId: 'r101', routeName: 'Hilly Loop' },
  });
  return {
    generatedAt: new Date().toISOString(),
    algorithmVersion: 'test',
    timeZone: 'Europe/London',
    windows: [
      window('tomorrow', day(1), 72),
      window('same_weekday', day(6), 86),
      window('best_next_days', day(3), 80, 'daylight'),
    ],
    recommendedKind: 'same_weekday',
    weather: weather(),
  };
};

// The week from today: five full days, then a partial one and one beyond the forecast.
const daySummary = (i: number, selected: boolean) => {
  const date = day(i);
  const base = {
    date,
    availability: 'full',
    availabilityReason: 'available',
    until: null as string | null,
    daylight: { sunrise: `${date}T06:15:00Z`, sunset: `${date}T17:20:00Z` },
    temperatureMaxC: 14,
    quality: 84,
    selected,
  };
  if (providerDown)
    return {
      ...base,
      availability: 'none',
      availabilityReason: i ? 'provider_unavailable' : 'no_remaining_window',
      temperatureMaxC: null,
      quality: null,
    };
  if (i === 5)
    return {
      ...base,
      availability: 'partial',
      availabilityReason: 'partial_forecast',
      until: `${date}T11:00:00Z`,
    };
  if (i === 6)
    return {
      ...base,
      availability: 'none',
      availabilityReason: 'outside_forecast_horizon',
      daylight: null,
      temperatureMaxC: null,
      quality: null,
    };
  return base;
};

// One ranking across the planned days; ridden roads cost a little with Prefer variety.
const recommendations = (body: any) => {
  const planned = planningDates(body.days, day(0));
  const days = Array.from({ length: 7 }, (_, i) =>
    daySummary(i, !!planned && day(i) >= planned[0] && day(i) <= planned[1]),
  );
  const ranged = days.filter(
    (d) => d.selected && d.availabilityReason !== 'outside_forecast_horizon',
  );
  const date = ranged[0]?.date;
  const variety =
    user.settings.preferences.recentRides?.mode === 'prefer-variety';
  const recent = (routeId: string) =>
    variety &&
    rides.some(
      (r) => r.routeId === routeId && r.riddenOn >= addDays(day(0), -28),
    );
  const rankings = date
    ? selection.routeIds.map((routeId, i) => ({
        routeId,
        routeName: routes[routeId].name,
        distanceKm: routes[routeId].distanceM / 1000,
        distanceFit: null,
        estimatedDurationMinutes: 180,
        daylight: { start: `${date}T06:15:00Z`, end: `${date}T17:20:00Z` },
        effectiveWindow: {
          start: `${date}T06:15:00Z`,
          end: `${date}T17:20:00Z`,
        },
        status: 'assessed',
        departuresUnknown: 0,
        departuresStandardsUnknown: 0,
        best: {
          ...best(date, i, 84 - i * 10),
          recentRides: recent(routeId)
            ? { status: 'assessed', penaltyPoints: 3 }
            : {
                status: variety ? 'no_recent_history' : 'disabled',
                penaltyPoints: 0,
              },
        },
        issues: [],
        warnings: [],
        verdict: { status: 'meets', code: 'meets' },
      }))
    : [];
  return {
    generatedAt: new Date().toISOString(),
    algorithmVersion: 'test',
    timeZone: 'Europe/London',
    minimumStandardsStatus: 'not_configured',
    recommendation: rankings[0]
      ? { routeId: rankings[0].routeId, kind: 'best_pick' }
      : null,
    rankings,
    unranked: [],
    range: date ? { start: date, end: ranged.at(-1)?.date } : null,
    expired: !planned,
    days,
    weather: weather(),
  };
};

const handle = (method: string, url: URL, body: any): [number, unknown] => {
  const key = `${method} ${url.pathname}`;
  if (key === 'GET /users/me') return [200, { user }];
  if (key === 'PATCH /users/me') {
    if (body.expectedVersion !== user.version)
      return [409, { error: { code: 'USER_VERSION_CONFLICT', message: 'x' } }];
    const choice = body.settings.weatherProviderId;
    user = {
      ...user,
      version: user.version + 1,
      weatherProviderId: choice ?? user.weatherProviderId,
      settings: {
        ...user.settings,
        weather: choice
          ? { mode: 'strict', providerId: PRODUCTS[choice] }
          : user.settings.weather,
        preferences: applyPatch(
          user.settings.preferences,
          body.settings.preferences ?? {},
        ),
      },
    };
    return [200, { user }];
  }
  if (key === 'GET /weather-providers')
    return [
      200,
      {
        defaultProviderId: 'apple-weather',
        providers: PROVIDERS,
      },
    ];
  if (key === 'GET /routes')
    return [200, { routes: Object.values(routes), nextCursor: null }];
  if (key === 'GET /route-selection') return [200, { selection }];
  if (key === 'PUT /route-selection') {
    if (body.expectedVersion !== selection.version)
      return [409, { error: { code: 'VERSION_CONFLICT', message: 'Stale' } }];
    selection = {
      ...selection,
      version: selection.version + 1,
      routeIds: body.routeIds,
    };
    return [200, { selection }];
  }
  if (key === 'POST /route-imports') {
    const id = `r${body.source.externalId}`;
    const version = (routes[id]?.version ?? 0) + 1;
    routes[id] = {
      id,
      name: body.name,
      distanceM: 64_000,
      source: body.source,
      version,
      updatedAt: new Date().toISOString(),
    };
    return [version === 1 ? 201 : 200, { route: routes[id] }];
  }
  if (key === 'POST /recommendations') return [200, recommendations(body)];
  if (key === 'POST /recommendations/next-windows')
    return [200, nextWindows(body.after)];
  if (key === 'GET /rides')
    return [200, { rides: [...rides].sort(newest), nextCursor: null }];
  if (key === 'POST /rides/summaries')
    return [
      200,
      {
        summaries: body.routeIds.map((routeId: string) => {
          const days = rides.filter((r) => r.routeId === routeId);
          return {
            routeId,
            rideCount: days.length,
            lastRiddenOn:
              days
                .map((r) => r.riddenOn)
                .sort()
                .pop() ?? null,
          };
        }),
      },
    ];
  if (key === 'POST /rides') {
    const replay = replays.get(calls.at(-1)?.key ?? '');
    if (replay) return [200, { ride: replay, replayed: true }];
    if (body.expectedRouteVersion !== routes[body.routeId].version)
      return [
        409,
        { error: { code: 'ROUTE_VERSION_CONFLICT', message: 'Route changed' } },
      ];
    const created = ride(body.routeId, body.riddenOn, body.plan ?? null);
    rides.push(created);
    replays.set(calls.at(-1)?.key ?? '', created);
    return [201, { ride: created, replayed: false }];
  }
  const route = key.match(/^GET \/routes\/(.+)$/);
  if (route) return [200, { route: routes[route[1]] }];
  const removed = key.match(/^DELETE \/rides\/(.+)$/);
  if (removed) {
    rides = rides.filter((r) => r.id !== removed[1]);
    return [204, undefined];
  }
  if (key === 'POST /api/auth/sign-out') return [200, {}];
  return [404, { error: { code: 'NOT_FOUND', message: key } }];
};

let server: Server;
base.beforeAll(async () => {
  server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const body = raw ? JSON.parse(raw) : undefined;
    calls.push({
      method: req.method ?? 'GET',
      path: url.pathname,
      body,
      key: req.headers['idempotency-key'] as string | undefined,
    });
    const [status, json] = handle(req.method ?? 'GET', url, body);
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(json));
  });
  await new Promise<void>((resolve) =>
    server.listen(8787, '127.0.0.1', resolve),
  );
});
base.afterAll(
  () => new Promise<void>((resolve) => server.close(() => resolve())),
);
base.beforeEach(reset);

const recCalls = () => calls.filter((c) => c.path === '/recommendations');
const rideCalls = (method: string) =>
  calls.filter(
    (c) =>
      c.method === method &&
      c.path.startsWith('/rides') &&
      c.path !== '/rides/summaries',
  );
const patches = () => calls.filter((c) => c.method === 'PATCH');

// ---- Extension fixtures ----

const test = base.extend<{
  context: BrowserContext;
  worker: Worker;
  extensionId: string;
}>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright fixture signature.
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      args: [
        `--disable-extensions-except=${EXTENSION}`,
        `--load-extension=${EXTENSION}`,
      ],
    });
    await use(context);
    await context.close();
  },
  worker: async ({ context }, use) => {
    await use(
      context.serviceWorkers()[0] ??
        (await context.waitForEvent('serviceworker')),
    );
  },
  extensionId: async ({ worker }, use) => {
    await use(new URL(worker.url()).host);
  },
});

// Same store as lib/api.ts setToken.
const signIn = (worker: Worker) =>
  worker.evaluate(
    () =>
      new Promise((resolve) => {
        const open = indexedDB.open('ride-on');
        open.onupgradeneeded = () => open.result.createObjectStore('auth');
        open.onsuccess = () => {
          const tx = open.result.transaction('auth', 'readwrite');
          tx.objectStore('auth').put('test-token', 'token');
          tx.oncomplete = resolve;
        };
      }),
  );

const openPopup = async (context: BrowserContext, extensionId: string) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  return page;
};

const box = async (page: Page, selector: string) => {
  const rect = await page.locator(selector).first().boundingBox();
  if (!rect) throw new Error(`${selector} is not visible`);
  return rect;
};

// The popup never scrolls: 380 wide, at most 600 tall.
const expectPanelFits = async (page: Page) => {
  const panel = await box(page, '.ro-panel');
  expect(panel.width).toBe(380);
  expect(panel.height).toBeLessThanOrEqual(600);
  return panel;
};

// ---- Popup ----

test('signed out: offers Google and Apple and shrinks to fit', async ({
  context,
  extensionId,
}) => {
  const page = await openPopup(context, extensionId);
  await expect(
    page.getByRole('button', { name: 'Continue with Google' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Continue with Apple' }),
  ).toBeVisible();
  const panel = await expectPanelFits(page);
  expect(panel.height).toBeLessThan(600);
  await page.screenshot({ path: test.info().outputPath('signed-out.png') });
});

test('Rides tab opens first with one request for the planned days', async ({
  context,
  worker,
  extensionId,
}) => {
  await signIn(worker);
  const page = await openPopup(context, extensionId);
  await expect(page.getByRole('tab', { name: 'Rides' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const card = page.locator('.ro-ride').first();
  await expect(card).toContainText('Hilly Loop');
  await expect(card.locator('.ro-medal')).toHaveText('1');
  await expect(card.locator('.ro-flag')).toHaveText('Best pick');
  await expect(card.locator('.ro-score')).toContainText('Conditions 84/100');
  await expect(
    page.getByRole('link', { name: 'Powered by Met Office data' }),
  ).toHaveAttribute('href', 'https://www.metoffice.gov.uk/');
  await expectPanelFits(page);
  await expect(page.locator('.ro-sync')).toHaveCount(0);
  expect(recCalls()).toHaveLength(1);
  expect(recCalls()[0].body).toEqual({
    routeIds: ['r101'],
    days: { kind: 'range', start: day(1), end: day(5) }, // Next 5 days starts tomorrow
    previewDays: 7,
    riding: { window: 'daylight' },
  });
  await page.screenshot({ path: test.info().outputPath('rides.png') });
});

test('When tab: Days and Time visible; custom times re-query', async ({
  context,
  worker,
  extensionId,
}) => {
  await signIn(worker);
  const page = await openPopup(context, extensionId);
  await expect(page.locator('.ro-ride')).toContainText('Hilly Loop');
  await page.getByRole('tab', { name: 'When' }).click();
  const panel = await expectPanelFits(page);
  for (const label of ['Days', 'Time']) {
    const card = await box(page, `.ro-card:has(.ro-label:text-is("${label}"))`);
    expect(card.y + card.height).toBeLessThanOrEqual(panel.y + panel.height);
  }
  // Tiles come from the API's day summaries.
  await expect(page.locator('.ro-day > span:nth-child(3)')).toHaveText([
    '14°',
    '14°',
    '14°',
    '14°',
    '14°',
    'To 12:00',
    'Not yet',
  ]);
  await page.screenshot({ path: test.info().outputPath('when.png') });

  await page.getByRole('button', { name: 'Choose times' }).click();
  await expect
    .poll(() => recCalls().at(-1)?.body.riding)
    .toEqual({ window: { start: '08:00', end: '14:00' } });
  await page.getByRole('button', { name: 'Save as my default window' }).click();
  await expect(
    page.getByRole('button', { name: 'Saved as your default window' }),
  ).toBeVisible();
  expect(patches()).toEqual([]); // planning stays in this browser
});

test('a failed forecast provider is named, with a way to change it', async ({
  context,
  worker,
  extensionId,
}) => {
  providerDown = true;
  await signIn(worker);
  const page = await openPopup(context, extensionId);
  const banner = page.locator('.ro-banner.ro-provider');
  await expect(banner).toContainText('has no forecast for these days');
  await expect(page.locator('.ro-banner.ro-incomplete')).toHaveCount(0);
  await page.getByRole('tab', { name: 'When' }).click();
  await expectPanelFits(page);
  const labels = page.locator('.ro-day > span:nth-child(3)');
  await expect(labels).toHaveText([
    'Passed',
    ...Array.from({ length: 6 }, () => 'No data'),
  ]);
  // Every label stays inside its tile.
  for (const label of await labels.all())
    expect(await label.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
      true,
    );
  await page.screenshot({ path: test.info().outputPath('provider-down.png') });
  await page
    .locator('.ro-note')
    .getByRole('button', { name: 'Change forecast provider' })
    .click();
  await expect(page.getByRole('tab', { name: 'Preferences' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});

test('passed dates ask for new ones instead of swapping silently', async ({
  context,
  worker,
  extensionId,
}) => {
  await signIn(worker);
  await worker.evaluate(
    `chrome.storage.local.set({ state: { planning: { days: { kind: 'range', start: '2020-01-04', end: '2020-01-05' }, time: { mode: 'daylight', start: '08:00', end: '14:00' } } } })`,
  );
  const page = await openPopup(context, extensionId);
  await expect(page.getByRole('alert')).toContainText(
    'These dates have passed',
  );
  await expect(page.locator('.ro-ride')).toHaveCount(0);
  await page.getByRole('button', { name: 'Choose available dates' }).click();
  await expect(page.getByRole('tab', { name: 'When' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  // Amber for a moment, then on to tomorrow, with the old dates struck through.
  const days = page.locator('.ro-card:has(.ro-label:text-is("Days"))');
  await expect(days.locator('.ro-days-warn')).toHaveText('Dates passed');
  await expect(days.locator('.ro-days-control')).toHaveAttribute(
    'data-stale',
    'true',
  );
  await page.screenshot({ path: test.info().outputPath('when-stale.png') });
  await expect(page.getByRole('radio', { name: 'Tomorrow' })).toBeChecked();
  await expect(days.locator('.ro-value s')).toContainText('5 Jan');
  await expect(days.locator('.ro-sr')).toContainText('has passed. Showing');
  await page.screenshot({ path: test.info().outputPath('when-moved.png') });
  await expect
    .poll(() => recCalls().at(-1)?.body.days)
    .toEqual({ kind: 'preset', preset: 'tomorrow' });
});

test('Preferences: search-only distance, then PATCH carries supported fields only', async ({
  context,
  worker,
  extensionId,
}) => {
  await signIn(worker);
  const page = await openPopup(context, extensionId);
  await expect(page.locator('.ro-ride')).toContainText('Hilly Loop');
  await page.getByRole('tab', { name: 'Preferences' }).click();
  const panel = await expectPanelFits(page);
  const footer = await box(page, '.ro-sync');
  expect(Math.round(footer.y + footer.height)).toBe(
    Math.round(panel.y + panel.height),
  );
  await expect(page.locator('.ro-sync')).toHaveText('Synced');
  await page.screenshot({ path: test.info().outputPath('preferences.png') });

  // A range applies to this search only until saved as usual.
  await page.getByRole('button', { name: 'Choose a range' }).click();
  await expect(page.locator('.ro-scope')).toHaveText('For this search');
  await expect
    .poll(() => recCalls().at(-1)?.body.preferences)
    .toEqual({
      climbing: { preference: 'neutral' },
      distance: { minKm: 15, maxKm: 40 },
    });
  expect(patches()).toEqual([]);
  await page.getByRole('button', { name: 'Save as usual preferences' }).click();
  await expect
    .poll(() => patches()[0]?.body)
    .toEqual({
      expectedVersion: 1,
      settings: {
        preferences: {
          climbing: { preference: 'neutral' },
          distance: { minKm: 15, maxKm: 40 },
        },
      },
    });
  await expect(page.locator('.ro-scope')).toHaveText('Your usual preferences');

  await page.getByRole('switch', { name: 'Set limit: Gusts above' }).click();
  await expect.poll(() => patches().length).toBe(2);
  const { body } = patches()[1];
  expect(body.expectedVersion).toBe(2);
  expect(Object.keys(body.settings)).toEqual(['preferences']);
  expect(Object.keys(body.settings.preferences).sort()).toEqual([
    'minimumStandards',
    'temperature',
    'wind',
  ]);
  expect(body.settings.preferences.minimumStandards).toEqual({
    minimumTemperature: null,
    maximumPrecipitationProbability: null,
    maximumGustKph: 45,
  });
  await expect(page.locator('.ro-sync')).toHaveText('Synced');

  // A saved BPF profile shows as the single Met Office choice, not its product ID.
  const picker = page.getByLabel('Forecast provider');
  await expect(picker).toHaveValue('met-office');
  await expect(picker.locator('option')).toHaveText([
    'Apple Weather',
    'Met Office',
  ]);
  const before = recCalls().length;
  await picker.selectOption('apple-weather');
  await expect.poll(() => patches().length).toBe(3);
  expect(patches()[2].body).toEqual({
    expectedVersion: 3,
    settings: { weatherProviderId: 'apple-weather' },
  });
  await expect.poll(() => recCalls().length).toBeGreaterThan(before);
  await expect(picker).toHaveValue('apple-weather');
  const logo = page.getByRole('img', { name: 'Apple Weather' });
  await expect(logo).toHaveAttribute('src', /Apple_Weather_blk/);
  await expect(page.locator('.ro-attribution a').first()).toHaveAttribute(
    'href',
    APPLE_LEGAL,
  );
  await expect(page.locator('.ro-attribution')).toContainText(
    'derived from and modify Apple Weather data',
  );
  await page.locator('.ro-sign-out').scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('apple-weather.png') });
});

test('ended window: check-in, a different route, then the next windows', async ({
  context,
  worker,
  extensionId,
}) => {
  routes.r102 = coast();
  selection.routeIds = ['r101', 'r102'];
  await signIn(worker);
  await worker.evaluate(
    `chrome.storage.local.set({ state: { shown: ${JSON.stringify(SHOWN)} } })`,
  );
  const page = await openPopup(context, extensionId);
  await page.emulateMedia({ reducedMotion: 'reduce' }); // screenshots skip the slide
  const checkin = page.locator('.ro-checkin');
  await expect(checkin).toContainText('Did you ride Hilly Loop?');
  await expect(checkin).toContainText(`Yesterday, ${shortDate(day(-1))}`);
  await expect(checkin).toContainText(
    /It was your top pick: 51 km, leave \d\d:\d\d, 14° and dry\./,
  );
  // One call for the windows after the one that ended; no per-day rankings.
  await expect
    .poll(() => calls.find((c) => c.path === '/recommendations/next-windows'))
    .toMatchObject({
      body: {
        routeIds: ['r101', 'r102'],
        after: { date: day(-1), window: { start: '08:00', end: '14:00' } },
      },
    });
  const windows = page.locator('.ro-next');
  await expect(windows).toHaveCount(3);
  // 08:00–14:00 crosses noon, so no part of the day is named.
  await expect(
    windows.nth(0).locator('.ro-next-top > span').first(),
  ).toHaveText('Tomorrow');
  await expect(windows.nth(0)).toContainText('Best available');
  await expect(windows.nth(0)).toContainText('Showers likely after 13:00');
  await expect(windows.nth(0)).toHaveAttribute('data-best', 'false');
  await expect(windows.nth(1)).toHaveAttribute('data-best', 'true');
  await expect(windows.nth(1)).toContainText('Best · 86');
  await expect(windows.nth(2)).toContainText('Best in the next 6 days');
  await expect(windows.nth(2)).toContainText('Hilly Loop');
  await expect(
    page.getByRole('link', { name: 'Powered by Met Office data' }),
  ).toBeVisible();
  expect(recCalls()).toEqual([]);
  await expectPanelFits(page);
  await page.screenshot({ path: test.info().outputPath('checkin.png') });

  // Yes logs yesterday's ride with what was recommended; Undo deletes it.
  await page.getByRole('button', { name: 'Yes, I rode it' }).click();
  await expect(checkin).toHaveAttribute('data-pane', 'done');
  await expect(page.locator('.ro-done')).toContainText(
    'Nice ride on Hilly Loop. Saved to History.',
  );
  const [logged] = rideCalls('POST');
  expect(logged.key).toMatch(/^[0-9a-f-]{36}$/);
  expect(logged.body).toEqual({
    routeId: 'r101',
    expectedRouteVersion: 1,
    riddenOn: day(-1),
    timeZone: 'Europe/London',
    plan: RIDE_PLAN,
  });
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(checkin).toHaveAttribute('data-pane', 'ask');
  expect(rideCalls('DELETE')).toHaveLength(1);
  expect(rides).toEqual([]);

  // A different route: pick it, then confirm. It wasn't a pick, so no plan.
  await page
    .getByRole('button', { name: 'I rode a different route ›' })
    .click();
  await expect(checkin).toHaveAttribute('data-pane', 'pick');
  await page.screenshot({ path: test.info().outputPath('checkin-pick.png') });
  await page.getByRole('radio', { name: /Coast & Back/ }).check();
  await expect(checkin).toHaveAttribute('data-pane', 'ask');
  await expect(checkin).toContainText('Did you ride Coast & Back?');
  await expect(checkin).toContainText(
    '35 km · instead of Hilly Loop, your top pick',
  );
  await page.getByRole('button', { name: 'Yes, I rode it' }).click();
  await expect(checkin).toHaveAttribute('data-pane', 'done');
  await expect(page.locator('.ro-done')).toContainText(
    'Nice ride on Coast & Back.',
  );
  await page.screenshot({ path: test.info().outputPath('checkin-done.png') });
  expect(rideCalls('POST')[1].body).toEqual({
    routeId: 'r102',
    expectedRouteVersion: 1,
    riddenOn: day(-1),
    timeZone: 'Europe/London',
  });
  expect(rideCalls('POST')[1].key).not.toBe(logged.key);

  // Tapping a window searches it; the confirmation stays on top.
  await windows.nth(0).click();
  await expect(page.locator('.ro-ride').first()).toContainText('Hilly Loop');
  await expect(page.locator('.ro-done')).toBeVisible();
  expect(recCalls()[0].body).toMatchObject({
    days: { kind: 'range', start: day(1), end: day(1) },
    riding: { window: { start: '08:00', end: '14:00' } },
  });
});

test('a route changed since the plan is logged only when asked', async ({
  context,
  worker,
  extensionId,
}) => {
  await signIn(worker);
  await worker.evaluate(
    `chrome.storage.local.set({ state: { shown: ${JSON.stringify(SHOWN)} } })`,
  );
  const page = await openPopup(context, extensionId);
  const checkin = page.locator('.ro-checkin');
  await expect(checkin).toContainText('Did you ride Hilly Loop?');
  routes.r101 = { ...routes.r101, version: 2 }; // re-imported elsewhere
  await page.getByRole('button', { name: 'Yes, I rode it' }).click();
  await expect(checkin).toContainText(
    'Hilly Loop has changed since this plan.',
  );
  expect(rides).toEqual([]);
  await page.getByRole('button', { name: 'Log the updated route' }).click();
  await expect(checkin).toHaveAttribute('data-pane', 'done');
  const [first, second] = rideCalls('POST');
  expect(first.body.expectedRouteVersion).toBe(1);
  expect(second.body).toEqual({
    routeId: 'r101',
    expectedRouteVersion: 2,
    riddenOn: day(-1),
    timeZone: 'Europe/London',
  });
  expect(second.key).not.toBe(first.key);
  expect(rides).toHaveLength(1);
});

test('History, recent roads and removal with undo', async ({
  context,
  worker,
  extensionId,
}) => {
  routes.r102 = coast();
  rides = [ride('r101', day(0), RIDE_PLAN), ride('r102', day(-40))];
  await signIn(worker);
  const page = await openPopup(context, extensionId);
  const card = page.locator('.ro-ride').first();
  await expect(card.locator('.ro-tag')).toHaveText('Ridden today');

  await page.getByRole('tab', { name: 'Preferences' }).click();
  const recent = page.locator('.ro-recent');
  await expect(recent).toContainText(
    'Routes that share roads with rides from the last 4 weeks score a little lower. The effect fades as the ride gets older.',
  );
  await recent.getByRole('button', { name: 'Prefer variety' }).click();
  await expect
    .poll(() => patches()[0]?.body)
    .toEqual({
      expectedVersion: 1,
      settings: { preferences: { recentRides: { mode: 'prefer-variety' } } },
    });
  await expectPanelFits(page);

  // The API marks the shared roads; the card says so.
  await page.getByRole('tab', { name: 'Rides' }).click();
  await expect(card.locator('.ro-tag')).toHaveText([
    'Ridden today',
    'Similar roads recently ridden',
  ]);

  await page.getByRole('tab', { name: 'History' }).click();
  const history = page.locator('.ro-history');
  await expect(history).toHaveCount(2);
  await expect(page.locator('.ro-month').first()).toBeVisible();
  await expect(history.nth(0)).toContainText('Hilly Loop');
  await expect(history.nth(0).locator('.ro-tag')).toHaveText('Ridden today');
  await expect(history.nth(0).locator('.ro-history-line')).toHaveText(
    `${shortDate(day(0))} · 51 km`,
  );
  await expect(history.nth(1)).toContainText(`${shortDate(day(-40))} · 35 km`);
  await expectPanelFits(page);
  await page.screenshot({ path: test.info().outputPath('history.png') });

  // × collapses the row; Undo within the window sends nothing.
  const removedId = rides.find((r) => r.routeId === 'r101')?.id;
  await history.nth(0).getByRole('button', { name: 'Remove ride' }).click();
  await expect(page.locator('.ro-removed')).toContainText('Ride removed');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.ro-removed')).toHaveCount(0);
  await expect(history).toHaveCount(2);

  // Left alone, it's deleted once the undo window passes.
  await history.nth(0).getByRole('button', { name: 'Remove ride' }).click();
  await expect(page.locator('.ro-removed')).toBeVisible();
  expect(rideCalls('DELETE')).toEqual([]);
  await expect
    .poll(() => rideCalls('DELETE').map((c) => c.path), { timeout: 15_000 })
    .toEqual([`/rides/${removedId}`]);
  await expect(history).toHaveCount(1);
  expect(rideCalls('POST')).toEqual([]);
});

// ---- cycle.travel Journeys page ----

const fakeCycleTravel = (context: BrowserContext) =>
  Promise.all([
    context.route('https://cycle.travel/**', (route) => {
      const { pathname } = new URL(route.request().url());
      if (pathname === '/user/journeys')
        return route.fulfill({ contentType: 'text/html', body: JOURNEYS });
      const journey = pathname.match(
        /^\/map\/journey\/(\d+)\/data\/with_pois$/,
      );
      if (journey)
        return route.fulfill({
          json: {
            name: journey[1] === '101' ? 'Hilly Loop' : 'Coast & Back',
            polyline: '_p~iF~ps|U_ulLnnqC_mqNvxq`@', // 3 points, precision 5
            legacy: true,
            distance: 64_000,
            updated_at: 1_760_000_000,
            full_osrm_url: 'https://routing-uk.cycle.travel/route?x=1',
          },
        });
      return route.fulfill({ status: 404, body: '' });
    }),
    context.route('https://routing-uk.cycle.travel/elevation', (route) =>
      route.fulfill({
        json: { elevation: 'SSH' }, // deltas 10, 10, -5 → 10, 20, 15 m
        headers: { 'access-control-allow-origin': '*' },
      }),
    ),
  ]);

test('Journeys page: Tracked routes, window button, row chips and + Track', async ({
  context,
  worker,
}) => {
  rides = [ride('r101', day(-3))];
  await signIn(worker);
  await fakeCycleTravel(context);
  const page = await context.newPage();
  await page.goto('https://cycle.travel/user/journeys');

  const module = page.locator('ride-on-module');
  await expect(module.locator('.ro-module-title')).toContainText(
    'Tracked routes1 / 12',
  );
  await expect(module.locator('.ro-ride')).toContainText('Hilly Loop');
  await expect(module.locator('.ro-ride .ro-name')).toHaveAttribute(
    'href',
    '/map/journey/101',
  );
  await expect(module.locator('.ro-window')).toHaveText(/ · Daylight hours$/);
  // The 11b tile: clock line, then temperature · wind · rain chips (9° is under the 10° comfort minimum).
  await expect(module.locator('.ro-ride .ro-when')).toHaveText(
    /^\w{3} \d{1,2} \w{3}·\d\d:\d\d → ~\d\d:\d\d$/,
  );
  const chips = module.locator('.ro-chips li');
  await expect(chips).toHaveText(['9–14°C', '15 km/h tailwind', 'Dry']);
  await expect(chips.nth(0)).toHaveAttribute('data-warn', 'true');
  await expect(chips.nth(1)).toHaveAttribute('aria-label', 'Tailwind 15 km/h');
  await expect(chips.nth(2)).toHaveAttribute('data-warn', 'false');
  await expect(
    module.getByRole('button', { name: 'Stop tracking Hilly Loop' }),
  ).toBeVisible();
  const chip = page.locator('#jr_101 .ro-chip');
  await expect(chip).toHaveText(/^\w{3} \d{1,2} · \d\d:\d\d$/);
  await expect(chip).toHaveAttribute('data-state', 'meets');
  await expect(page.locator('#jr_101')).toHaveAttribute(
    'data-ride-on-tracked',
    '',
  );
  await expect(page.locator('#jr_102 .ro-chip')).toHaveText('+ Track');
  // Ride tags sit after the journey name, on the row and on the card.
  await expect(page.locator('#jr_101 .ro-tags .ro-tag')).toHaveText(
    /^Last ridden \d{1,2} \w{3}$/,
  );
  await expect(module.locator('.ro-ride .ro-tag')).toHaveText(/^Last ridden/);
  await expect(page.locator('#jr_101')).toHaveAttribute(
    'data-ride-on-ridden',
    '',
  );
  await expect(page.locator('#jr_102 ride-on-tags')).toBeHidden();
  await expect(module.locator('.ro-grid')).toHaveAttribute(
    'data-loading',
    'false',
  );
  await page.screenshot({
    path: test.info().outputPath('journeys.png'),
    fullPage: true,
  });

  await page.locator('#jr_102 .ro-chip').click();
  await expect(page.locator('#jr_102 .ro-chip')).toHaveText(/ · /);
  await expect(module.locator('.ro-ride')).toHaveCount(2);
  await expect(module.locator('.ro-module-title')).toContainText('2 / 12');
  const imported = calls.find(
    (c) => c.path === '/route-imports' && c.body.source.externalId === '102',
  );
  expect(imported?.body).toMatchObject({
    source: { providerId: 'cycle-travel', externalId: '102' },
    name: 'Coast & Back',
  });
  expect(imported?.body.gpx).toContain('<ele>20</ele>');
  expect(selection.routeIds).toEqual(['r101', 'r102']);
});

test('Journeys page: a passed window asks for new dates, then rescores', async ({
  context,
  worker,
}) => {
  await signIn(worker);
  await worker.evaluate(
    `chrome.storage.local.set({ state: { shown: ${JSON.stringify(SHOWN)} } })`,
  );
  await fakeCycleTravel(context);
  const page = await context.newPage();
  await page.goto('https://cycle.travel/user/journeys');

  const module = page.locator('ride-on-module');
  const strip = module.locator('.ro-passed');
  await expect(strip).toHaveAttribute('data-phase', 'expired');
  await expect(strip).toContainText('Pick new dates to see scores');
  await expect(module.locator('.ro-window')).toHaveCount(0);
  // Same-size blank tiles; the row chips say Tracked, not a time.
  const tile = module.locator('.ro-ride');
  await expect(tile).toHaveAttribute('data-blank', 'true');
  await expect(tile).toContainText('Hilly Loop');
  await expect(page.locator('#jr_101 .ro-chip')).toHaveText('Tracked');
  await expect(
    strip.getByRole('button', { name: `Next ${longWeekday(day(6))}` }),
  ).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath('journeys-passed.png'),
    fullPage: true,
  });

  await strip.getByRole('button', { name: 'Tomorrow' }).click();
  await expect(strip).toHaveAttribute('data-phase', 'confirmed');
  await expect(strip).toContainText('Scores updated');
  // The half fading out keeps the dates that passed.
  await expect(strip.locator('> [aria-hidden="true"]')).toContainText(
    `${shortDate(day(-1))}, 08:00–14:00 has passed.`,
  );
  await expect(tile).toHaveAttribute('data-blank', 'false');
  await expect(tile.locator('.ro-score')).toContainText('Conditions 84/100');
  await expect(page.locator('#jr_101 .ro-chip')).toHaveText(
    /^\w{3} \d{1,2} · \d\d:\d\d$/,
  );
  expect(recCalls().at(-1)?.body).toMatchObject({
    days: { kind: 'range', start: day(1), end: day(1) },
    riding: { window: { start: '08:00', end: '14:00' } },
  });
  await page.screenshot({
    path: test.info().outputPath('journeys-confirmed.png'),
    fullPage: true,
  });
});

// Safari injects content scripts again into open pages (on enable, on site access).
test('Journeys page: injected twice, it shows once', async ({
  context,
  worker,
}) => {
  rides = [ride('r101', day(-3))];
  await signIn(worker);
  await fakeCycleTravel(context);
  const page = await context.newPage();
  await page.goto('https://cycle.travel/user/journeys');
  await expect(page.locator('#jr_101 .ro-chip')).toBeVisible();

  await worker.evaluate(
    `chrome.tabs.query({ url: 'https://cycle.travel/*' }).then(([tab]) => chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content-scripts/journeys.js'] }))`,
  );
  await expect(page.locator('ride-on-module')).toHaveCount(1);
  const rows = await page.locator('li.journey_row').count();
  await expect(page.locator('ride-on-chip')).toHaveCount(rows);
  await expect(page.locator('ride-on-tags')).toHaveCount(rows);
  // The newest copy is live.
  await expect(page.locator('ride-on-module .ro-ride')).toContainText(
    'Hilly Loop',
  );
  await expect(page.locator('#jr_101')).toHaveAttribute(
    'data-ride-on-tracked',
    '',
  );
});
