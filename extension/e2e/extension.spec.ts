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
import type { RouteSummary, User } from '../lib/types';
import { applyPatch } from '../ui/format';

const EXTENSION = path.resolve('.output/chrome-mv3-e2e');
const JOURNEYS = readFileSync(path.resolve('e2e/journeys.html'), 'utf8');
const day = (offset: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(
    Date.now() + offset * 86_400_000,
  );

// ---- Mock Ride On API v0.9.0 (port baked into the e2e build) ----

const APPLE_LEGAL =
  'https://developer.apple.com/weatherkit/data-source-attribution/';
const provider = (
  id: string,
  name: string,
  configured: boolean,
  freshnessBasis: string,
  attribution: object,
) => ({
  id,
  name,
  configured,
  recommendedSettings: {
    weather: { mode: 'strict', providerId: id },
    forecast: { representation: 'deterministic', freshnessBasis },
  },
  attribution: [attribution],
});
const METOFFICE = {
  text: 'Powered by Met Office data',
  url: 'https://www.metoffice.gov.uk/',
};
const PROVIDERS = [
  provider('apple-weather', 'Apple Weather', true, 'retrieval-time', {
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
  provider(
    'met-office',
    'Met Office Global Spot',
    true,
    'model-run',
    METOFFICE,
  ),
  provider(
    'met-office-bpf',
    'Met Office Blended Probabilistic',
    false,
    'model-run',
    METOFFICE,
  ),
];

let calls: { method: string; path: string; body: any }[] = [];
let user: User;
let selection: { version: number; routeIds: string[]; updatedAt: null };
let routes: Record<string, RouteSummary>;

const reset = () => {
  calls = [];
  user = {
    id: 'u1',
    version: 1,
    displayName: 'Test Rider',
    settings: {
      timeZone: 'Europe/London',
      weather: { mode: 'strict', providerId: 'met-office' }, // an existing profile
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
};

const recommendations = (date: string) => ({
  date,
  recommendedRouteId: selection.routeIds[0] ?? null,
  minimumStandardsStatus: 'not_configured',
  rankings: selection.routeIds.map((routeId, i) => ({
    routeId,
    routeName: routes[routeId].name,
    distanceKm: routes[routeId].distanceM / 1000,
    distanceFit: null,
    estimatedDurationMinutes: 180,
    daylight: { start: `${date}T06:15:00Z`, end: `${date}T17:20:00Z` },
    effectiveWindow: { start: `${date}T06:15:00Z`, end: `${date}T17:20:00Z` },
    status: 'assessed',
    departuresUnknown: 0,
    departuresStandardsUnknown: 0,
    best: {
      departureAt: `${date}T0${8 + i}:00:00Z`,
      finishAt: `${date}T1${1 + i}:00:00Z`,
      score: 84 - i * 10,
      standards: { status: 'not_configured', failures: [] },
      conditions: {
        temperatureC: { minimum: 9, maximum: 14 },
        averageWindSpeedKph: 15,
        averageHeadwindKph: 3,
        averageTailwindKph: 12,
        averageCrosswindKph: 4,
        maximumPrecipitationProbability: 0.05,
      },
    },
    issues: [],
    warnings: [],
  })),
  unranked: [],
  weather: {
    locations: [
      {
        provenance: {
          retrievedAt: new Date().toISOString(),
          attribution: PROVIDERS.find(
            (p) =>
              user.settings.weather.mode === 'strict' &&
              p.id === user.settings.weather.providerId,
          )?.attribution,
        },
      },
    ],
  },
});

const handle = (method: string, url: URL, body: any): [number, unknown] => {
  const key = `${method} ${url.pathname}`;
  if (key === 'GET /users/me') return [200, { user }];
  if (key === 'PATCH /users/me') {
    if (body.expectedVersion !== user.version)
      return [409, { error: { code: 'USER_VERSION_CONFLICT', message: 'x' } }];
    user = {
      ...user,
      version: user.version + 1,
      settings: {
        ...user.settings,
        weather: body.settings.weather ?? user.settings.weather,
        forecast: body.settings.forecast ?? user.settings.forecast,
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
        defaultPolicy: PROVIDERS[0].recommendedSettings.weather,
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
  if (key === 'POST /recommendations') return [200, recommendations(body.date)];
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
    calls.push({ method: req.method ?? 'GET', path: url.pathname, body });
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

test('Rides tab opens first with one request per forecast day', async ({
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
  await expect(card.locator('.ro-score')).toContainText('Comfort score 84/100');
  await expect(
    page.getByRole('link', { name: 'Powered by Met Office data' }),
  ).toHaveAttribute('href', 'https://www.metoffice.gov.uk/');
  await expectPanelFits(page);
  await expect(page.locator('.ro-sync')).toHaveCount(0);
  const dates = recCalls().map((c) => c.body.date);
  expect(dates).toContain(day(0));
  expect(new Set(dates).size).toBe(dates.length);
  expect(recCalls()[0].body).toEqual({
    routeIds: ['r101'],
    date: expect.any(String),
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
  await expect(page.locator('.ro-day')).toHaveCount(7);
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
  await expect(
    page.getByRole('button', { name: 'Next few days' }),
  ).toHaveAttribute('aria-pressed', 'true');
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

  // The saved Met Office choice shows; unconfigured providers don't.
  const picker = page.getByLabel('Forecast provider');
  await expect(picker).toHaveValue('met-office');
  await expect(picker.locator('option')).toHaveText([
    'Apple Weather',
    'Met Office Global Spot',
  ]);
  const before = recCalls().length;
  await picker.selectOption('apple-weather');
  await expect.poll(() => patches().length).toBe(3);
  expect(patches()[2].body).toEqual({
    expectedVersion: 3,
    settings: PROVIDERS[0].recommendedSettings,
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

test('Journeys page: Tracked routes, window button, row chips and + Consider', async ({
  context,
  worker,
}) => {
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
  await expect(module.locator('.ro-window')).toHaveText(/ · /);
  const chip = page.locator('#jr_101 .ro-chip');
  await expect(chip).toHaveText(/^\w{3} \d{1,2} · \d\d:\d\d$/);
  await expect(chip).toHaveAttribute('data-state', 'meets');
  await expect(page.locator('#jr_101')).toHaveAttribute(
    'data-ride-on-tracked',
    '',
  );
  await expect(page.locator('#jr_102 .ro-chip')).toHaveText('+ Consider');
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
