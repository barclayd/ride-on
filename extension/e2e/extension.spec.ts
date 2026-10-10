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

const EXTENSION = path.resolve('.output/chrome-mv3-e2e');
const JOURNEYS = readFileSync(path.resolve('e2e/journeys.html'), 'utf8');
const day = (offset: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(
    Date.now() + offset * 86_400_000,
  );

// ---- Mock Ride On API (port baked into the e2e build) ----

type Route = {
  id: string;
  name: string;
  distanceM: number;
  source: { providerId: string; externalId: string };
  version: number;
  updatedAt: string;
};
let calls: { method: string; path: string; body: any }[] = [];
let user: any;
let selection: { version: number; routeIds: string[]; updatedAt: null };
let routes: Record<string, Route>;

const reset = () => {
  calls = [];
  user = {
    id: 'u1',
    version: 1,
    displayName: 'Test Rider',
    settings: {
      timeZone: 'Europe/London',
      planning: {
        days: { kind: 'preset', preset: 'next' },
        window: { start: '06:00', end: '20:00' },
      },
      preferences: {
        temperature: { comfortMinC: 10, comfortMaxC: 22 },
        wind: { comfortableHeadwindKph: 15 },
        minimumStandards: {},
      },
    },
    preferenceLevels: {
      sunshine: 'nice',
      rain: 'light-ok',
      climbing: 'neutral',
      comfortableWindKph: 15,
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

const recommendations = () => ({
  message: 'ok',
  rankings: selection.routeIds.map((routeId, i) => ({
    routeId,
    routeName: routes[routeId].name,
    distanceKm: routes[routeId].distanceM / 1000,
    issues: [],
    confidence: 3,
    verdict: { status: 'ride', reason: null },
    best: {
      date: day(0),
      departureAt: `${day(0)}T0${8 + i}:00:00Z`,
      finishAt: `${day(0)}T1${1 + i}:00:00Z`,
      score: 84 - i * 10,
      conditions: {
        temperatureC: { minimum: 9, maximum: 14 },
        averageWindSpeedKph: 15,
        averageHeadwindKph: 3,
        averageTailwindKph: 12,
        averageCrosswindKph: 4,
        maximumPrecipitationProbability: 0.05,
      },
      drawbacks: [],
    },
  })),
  unranked: [],
  range: { start: day(0), end: day(4), preset: 'next', fallback: false },
  days: [0, 1, 2, 3, 4].map((offset) => ({
    date: day(offset),
    daylight: {
      sunrise: `${day(offset)}T06:15:00Z`,
      sunset: `${day(offset)}T17:20:00Z`,
    },
    temperatureMaxC: 14,
    quality: 80 - offset * 8,
  })),
});

const handle = (method: string, url: URL, body: any): [number, unknown] => {
  const key = `${method} ${url.pathname}`;
  if (key === 'GET /users/me') return [200, user];
  if (key === 'PATCH /users/me') {
    const { planning, preferenceLevels } = body.settings;
    user = {
      ...user,
      version: user.version + 1,
      settings: { ...user.settings, ...(planning && { planning }) },
      preferenceLevels: { ...user.preferenceLevels, ...preferenceLevels },
    };
    return [200, user];
  }
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
  if (key === 'POST /recommendations') return [200, recommendations()];
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

const signIn = (worker: Worker) =>
  worker.evaluate("chrome.storage.local.set({ token: 'test-token' })");

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
  const panel = await box(page, '.ro-panel');
  expect(panel.width).toBe(380);
  expect(panel.height).toBeLessThan(600);
  await page.screenshot({ path: test.info().outputPath('signed-out.png') });
});

test('When tab: fixed header, Days and Time fully visible, list ranked', async ({
  context,
  worker,
  extensionId,
}) => {
  await signIn(worker);
  const page = await openPopup(context, extensionId);
  await expect(page.locator('.ro-best')).toContainText('Hilly Loop');
  const panel = await box(page, '.ro-panel');
  expect(panel.width).toBe(380);
  expect(panel.height).toBeLessThanOrEqual(600);
  const time = await box(page, '.ro-card:has(.ro-label:text-is("Time"))');
  expect(time.y + time.height).toBeLessThanOrEqual(panel.y + panel.height);
  expect(calls.find((c) => c.path === '/recommendations')?.body).toMatchObject({
    routeIds: ['r101'],
    days: { kind: 'preset', preset: 'next' },
  });
  await page.screenshot({ path: test.info().outputPath('when.png') });

  await page.getByRole('button', { name: 'Weekend' }).click();
  await expect
    .poll(() => calls.find((c) => c.method === 'PATCH')?.body)
    .toEqual({
      expectedVersion: 1,
      settings: {
        planning: {
          days: { kind: 'preset', preset: 'weekend' },
          window: { start: '06:00', end: '20:00' },
        },
      },
    });
});

test('Preferences: save sends only the changed level', async ({
  context,
  worker,
  extensionId,
}) => {
  await signIn(worker);
  const page = await openPopup(context, extensionId);
  await page.getByRole('tab', { name: 'Preferences' }).click();
  const save = page.getByRole('button', { name: 'Save preferences' });
  await expect(save).toBeDisabled();
  await page.getByRole('button', { name: 'Avoid any' }).click();
  await expect(page.getByText('Unsaved changes')).toBeVisible();
  const panel = await box(page, '.ro-panel');
  const bar = await box(page, '.ro-save');
  expect(Math.round(bar.y + bar.height)).toBe(
    Math.round(panel.y + panel.height),
  );
  await page.screenshot({ path: test.info().outputPath('preferences.png') });
  await save.click();
  await expect(
    page.getByText('Synced with your Ride On profile'),
  ).toBeVisible();
  expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({
    expectedVersion: 1,
    settings: { preferenceLevels: { rain: 'avoid' } },
  });
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

test('Journeys page: chips, pinned card and + Consider imports the route', async ({
  context,
  worker,
}) => {
  await signIn(worker);
  await fakeCycleTravel(context);
  const page = await context.newPage();
  await page.goto('https://cycle.travel/user/journeys');

  const module = page.locator('ride-on-module');
  await expect(module.locator('.ro-pinned')).toContainText('Hilly Loop');
  await expect(page.locator('#jr_101 .ro-chip')).toHaveText(/^Today /);
  await expect(page.locator('#jr_101')).toHaveAttribute(
    'data-ride-on-tracked',
    '',
  );
  await page.screenshot({
    path: test.info().outputPath('journeys.png'),
    fullPage: true,
  });

  await page.locator('#jr_102 .ro-chip').click();
  await expect(page.locator('#jr_102 .ro-chip')).toHaveText(/^Today /);
  await expect(module.locator('.ro-pinned')).toHaveCount(2);
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
