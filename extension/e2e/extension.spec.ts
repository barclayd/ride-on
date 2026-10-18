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
import { encodePolyline } from '../lib/cycletravel';
import type { Ride, RidePlan, RouteSummary, User } from '../lib/types';
import {
  addDays,
  applyPatch,
  datesLabel,
  dayOfMonth,
  instant,
  longWeekday,
  newest,
  planningDates,
  shortDate,
  weekday,
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
let sunshineUncertain: boolean;
let replays: Map<string, Ride>;
let scores: Record<string, number>; // a route's score, in place of 84 then 44
let freshFor: number; // hours until the forecast behind the scores goes stale
let pauseDown: boolean; // pause writes fail

const reset = () => {
  calls = [];
  providerDown = false;
  sunshineUncertain = false;
  replays = new Map();
  scores = {};
  freshFor = 3;
  pauseDown = false;
  user = {
    id: 'u1',
    version: 1,
    displayName: 'Test Rider',
    pause: null,
    weatherProviderId: 'met-office',
    preferenceLevels: { sunshine: 'nice', rain: 'light-ok' },
    settings: {
      timeZone: 'Europe/London',
      weather: { mode: 'strict', providerId: 'met-office-bpf' }, // an existing profile
      forecast: {
        representation: 'deterministic',
        freshnessBasis: 'model-run',
      },
      preferences: {
        temperature: { comfortMinC: 10, comfortMaxC: 22 },
        wind: {
          comfortableHeadwindKph: 15,
          comfortableCrosswindKph: 20,
          preferTailwind: false,
        },
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
  skyConditionDistanceFractions: {
    sunny: 0.2,
    sunnyIntervals: 0.5,
    cloudy: 0.3,
    overcast: 0,
    obscured: 0,
  },
  maximumGustKph: 48,
  gustExposure: {
    directionBasis: 'prevailing-wind-estimate' as const,
    maximumAdverseKph: 48,
  },
  windDistanceFractions: { headwind: 0.1, tailwind: 0.7, crosswind: 0.2 },
  windFromDegrees: 225,
  precipitationSummary: 'dry' as const,
};
// A loop out north-east and home west (docs/extension-api-brief-v7.md), [latitude, longitude, metres].
const OUTLINE = {
  version: 1,
  points: [
    [51.46, -0.3, 0],
    [51.5, -0.26, 10_000],
    [51.54, -0.22, 20_000],
    [51.52, -0.16, 30_000],
    [51.48, -0.14, 40_000],
    [51.46, -0.22, 45_000],
    [51.46, -0.3, 50_000],
  ],
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
  refreshAt: new Date(Date.now() + freshFor * 3_600_000).toISOString(),
  attribution:
    PROVIDERS.find((p) => p.id === user.weatherProviderId)?.attribution ?? [],
});
const best = (date: string, i: number, score: number) => ({
  date,
  departureAt: `${date}T0${8 + i}:00:00Z`,
  finishAt: `${date}T1${1 + i}:00:00Z`,
  score,
  standards: { status: 'not_configured', failures: [] },
  windAssistance: {
    usefulDistanceFraction: 0.7,
    potentialPoints: 1.4,
    appliedPoints: 1.4,
  },
  // The API nulls the shares when any sky symbol is missing.
  conditions: sunshineUncertain
    ? { ...CONDITIONS, skyConditionDistanceFractions: null }
    : CONDITIONS,
  forecastDetails: {
    temperatureMethod: 'linear-interpolation',
    locations: [0, 1].map((site) => ({
      source: {
        providerId: 'met-office-bpf',
        productId: 'uk-blended-probabilistic-v2',
        adapterVersion: '2',
      },
      sourceLocationId: site === 0 ? '00353202' : '00353260',
      coordinate: { latitude: 51.4609 + site * 0.01, longitude: -0.3022 },
      retrievedAt: `${date}T06:23:00Z`,
      forecastRunAt: null,
      temperatureStatistic: { kind: 'percentile', percentile: 50 },
      gustStatistic: { kind: 'percentile', percentile: 50 },
      routePeriods: [{ start: `${date}T08:30:00Z`, end: `${date}T10:15:00Z` }],
      temperatures: [10, 12.5, 15.25, 17].map((value, h) => ({
        at: `${date}T${String(8 + h).padStart(2, '0')}:00:00Z`,
        celsius: value + site,
      })),
      gusts: [
        {
          start: `${date}T10:00:00Z`,
          end: `${date}T11:00:00Z`,
          maximumKph: 29.7 + site,
        },
      ],
    })),
  },
  sunshineAssessment: sunshineUncertain
    ? { status: 'partial', unknownDistanceFraction: 0.4 }
    : { status: 'complete', unknownDistanceFraction: 0 },
  // Intervals and cloud, then sun: the sky chip's timeline (handoff v4).
  rideHours: [
    { sunny: 0, sunnyIntervals: 0.6, cloudy: 0.4 },
    { sunny: 0.4, sunnyIntervals: 0.4, cloudy: 0.2 },
  ].map((sky, h) => ({
    start: `${date}T${String(8 + i + h).padStart(2, '0')}:00:00Z`,
    end: `${date}T${String(9 + i + h).padStart(2, '0')}:00:00Z`,
    conditions: {
      ...CONDITIONS,
      distanceKm: 25,
      // Dry, then drizzle possible (handoff v7, 25b).
      maximumPrecipitationProbability: [0.05, 0.45][h],
      maximumPrecipitationAmountMm: [0, 0.6][h],
      // The second hour crosses the forecast horizon.
      skyConditionDistanceFractions:
        sunshineUncertain && h === 1
          ? null
          : { ...sky, overcast: 0, obscured: 0 },
    },
  })),
  // Feels cooler than the 10° minimum until 2½ hours in, on a colder day than usual (24a).
  temperatureAlongRide: {
    points: [
      [0, 9, 6, 9.5],
      [60, 10, 7, 11],
      [120, 12, 9, 12.5],
      [180, 14, 11, 13],
    ],
    feelsLikeBasis: 'derived',
    usual: {
      month: Number(date.slice(5, 7)),
      averageHighC: 15,
      averageLowC: 8,
      bandHalfWidthC: 2.5,
      differenceC: -2.4,
      method: 'monthly-diurnal-estimate',
      coveredDistanceFraction: 1,
      source: {
        attribution:
          'Contains Met Office data licensed under the Open Government Licence v3.0.',
      },
    },
  },
  // Out with the south-westerly behind, then across it and home into it, where the gusts are.
  windStretches: (
    [
      [0, 30_000, 'tailwind', 225, 15, 0, 0, 72],
      [30_000, 40_000, 'crosswind', 270, 15, 20, 72, 96],
      [40_000, 50_000, 'headwind', 270, 16, 48, 96, 120],
    ] as const
  ).map(([fromM, toM, effect, from, kph, adverse, start, end]) => {
    const at = (minutes: number) =>
      new Date(
        Date.parse(`${date}T0${8 + i}:00:00Z`) + minutes * 60_000,
      ).toISOString();
    return {
      fromM,
      toM,
      startAt: at(start),
      endAt: at(end),
      effect,
      windFromDegrees: from,
      averageWindSpeedKph: kph,
      maximumAdverseGustKph: adverse,
    };
  }),
  // Only the first route has an opportunity; never shown as a number.
  tailwindOpportunity: { priorityPoints: i === 0 ? 3.17 : 0 },
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
    warnings:
      kind === 'tomorrow'
        ? ['ASCENT_IS_UNSMOOTHED_ESTIMATE', 'Showers likely after 13:00']
        : ['ASCENT_IS_UNSMOOTHED_ESTIMATE'],
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
    daySummary(i, !!planned?.includes(day(i))),
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
    ? selection.routeIds
        .map((routeId, i) => ({
          routeId,
          routeName: routes[routeId].name,
          distanceKm: routes[routeId].distanceM / 1000,
          outline: OUTLINE,
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
            ...best(date, i, scores[routeId] ?? 84 - i * 40), // a second route scores 44: Not recommended
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
        .sort((a, b) => b.best.score - a.best.score)
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
    range: date
      ? {
          start: date,
          end: ranged.at(-1)?.date,
          dates: ranged.map((d) => d.date),
        }
      : null,
    expired: !planned,
    days,
    weather: weather(),
  };
};

const handle = (method: string, url: URL, body: any): [number, unknown] => {
  const key = `${method} ${url.pathname}`;
  // At its return instant the API reads as on, without a write.
  if (key === 'GET /users/me')
    return [
      200,
      {
        user:
          user.pause?.resumesAt &&
          Date.parse(user.pause.resumesAt) <= Date.now()
            ? { ...user, pause: null }
            : user,
      },
    ];
  if (key === 'PUT /users/me/pause' || key === 'DELETE /users/me/pause') {
    if (pauseDown)
      return [503, { error: { code: 'UNAVAILABLE', message: 'x' } }];
    user = {
      ...user,
      pause:
        method === 'DELETE'
          ? null
          : {
              until: body.until,
              resumesAt:
                body.until && instant(body.until, '00:00', 'Europe/London'),
              pausedAt: user.pause?.pausedAt ?? new Date().toISOString(),
            },
    };
    return [200, { user }];
  }
  if (key === 'PATCH /users/me') {
    if (body.expectedVersion !== user.version)
      return [409, { error: { code: 'USER_VERSION_CONFLICT', message: 'x' } }];
    const choice = body.settings.weatherProviderId;
    user = {
      ...user,
      version: user.version + 1,
      weatherProviderId: choice ?? user.weatherProviderId,
      preferenceLevels: {
        ...user.preferenceLevels,
        ...body.settings.preferenceLevels,
      },
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
      distanceM: routes[id]?.distanceM ?? 64_000,
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
// What reached the profile: each PUT's until, or DELETE.
const pauseCalls = () =>
  calls
    .filter((c) => c.path === '/users/me/pause')
    .map((c) => (c.method === 'DELETE' ? 'DELETE' : c.body.until));
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
      // An English, metric region: the units default to °C and km/h (en-US would pick °F and mph).
      locale: 'en-IE',
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
  // The medal says it's the best pick; no pill for meeting the preferences either.
  await expect(card.locator('.ro-pill')).toHaveCount(0);
  await expect(card.locator('.ro-meter')).toHaveText('Conditions84/100');
  await expect(page.locator('.ro-heading')).toContainText('Next 5 days');
  await expectPanelFits(page);
  await expect(page.locator('.ro-sync')).toHaveCount(0);
  expect(recCalls()).toHaveLength(1);
  expect(recCalls()[0].body).toEqual({
    routeIds: ['r101'],
    // Next 5 days starts tomorrow
    days: { kind: 'dates', dates: [day(1), day(2), day(3), day(4), day(5)] },
    previewDays: 7,
    riding: { window: 'daylight' },
  });
  await page.screenshot({ path: test.info().outputPath('rides.png') });
});

test('alerts on one ride; Edit removes a ride and Undo brings it back', async ({
  context,
  worker,
  extensionId,
}) => {
  routes.r102 = coast();
  selection.routeIds = ['r101', 'r102'];
  await signIn(worker);
  const page = await openPopup(context, extensionId);
  const rides = page.locator('.ro-ride');
  await expect(rides).toHaveCount(2);
  const toast = page.locator('.ro-toast');
  const message = toast.locator('span');
  const hilly = rides.filter({ hasText: 'Hilly Loop' });
  const coastCard = rides.filter({ hasText: 'Coast & Back' });

  // One ride at a time: a second bell moves the alerts, and Undo moves them back.
  await page.getByRole('button', { name: 'Get alerts for Hilly Loop' }).click();
  await expect(message).toHaveText('Alerts on for Hilly Loop');
  await expect(toast).toHaveAttribute('data-show', 'true');
  await expect(hilly).toHaveClass(/ro-alert/);
  await expect(
    page.getByRole('button', {
      name: 'Alerts on for Hilly Loop. Turn off alerts',
    }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page
    .getByRole('button', { name: 'Get alerts for Coast & Back' })
    .click();
  await expect(message).toHaveText(
    'Alerts moved from Hilly Loop to Coast & Back',
  );
  await expect(coastCard).toHaveClass(/ro-alert/);
  await expect(hilly).not.toHaveClass(/ro-alert/);
  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect(hilly).toHaveClass(/ro-alert/);
  await expect(coastCard).not.toHaveClass(/ro-alert/);
  await expect(toast).toHaveAttribute('data-show', 'false');
  // The tile with alerts keeps its size: 1px less padding for the 1px heavier border.
  const [a, b] = [await hilly.boundingBox(), await coastCard.boundingBox()];
  expect(a?.width).toBe(b?.width);
  await page.screenshot({ path: test.info().outputPath('alerts.png') });

  // Edit swaps every bell for an ×; removing the ride with alerts turns them off.
  await page.getByRole('button', { name: 'Edit' }).click();
  await expect(page.locator('.ro-bell')).toHaveCount(0);
  await page.getByRole('button', { name: 'Stop tracking Hilly Loop' }).click();
  await expect(rides).toHaveCount(1);
  await expect(message).toHaveText('Stopped tracking Hilly Loop. Alerts off.');
  await expect(
    page.getByRole('button', { name: 'Stop tracking Coast & Back' }),
  ).toBeFocused();
  await expect.poll(() => selection.routeIds).toEqual(['r102']);
  await page.screenshot({ path: test.info().outputPath('alerts-edit.png') });
  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect(rides).toHaveCount(2);
  await expect.poll(() => selection.routeIds).toEqual(['r101', 'r102']);
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(
    page.getByRole('button', {
      name: 'Alerts on for Hilly Loop. Turn off alerts',
    }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Alerts on for Hilly Loop. Turn off alerts' })
    .click();
  await expect(message).toHaveText('Alerts off for Hilly Loop');
  await expect(page.locator('.ro-alert')).toHaveCount(0);
  await expectPanelFits(page);
});

test('a refresh shows how scores changed, then moves the rides into order', async ({
  context,
  worker,
  extensionId,
}) => {
  routes.r102 = coast();
  selection.routeIds = ['r101', 'r102'];
  await signIn(worker);
  const page = await openPopup(context, extensionId);
  const cards = page.locator('.ro-ride');
  await expect(cards.first()).toContainText('Hilly Loop');
  await expect(page.locator('.ro-heading')).toContainText('Updated just now');
  scores = { r102: 90 };
  await page.getByRole('button', { name: 'Refresh forecast' }).click();
  // Step 1, in place: the score changes on the second card.
  await expect(cards.nth(1).locator('.ro-delta')).toHaveText('▲ 46');
  await expect(cards.nth(1)).toContainText('Coast & Back');
  // Step 2: it moves to the top and takes the gold medal.
  await expect(cards.first()).toContainText('Coast & Back');
  await expect(cards.first().locator('.ro-medal')).toHaveText('1');
  await expect(cards.first().locator('.ro-meter')).toHaveAttribute(
    'aria-valuenow',
    '90',
  );
  await expect(cards.nth(1).locator('.ro-medal')).toHaveText('2');
  await expect(page.locator('.ro-rides > [aria-live]')).toHaveText(
    'Forecast updated. Coast & Back is now top, then Hilly Loop.',
  );
  await expect(cards.first().locator('.ro-meter strong')).toHaveText('90');
  await expect(
    page.getByRole('button', { name: 'Refresh forecast' }),
  ).toBeEnabled();
  await page.screenshot({ path: test.info().outputPath('reordered.png') });
});

test('badges show what changed since the rides were last on screen', async ({
  context,
  worker,
  extensionId,
}) => {
  await signIn(worker);
  const page = await openPopup(context, extensionId);
  const meter = page.locator('.ro-ride').first().locator('.ro-meter');
  await expect(meter).toHaveText('Conditions84/100');
  const rescore = async (score: number, mode: string) => {
    await page.getByRole('tab', { name: 'Preferences' }).click();
    scores = { r101: score };
    const before = recCalls().length;
    await page.getByRole('button', { name: mode }).click();
    await expect.poll(() => recCalls().length).toBe(before + 1);
  };

  // Rescored while Preferences was open: back on Rides, the badge says how far.
  await rescore(70, 'Prefer variety');
  await page.getByRole('tab', { name: 'Rides' }).click();
  await expect(meter.locator('.ro-delta')).toHaveText('▼ 14');
  await expect(meter.locator('strong')).toHaveText('70');

  // Rescored, then the popup closed: reopening still shows the change.
  await rescore(80, 'Happy to repeat');
  await page.close();
  const again = await openPopup(context, extensionId);
  const badge = again.locator('.ro-ride .ro-delta');
  await expect(badge).toHaveText('▲ 10');
  await again.close();
  // Seen, so the next visit is clear.
  const third = await openPopup(context, extensionId);
  await expect(third.locator('.ro-ride .ro-meter strong')).toHaveText('80');
  await expect(third.locator('.ro-delta')).toHaveCount(0);
});

test('reopening reuses fresh scores; a stale forecast or the refresh button ranks again', async ({
  context,
  worker,
  extensionId,
}) => {
  await signIn(worker);
  const reopen = async () => {
    const summaries = calls.filter((c) => c.path === '/rides/summaries');
    const page = await openPopup(context, extensionId);
    await expect(page.locator('.ro-ride').first()).toContainText('Hilly Loop');
    // The rank decision comes before the summaries request lands.
    await expect
      .poll(() => calls.filter((c) => c.path === '/rides/summaries').length)
      .toBeGreaterThan(summaries.length);
    await page.waitForTimeout(300);
    return page;
  };
  freshFor = -1; // stale as soon as it arrives
  await (await reopen()).close();
  expect(recCalls()).toHaveLength(1);
  freshFor = 3;
  await (await reopen()).close();
  expect(recCalls()).toHaveLength(2);
  const page = await reopen();
  expect(recCalls()).toHaveLength(2);
  await expect(page.locator('.ro-heading')).not.toContainText('Updating');
  await page.getByRole('button', { name: 'Refresh forecast' }).click();
  await expect.poll(() => recCalls().length).toBe(3);
  await expect(page.locator('.ro-heading')).not.toContainText('Updating');
  await page.close();
  // Simulate upgrading with a fresh ranking stored by the previous extension.
  await worker.evaluate(`chrome.storage.local.get('state').then(({ state }) => {
    state.recsKey = JSON.stringify(JSON.parse(state.recsKey).slice(1));
    return chrome.storage.local.set({ state });
  })`);
  await (await reopen()).close();
  expect(recCalls()).toHaveLength(4);
  await (await reopen()).close();
  expect(recCalls()).toHaveLength(4);
});

test('gust comfort saves separately; the wind dropdown says where the gusts are', async ({
  context,
  worker,
  extensionId,
}) => {
  await signIn(worker);
  const page = await openPopup(context, extensionId);
  const card = page.locator('.ro-ride').first();
  await card.getByRole('button', { name: /Show wind along the ride$/ }).click();
  // Into the wind on the way home, past the default 35 km/h comfort: amber.
  const gusts = card.locator('.ro-gusts');
  await expect(gusts).toHaveAttribute('data-warn', 'true');
  await expect(gusts.locator('b')).toHaveText('Gusts up to 48 km/h');
  await expect(gusts.locator('span')).toHaveText(
    /^Into your face on the way back, \d\d:\d\d–\d\d:\d\d\. Over your 35 km\/h comfort\.$/,
  );
  await expectPanelFits(page);
  await page.screenshot({ path: test.info().outputPath('wind-dropdown.png') });
  await page.getByRole('tab', { name: 'Preferences' }).click();
  await page.getByRole('button', { name: /Wind preferences/ }).click();
  const gust = page.getByRole('slider', { name: 'Gust comfort' });
  await gust.fill('25');
  await expect
    .poll(
      () => patches().at(-1)?.body.settings.preferences.wind.comfortableGustKph,
    )
    .toBe(25);
  expect(
    patches().at(-1)?.body.settings.preferences.minimumStandards.maximumGustKph,
  ).toBeNull();
  await expect(page.locator('.ro-sync')).toHaveText('Synced');
  await expectPanelFits(page);
  await page.screenshot({ path: test.info().outputPath('gust-comfort.png') });

  // Ideal wind: the API's default is calm; Tailwind saves and re-ranks.
  const ideal = page.getByRole('radiogroup', { name: 'Ideal wind' });
  await expect(ideal.getByRole('radio', { name: 'Calm' })).toBeChecked();
  const before = recCalls().length;
  await ideal.getByRole('radio', { name: 'Tailwind' }).check();
  await expect
    .poll(() => patches().at(-1)?.body.settings.preferences.wind.preferTailwind)
    .toBe(true);
  await expect.poll(() => recCalls().length).toBeGreaterThan(before);
  await expect(page.getByText(/wind behind you rank higher/)).toBeVisible();
  await page
    .getByRole('button', { name: /Wind preferences/ })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('ideal-wind.png') });
  await page.getByRole('button', { name: /Wind preferences/ }).click();
  await expect(
    page.getByRole('button', { name: /Wind preferences/ }),
  ).toContainText('Prefer a tailwind · headwind up to 15 km/h');
  await expect(page.locator('.ro-sync')).toHaveText('Synced');
});

test('a scored ride explains uncertain sunshine in the popup and on Journeys', async ({
  context,
  worker,
  extensionId,
}) => {
  sunshineUncertain = true;
  await signIn(worker);
  const page = await openPopup(context, extensionId);
  const card = page.locator('.ro-ride').first();
  await expect(card).toContainText('Hilly Loop');
  await expect(card.locator('.ro-coverage')).toHaveText(
    'Sunshine is uncertain for this ride.',
  );
  // The dashed sky chip; the Rides card opens the same timeline.
  const sky = card.locator('.ro-sky-chip button');
  await expect(sky).toHaveAttribute('data-partial', 'true');
  await sky.click();
  await expect(sky).toHaveText('Sunny intervals');
  await expect(card.locator('.ro-sky li')).toHaveText([
    'Sunny intervals~30%',
    'Cloud~20%',
    'Not forecast yet~50%',
  ]);
  await expect(card.locator('.ro-meter')).toHaveText('Conditions84/100');
  await expectPanelFits(page);
  await page.screenshot({
    path: test.info().outputPath('uncertain-sunshine.png'),
  });
  const journeys = await context.newPage();
  await fakeCycleTravel(context);
  await journeys.goto('https://cycle.travel/user/journeys');
  await expect(
    journeys.locator('.ro-ride').first().locator('.ro-coverage'),
  ).toHaveText('Sunshine is uncertain for this ride.');
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

  // Days tap off and on, with no presets to snap to, and a gap stays a gap.
  const tiles = page.locator('.ro-day');
  await tiles.nth(3).click(); // Next 5 days loses a middle day
  await expect
    .poll(() => recCalls().at(-1)?.body.days)
    .toEqual({ kind: 'dates', dates: [day(1), day(2), day(4), day(5)] });
  await expect(tiles.nth(3)).toHaveAttribute('aria-pressed', 'false');
  await expect(
    page.locator('.ro-card-head:has(.ro-label:text-is("Days")) .ro-value'),
  ).toHaveText(datesLabel([day(1), day(2), day(4), day(5)]));
  await expect(page.locator('.ro-card .ro-note')).toHaveText(
    `${longWeekday(day(1))}, ${longWeekday(day(2))} and ${longWeekday(day(4))} available; ${longWeekday(day(5))}'s forecast only covers the morning.`,
  );
  await page.screenshot({ path: test.info().outputPath('when-gap.png') });
  await tiles.nth(3).click();
  await expect
    .poll(() => recCalls().at(-1)?.body.days)
    .toEqual({
      kind: 'dates',
      dates: [day(1), day(2), day(3), day(4), day(5)],
    });
  await expect(tiles.nth(3)).toHaveAttribute('aria-pressed', 'true');

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
  await expect(days.locator('.ro-days')).toHaveAttribute('data-stale', 'true');
  await page.screenshot({ path: test.info().outputPath('when-stale.png') });
  await expect(days.locator('.ro-day[aria-pressed="true"]')).toHaveCount(1);
  await expect(days.locator('.ro-day').nth(1)).toHaveAttribute(
    'aria-pressed',
    'true',
  );
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
    maximumTemperatureC: null,
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

  // Sunshine and rain are saved to the profile, so they reach the score.
  const sunshine = page.getByRole('group', { name: 'Sunshine' });
  await expect(
    sunshine.getByRole('button', { name: 'Nice to have' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await sunshine.getByRole('button', { name: 'Important' }).click();
  await expect.poll(() => patches().length).toBe(4);
  expect(patches()[3].body).toEqual({
    expectedVersion: 4,
    settings: { preferenceLevels: { sunshine: 'important' } },
  });
  await expect(
    sunshine.getByRole('button', { name: 'Important' }),
  ).toHaveAttribute('aria-pressed', 'true');
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
  await expect(windows).not.toContainText(['ASCENT_IS_UNSMOOTHED_ESTIMATE']);
  await expect(windows.nth(0)).toHaveAttribute('data-best', 'false');
  await expect(windows.nth(1)).toHaveAttribute('data-best', 'true');
  await expect(windows.nth(1)).toContainText('Best · 86');
  await expect(windows.nth(2)).toContainText('Best in the next 6 days');
  await expect(windows.nth(2)).toContainText('Hilly Loop');
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

test('the check-in asks about the ride with alerts, then the alerts end', async ({
  context,
  worker,
  extensionId,
}) => {
  routes.r102 = coast();
  selection.routeIds = ['r101', 'r102'];
  await signIn(worker);
  const shown = {
    ...SHOWN,
    picks: [
      ...SHOWN.picks,
      { routeId: 'r102', date: day(-1), ...PLAN, rank: 2 },
    ],
  };
  await worker.evaluate(
    `chrome.storage.local.set({ state: { shown: ${JSON.stringify(shown)}, alertRouteId: 'r102' } })`,
  );
  const page = await openPopup(context, extensionId);
  const checkin = page.locator('.ro-checkin');
  await expect(checkin).toContainText('Did you ride Coast & Back?');
  await expect(checkin).toContainText(
    /You had alerts on for it: 35 km, leave \d\d:\d\d, 14° and dry\./,
  );
  await page.getByRole('button', { name: 'Not this time' }).click();
  await expect(checkin).toHaveCount(0);
  await expect
    .poll(() =>
      worker.evaluate(
        "chrome.storage.local.get('state').then(({ state }) => state.alertRouteId)",
      ),
    )
    .toBe(null);
});

test('pausing hides forecasts until Ride On turns back on', async ({
  context,
  worker,
  extensionId,
}) => {
  await signIn(worker);
  freshFor = -1; // stale at once, so every open would normally rank again
  const page = await openPopup(context, extensionId);
  await expect(page.locator('.ro-ride').first()).toContainText('Hilly Loop');
  expect(recCalls()).toHaveLength(1);

  await page.getByRole('tab', { name: 'When' }).click();
  const card = page.locator('.ro-pause');
  const toggle = card.getByRole('switch', { name: 'Pause Ride On' });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect(card.locator('.ro-pause-return')).toHaveCount(0);
  await toggle.click();
  // After a week by default; the days and times stay, greyed out.
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(
    card.getByRole('button', { name: 'After a week' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(card).toContainText(`Back on ${shortDate(day(7))}.`);
  const pill = page.locator('.ro-paused-pill');
  await expect(pill).toHaveText(
    `Paused until ${weekday(day(7))} ${dayOfMonth(day(7))}`,
  );
  const dims = page.locator('.ro-dims');
  await expect(dims).toHaveCount(3);
  for (const dim of await dims.all())
    await expect(dim).toHaveCSS('opacity', '0.45');
  await card.getByRole('button', { name: 'After 3 days' }).click();
  await expect(card).toContainText(`Back on ${shortDate(day(3))}.`);
  await expect(pill).toHaveText(
    `Paused until ${weekday(day(3))} ${dayOfMonth(day(3))}`,
  );
  await expect
    .poll(() =>
      worker.evaluate(
        "chrome.alarms.get('resume').then((alarm) => alarm?.scheduledTime)",
      ),
    )
    .toBe(
      Date.parse(
        (await worker.evaluate(
          "chrome.storage.local.get('state').then(({ state }) => state.pause.resumesAt)",
        )) as string,
      ),
    );
  await card.getByRole('button', { name: 'When I choose' }).click();
  await expect(card).toContainText(
    'Stays paused until you switch it off here.',
  );
  await expect(pill).toHaveText('Paused');
  // Each choice is saved on the profile, so the rider's other devices follow.
  await expect.poll(pauseCalls).toEqual([day(7), day(3), null]);
  await expect
    .poll(() => worker.evaluate("chrome.alarms.get('resume')"))
    .toBeUndefined();
  await expectPanelFits(page);
  await page.screenshot({ path: test.info().outputPath('when-paused.png') });

  // The Rides tab has the status line and no cards; reopening asks for no forecasts.
  await page.getByRole('tab', { name: 'Rides' }).click();
  await expect(page.locator('.ro-paused')).toContainText('Ride On is paused.');
  await expect(page.locator('.ro-ride')).toHaveCount(0);
  const summaries = calls.filter((c) => c.path === '/rides/summaries').length;
  const again = await openPopup(context, extensionId);
  await expect(again.locator('.ro-paused')).toBeVisible();
  await expect
    .poll(() => calls.filter((c) => c.path === '/rides/summaries').length)
    .toBeGreaterThan(summaries);
  await again.waitForTimeout(300);
  expect(recCalls()).toHaveLength(1);
  await again.screenshot({ path: test.info().outputPath('rides-paused.png') });
  await again.close();

  // Turning back on fetches fresh scores straight away.
  await page.getByRole('button', { name: 'Turn back on' }).click();
  await expect(page.locator('.ro-ride').first()).toContainText('Hilly Loop');
  await expect(pill).toHaveCount(0);
  expect(recCalls()).toHaveLength(2);
  await expect.poll(pauseCalls).toEqual([day(7), day(3), null, 'DELETE']);
  await page.getByRole('tab', { name: 'When' }).click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect(dims.first()).toHaveCSS('opacity', '1');

  // A write that fails puts the switch back and says so.
  pauseDown = true;
  await toggle.click();
  await expect(card.locator('.ro-pause-error')).toHaveText(
    "Couldn't save that. Check your connection and try again.",
  );
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect(pill).toHaveCount(0);
  pauseDown = false;
  await toggle.click();
  await expect(card.locator('.ro-pause-error')).toHaveCount(0);
  await toggle.click(); // back on
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect.poll(() => pauseCalls().at(-1)).toBe('DELETE');
  await expect.poll(() => recCalls().length).toBe(3); // back on: fresh scores

  // Paused on another device: opening the panel shows it, with no forecasts.
  const rides = recCalls().length;
  user.pause = {
    until: day(3),
    resumesAt: instant(day(3), '00:00', 'Europe/London'),
    pausedAt: new Date().toISOString(),
  };
  const other = await openPopup(context, extensionId);
  await expect(other.locator('.ro-paused')).toContainText(
    `Ride On is paused until ${shortDate(day(3))}.`,
  );
  await other.waitForTimeout(300);
  expect(recCalls()).toHaveLength(rides);
  await other.close();
  // Turned back on there: fresh scores here.
  user.pause = null;
  const back = await openPopup(context, extensionId);
  await expect(back.locator('.ro-ride').first()).toContainText('Hilly Loop');
  await expect(back.locator('.ro-paused')).toHaveCount(0);
  expect(recCalls()).toHaveLength(rides + 1);
  // A daily read catches changes with the panel closed.
  expect(
    await worker.evaluate(
      "chrome.alarms.get('sync').then((alarm) => alarm?.periodInMinutes)",
    ),
  ).toBe(24 * 60);
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
            polyline: encodePolyline(
              [
                [51, -1],
                [51.03, -1],
                [51.06, -1],
              ],
              5,
            ),
            legacy: true,
            version: 2,
            directions: [
              [3336, 0, 13],
              [3336, 1, 15],
              [0, 2, 0],
            ],
            distance: journey[1] === '101' ? 51_000 : 64_000,
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
  // The 14a tile: Best pick on the top border, distance and time, chips (9° is under the 10° comfort minimum), then the score.
  await expect(module.locator('.ro-ride .ro-flags')).toHaveText('Best pick');
  await expect(module.locator('.ro-ride .ro-facts > span')).toHaveText('51 km');
  const meter = module.getByRole('meter', { name: 'Conditions score' });
  await expect(meter).toHaveAttribute('aria-valuenow', '84');
  await expect(meter).toContainText('Conditions84/100');
  await expect(module.locator('.ro-ride .ro-when')).toHaveText(
    /^\w{3} \d{1,2} \w{3}·\d\d:\d\d → ~\d\d:\d\d$/,
  );
  const chips = module.locator('.ro-chips li');
  await expect(chips).toHaveText([
    '9–14°C',
    'Sun and sunny intervals',
    '15 km/h tailwind',
    /^Drizzle possible \d\d:\d\d$/,
  ]);
  // Feels under the range for most of the ride: amber.
  const temp = module.getByRole('button', {
    name: 'Temperature 9–14°C, feels like 6–11°C. Show temperature along the ride',
  });
  await expect(temp).toHaveAttribute('data-warn', 'true');
  // The wind pill never shows gusts; this rider prefers calm, so the tailwind costs points.
  const wind = module.getByRole('button', {
    name: 'Tailwind 15 km/h, costs points. Show wind along the ride',
  });
  await expect(wind).toHaveAttribute('data-warn', 'true');
  // An hour at 40% or more turns the rain chip blue.
  const rain = module.getByRole('button', {
    name: /^Drizzle possible \d\d:\d\d\. Show rain along the ride$/,
  });
  await expect(rain).toHaveAttribute('data-wet', 'true');
  // The sky chip opens the expected conditions inside the tile, and closes it again.
  const sky = module.getByRole('button', {
    name: 'Sky: sun and sunny intervals. Show expected conditions',
  });
  await expect(sky).toHaveAttribute('aria-expanded', 'false');
  await sky.click();
  await expect(sky).toHaveAttribute('aria-expanded', 'true');
  const timeline = module.locator('.ro-sky');
  await expect(timeline.locator('b')).toHaveText(
    'Expected conditions along the ride',
  );
  await expect(timeline.locator('.ro-sky-bar span')).toHaveCount(4);
  await expect(timeline.locator('li')).toHaveText([
    'Sunny~20%',
    'Sunny intervals~50%',
    'Cloud~30%',
  ]);
  // Opening the wind closes the sky: one dropdown at a time.
  await wind.click();
  await expect(timeline).toBeHidden();
  await expect(module.locator('[aria-expanded="true"]')).toHaveCount(1);
  const along = module.locator('.ro-wind');
  await expect(along.locator('b').first()).toHaveText('Wind along the ride');
  await expect(along.locator('.ro-wind-bar span')).toHaveText(['SW', 'W', 'W']);
  await expect(along.locator('li')).toHaveText([
    'Tailwind15 km/h~60%',
    'Crosswind15 km/h~20%',
    'Headwind16 km/h~20%',
  ]);
  // The route sketch: halo and ribbon plus a run per effect, a start and no finish on a loop.
  const sketch = along.locator('.ro-wind-map svg');
  await expect(sketch.locator('polyline')).toHaveCount(5);
  await expect(sketch.locator('text').first()).toHaveText('Start');
  await expect(sketch.locator('.ro-wind-finish')).toHaveCount(0);
  // The wind key: a needle across the compass, then where the wind comes from and where it turns.
  await expect(sketch.locator('.ro-wind-cardinal')).toHaveText([
    'N',
    'E',
    'S',
    'W',
  ]);
  await expect(sketch.locator('.ro-wind-needle')).toHaveCount(1);
  await expect(sketch.locator('.ro-wind-from')).toHaveText([
    'From SW',
    'then W',
  ]);
  await expect(sketch.locator('.ro-wind-speed')).toHaveText('15 km/h');
  await expect(along.locator('.ro-sr')).toHaveText(
    'Heads north-east with the wind behind, then south across the wind, then west into the wind. Wind from the south-west, then west.',
  );
  // Hovering the bar puts a pointer on the route; leaving it takes the pointer away.
  const pointer = sketch.locator('.ro-wind-pointer');
  await expect(pointer).toHaveCount(0);
  await along.locator('.ro-wind-bar').hover({ position: { x: 4, y: 8 } });
  await expect(pointer).toHaveCount(1);
  const first = await pointer.getAttribute('transform');
  await along.locator('.ro-wind-bar').hover({ position: { x: 150, y: 8 } });
  await expect(pointer).not.toHaveAttribute('transform', first ?? '');
  await expect(pointer).toHaveCount(1);
  await module.screenshot({ path: test.info().outputPath('wind.png') });
  await along.locator('b').first().hover();
  await expect(pointer).toHaveCount(0);
  await wind.click();
  await expect(along).toBeHidden();
  await expect(module.locator('[aria-expanded="true"]')).toHaveCount(0);
  // Temperature along the ride (24a): against usual, the chart, then when it feels outside the range.
  await temp.click();
  const warmth = module.locator('.ro-temp');
  await expect(warmth.locator('b')).toHaveText('Temperature along the ride');
  await expect(warmth.locator('.ro-temp-usual strong')).toHaveText(
    '2° colder than usual',
  );
  await expect(warmth.locator('.ro-temp-usual span')).toHaveText(
    /^Usual for \d\d:\d\d–\d\d:\d\d in \w+: 7–16°C$/,
  );
  await expect(warmth.locator('p')).toHaveText(
    /^Feels cooler than your range \(down to 6°C\) until about \d\d:\d0, then in your range to the finish\.$/,
  );
  await expect(warmth.locator('.ro-temp-end')).toHaveText(['9°', '14°']);
  await expect(warmth.locator('.ro-temp-feels-label')).toHaveText('feels 6°');
  await expect(warmth.locator('.ro-temp-gutter span')).toHaveText([
    '22°',
    '10°',
  ]);
  await expect(warmth.locator('.ro-key li')).toHaveText([
    'Temperature',
    'Feels like',
    /^Usual in \w+$/,
    'Your range 10–22°C',
  ]);
  await expect(warmth.locator('small')).toHaveText(
    /^\w+ average here: high 15°, low 8°\. Contains Met Office data licensed under the Open Government Licence v3\.0\.$/,
  );
  await module.screenshot({ path: test.info().outputPath('temperature.png') });
  // Rain along the ride (25b) replaces it: a card per hour with its chance and amount.
  await rain.click();
  await expect(warmth).toBeHidden();
  await expect(temp).toHaveAttribute('aria-expanded', 'false');
  const wet = module.locator('.ro-rain');
  await expect(wet.locator('b').first()).toHaveText('Rain along the ride');
  await expect(wet.locator('strong')).toHaveText(
    /^Drizzle possible from about \d\d:\d\d$/,
  );
  await expect(wet.locator('p')).toHaveText(
    /^Drizzle possible from about (\d\d:\d\d) until the finish\. Heaviest around \1: light, 0\.6 mm in the hour, 45% chance\.$/,
  );
  const hours = wet.locator('.ro-rain-hours li');
  await expect(hours).toHaveText([
    /^\d\d:\d\d5%None0 mm$/,
    /^\d\d:\d\d45%Light0\.6 mm$/,
  ]);
  await expect(hours.nth(1)).toHaveAttribute('data-wet', 'true');
  await expect(wet.locator('.ro-key li')).toHaveText([
    'Chance of rain',
    'Light',
    'Moderate',
    'Heavy',
  ]);
  await module.screenshot({ path: test.info().outputPath('rain.png') });
  await rain.click();
  await expect(wet).toBeHidden();
  await expect(module.locator('[aria-expanded="true"]')).toHaveCount(0);
  // A tailwind opportunity orders the tiles but is never labelled, so every tile keeps one height.
  await expect(module.locator('.ro-ride')).not.toContainText(
    'tailwind opportunity',
  );
  await expect(
    module.getByRole('button', { name: 'Get alerts for Hilly Loop' }),
  ).toHaveAttribute('aria-pressed', 'false');
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
  await page.screenshot({
    path: test.info().outputPath('journeys.png'),
    fullPage: true,
  });

  await page.locator('#jr_102 .ro-chip').click();
  await expect(page.locator('#jr_102 .ro-chip')).toHaveText(/ · /);
  await expect(module.locator('.ro-ride')).toHaveCount(2);
  await expect(module.locator('.ro-module-title')).toContainText('2 / 12');
  // Under 50 is Best pick's opposite.
  await expect(
    module.locator('.ro-ride').nth(1).locator('.ro-pill'),
  ).toHaveText(['Not recommended']);
  // Tiles in a row share one height, so their Conditions bars line up for scanning.
  const tiles = module.locator('.ro-ride');
  const [a, b] = [
    await tiles.nth(0).boundingBox(),
    await tiles.nth(1).boundingBox(),
  ];
  expect(b?.y).toBe(a?.y);
  expect(b?.height).toBe(a?.height);
  const meters = module.getByRole('meter', { name: 'Conditions score' });
  expect((await meters.nth(1).boundingBox())?.y).toBe(
    (await meters.nth(0).boundingBox())?.y,
  );
  await module.screenshot({ path: test.info().outputPath('tiles.png') });
  const imported = calls.find(
    (c) => c.path === '/route-imports' && c.body.source.externalId === '102',
  );
  expect(imported?.body).toMatchObject({
    source: { providerId: 'cycle-travel', externalId: '102' },
    name: 'Coast & Back',
  });
  expect(imported?.body.gpx).toContain('<ele>20</ele>');
  expect(imported?.body.surface).toMatchObject({
    source: { providerId: 'cycle-travel', formatVersion: 2, mappingVersion: 1 },
    sections: [
      { surface: 'paved', sourceCode: 'mode:13' },
      { surface: 'unpaved', sourceCode: 'mode:15' },
    ],
  });
  expect(selection.routeIds).toEqual(['r101', 'r102']);

  // The Undo message's dock takes no room under the list.
  const listBottom = await module
    .locator('.ro-toast-dock')
    .evaluate(
      (dock) => dock.previousElementSibling?.getBoundingClientRect().bottom,
    );
  const sectionBottom = await module
    .locator('.ro-module')
    .evaluate((el) => el.getBoundingClientRect().bottom);
  expect(sectionBottom).toBeCloseTo(listBottom ?? 0, 0);

  // Edit mode on the page: the × takes the tile away, the row's chip goes back to + Track, and
  // Undo puts both back.
  const toast = module.locator('.ro-toast');
  await module.getByRole('button', { name: 'Edit' }).click();
  await module
    .getByRole('button', { name: 'Stop tracking Coast & Back' })
    .click();
  await expect(tiles).toHaveCount(1);
  await expect(toast.locator('span')).toHaveText(
    'Stopped tracking Coast & Back',
  );
  // It sits in the window's bottom right corner, over the page.
  await expect
    .poll(() =>
      toast.evaluate((el) => {
        const box = el.getBoundingClientRect();
        const { clientWidth, clientHeight } = document.documentElement;
        return [clientWidth - box.right, clientHeight - box.bottom].map(
          Math.round,
        );
      }),
    )
    .toEqual([24, 24]);
  await expect(page.locator('#jr_102 .ro-chip')).toHaveText('+ Track');
  await expect.poll(() => selection.routeIds).toEqual(['r101']);
  await page.screenshot({ path: test.info().outputPath('edit.png') });
  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect(tiles).toHaveCount(2);
  await expect.poll(() => selection.routeIds).toEqual(['r101', 'r102']);
  await module.getByRole('button', { name: 'Done' }).click();
  await expect(module.locator('.ro-bell')).toHaveCount(2);
});

test('existing tracked journeys get surface evidence once without another ranking request', async ({
  context,
  worker,
}) => {
  await signIn(worker);
  // A marker written by the previous extension must not prevent the first enrichment.
  await worker.evaluate(
    "chrome.storage.local.set({ seen: { '101': 1760000000 } })",
  );
  await fakeCycleTravel(context);
  const page = await context.newPage();
  await page.goto('https://cycle.travel/user/journeys');
  await expect
    .poll(() => calls.filter((c) => c.path === '/route-imports').length)
    .toBe(1);
  await page.waitForLoadState('networkidle');
  const imported = calls.find((c) => c.path === '/route-imports');
  expect(imported?.body).toMatchObject({
    expectedVersion: 1,
    surface: { schemaVersion: 1 },
  });
  expect(routes.r101.version).toBe(2);
  expect(selection.routeIds).toEqual(['r101']);
  expect(calls.filter((c) => c.path === '/recommendations')).toHaveLength(1);
  await page.reload();
  await expect(page.locator('ride-on-module .ro-ride')).toHaveCount(1);
  await page.waitForLoadState('networkidle');
  expect(calls.filter((c) => c.path === '/route-imports')).toHaveLength(1);
  expect(calls.filter((c) => c.path === '/recommendations')).toHaveLength(1);
});

test('Preferences: Units switch temperature and wind everywhere, locally', async ({
  context,
  worker,
  extensionId,
}) => {
  await signIn(worker);
  const page = await openPopup(context, extensionId);
  await page.getByRole('tab', { name: 'Preferences' }).click();
  const ideal = page
    .locator('.ro-card', { hasText: 'Ideal temperature' })
    .locator('.ro-card-head .ro-value');
  await expect(ideal).toHaveText('10° – 22°C');
  const temperature = page.getByRole('radiogroup', {
    name: 'Temperature unit',
  });
  const wind = page.getByRole('radiogroup', { name: 'Wind speed unit' });
  await expect(temperature.getByRole('radio', { name: '°C' })).toBeChecked();
  await expect(wind.getByRole('radio', { name: 'km/h' })).toBeChecked();
  await page.locator('.ro-units').screenshot({
    path: test.info().outputPath('units.png'),
  });

  await temperature.getByRole('radio', { name: '°F' }).check();
  await expect(ideal).toHaveText('50° – 72°F');
  await expect(
    page.getByRole('slider', { name: 'Ideal temperature from' }),
  ).toHaveAttribute('aria-valuetext', '50°F');
  // The switches are independent.
  await expect(wind.getByRole('radio', { name: 'km/h' })).toBeChecked();
  await wind.getByRole('radio', { name: 'mph' }).check();
  await expect(page.locator('.ro-expander .ro-hint')).toContainText(' mph');
  // Units stay on this device until the API stores them.
  expect(patches()).toEqual([]);

  await fakeCycleTravel(context);
  const journeys = await context.newPage();
  await journeys.goto('https://cycle.travel/user/journeys');
  const chips = journeys.locator('ride-on-module .ro-chips li');
  await expect(chips).toHaveText([
    '48–57°F',
    'Sun and sunny intervals',
    '9 mph tailwind',
    /^Drizzle possible \d\d:\d\d$/,
  ]);
  // The temperature dropdown follows too; its scale stays in Celsius.
  const module = journeys.locator('ride-on-module');
  await module
    .getByRole('button', { name: /^Temperature 48–57°F, feels like 43–52°F\./ })
    .click();
  await expect(module.locator('.ro-temp p')).toContainText('(down to 43°F)');
  await expect(module.locator('.ro-temp .ro-key li').last()).toHaveText(
    'Your range 50–72°F',
  );
  // The wind dropdown follows: the legend, the gusts and the sketch's speed.
  await module
    .getByRole('button', { name: /^Tailwind 9 mph, costs points\. Show wind/ })
    .click();
  await expect(module.locator('.ro-wind li').first()).toHaveText(
    'Tailwind9 mph~60%',
  );
  await expect(module.locator('.ro-gusts b')).toHaveText('Gusts up to 30 mph');
  await expect(module.locator('.ro-gusts span')).toContainText(
    'Over your 22 mph comfort.',
  );
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
  await expect(
    tile.getByRole('meter', { name: 'Conditions score' }),
  ).toHaveAttribute('aria-valuenow', '84');
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

test('Journeys page: paused, tiles show name and distance until turned back on', async ({
  context,
  worker,
}) => {
  routes.r102 = coast();
  selection.routeIds = ['r101', 'r102'];
  // Paused on the profile, from another device.
  user.pause = {
    until: day(7),
    resumesAt: instant(day(7), '00:00', 'Europe/London'),
    pausedAt: new Date().toISOString(),
  };
  await signIn(worker);
  await worker.evaluate(
    "chrome.storage.local.set({ state: { alertRouteId: 'r102' } })",
  );
  await fakeCycleTravel(context);
  const page = await context.newPage();
  await page.goto('https://cycle.travel/user/journeys');

  const module = page.locator('ride-on-module');
  const line = module.locator('.ro-paused');
  await expect(line).toContainText(
    `Ride On is paused until ${shortDate(day(7))}.`,
  );
  const tiles = module.locator('.ro-ride');
  await expect(tiles).toHaveCount(2);
  // Tracked order, plain: no scores, chips, bells or alert border.
  await expect(tiles.first()).toContainText('Hilly Loop');
  await expect(tiles.first()).toContainText('51 km');
  await expect(module.locator('.ro-meter, .ro-chips, .ro-bell')).toHaveCount(0);
  await expect(module.locator('.ro-alert, .ro-flags')).toHaveCount(0);
  await expect(module.locator('.ro-window, .ro-passed')).toHaveCount(0);
  await expect(page.locator('#jr_101 .ro-chip')).toHaveText('Tracked');
  expect(recCalls()).toHaveLength(0);
  // Edit still works.
  await module.getByRole('button', { name: 'Edit' }).click();
  await expect(module.locator('.ro-remove')).toHaveCount(2);
  await module.getByRole('button', { name: 'Done' }).click();
  await page.screenshot({
    path: test.info().outputPath('journeys-paused.png'),
    fullPage: true,
  });

  await line.getByRole('button', { name: 'Turn back on' }).click();
  await expect(line).toHaveCount(0);
  await expect(
    tiles.first().getByRole('meter', { name: 'Conditions score' }),
  ).toBeVisible();
  // The ride with alerts gets its bell and border back.
  await expect(tiles.filter({ hasText: 'Coast & Back' })).toHaveClass(
    /ro-alert/,
  );
  await expect(module.locator('.ro-window')).toBeVisible();
  expect(recCalls()).toHaveLength(1);
  await expect
    .poll(() =>
      worker.evaluate(
        "chrome.storage.local.get('state').then(({ state }) => state.pause)",
      ),
    )
    .toBe(null);
  expect(pauseCalls()).toEqual(['DELETE']);
  expect(user.pause).toBeNull();
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

test('Journeys page: after an extension update, the page follows the new copy', async ({
  context,
  worker,
  extensionId,
}) => {
  await signIn(worker);
  await fakeCycleTravel(context);
  const page = await context.newPage();
  await page.goto('https://cycle.travel/user/journeys');
  const window = page.locator('ride-on-module .ro-window');
  await expect(window).toHaveText(/ · Daylight hours$/);

  // Playwright can't update an unpacked extension, so retire the page's copy the way a new
  // copy would, then restart the background as an update does.
  await worker.evaluate(
    `chrome.tabs.query({ url: 'https://cycle.travel/*' }).then(([tab]) => chrome.scripting.executeScript({ target: { tabId: tab.id }, func: (name) => document.dispatchEvent(new CustomEvent(name, { detail: { contentScriptName: 'journeys', messageId: 'update' } })), args: [chrome.runtime.id + ':journeys:wxt:content-script-started'] }))`,
  );
  await expect(page.locator('ride-on-module')).toHaveCount(0);
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  const cdp = await context.newCDPSession(popup);
  await cdp.send('ServiceWorker.enable');
  await cdp.send('ServiceWorker.stopAllWorkers');
  await popup.reload();
  await expect(page.locator('ride-on-module')).toHaveCount(1);
  await popup.getByRole('tab', { name: 'When' }).click();
  await popup.locator('.ro-day').nth(1).click();
  await expect(window).toHaveText(
    `${datesLabel([day(2), day(3), day(4), day(5)])} · Daylight hours`,
  );
  await expect(page.locator('ride-on-module')).toHaveCount(1);
});

// The background restarts often (idle workers, Safari's non-persistent page): a live copy must
// pass its check, or every restart re-injects it and the module flickers.
test('Journeys page: a background restart leaves a live copy alone', async ({
  context,
  worker,
  extensionId,
}) => {
  await signIn(worker);
  await fakeCycleTravel(context);
  const page = await context.newPage();
  await page.goto('https://cycle.travel/user/journeys');
  const module = page.locator('ride-on-module');
  await expect(module.locator('.ro-window')).toHaveText(/Daylight/);
  await module.evaluate((e) => e.setAttribute('data-original', ''));
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  const cdp = await context.newCDPSession(popup);
  await cdp.send('ServiceWorker.enable');
  await cdp.send('ServiceWorker.stopAllWorkers');
  await popup.reload();
  await popup.getByRole('tab', { name: 'When' }).click();
  await page.waitForTimeout(1000); // revive runs as the worker starts, with nothing to await
  await expect(page.locator('ride-on-module[data-original]')).toHaveCount(1);
  await expect(module).toHaveCount(1);
});

// A real reload (unlike the CustomEvent above) takes the old copy's extension APIs with it.
test('a real extension reload leaves one copy on Journeys, without errors', async ({
  context,
  worker,
  extensionId,
}) => {
  await signIn(worker);
  await fakeCycleTravel(context);
  const page = await context.newPage();
  await page.goto('https://cycle.travel/user/journeys?page=1');
  await expect(page.locator('ride-on-module .ro-window')).toHaveText(
    /Daylight/,
  );
  const retired = page.waitForEvent('console', (m) =>
    m.text().includes('context invalidated'),
  );
  const ext = await context.newPage();
  await ext.goto('chrome://extensions');
  const dev = 'chrome.developerPrivate';
  await ext.evaluate(
    `${dev}.updateProfileConfiguration({ inDeveloperMode: true })
      .then(() => ${dev}.updateExtensionConfiguration({ extensionId: '${extensionId}', errorCollection: true }))
      .then(() => ${dev}.reload('${extensionId}', { failQuietly: true }))`,
  );
  await retired;
  await expect(page.locator('ride-on-module')).toHaveCount(1);
  await expect(page.locator('ride-on-module .ro-window')).toHaveText(
    /Daylight/,
  );
  expect(
    await ext.evaluate(
      `${dev}.getExtensionInfo('${extensionId}').then((i) => i.runtimeErrors.map((e) => e.message))`,
    ),
  ).toEqual([]);
});
