import { expect, test } from 'bun:test';
import { initialState, type LocalPrefs, type State } from '../lib/state';
import type {
  Departure,
  Failure,
  NextWindow,
  Preferences,
  Recommendations,
  Ride,
  RouteResult,
  User,
} from '../lib/types';
import {
  applyPatch,
  availability,
  buildResults,
  checkinDay,
  convert,
  coverageText,
  datesLabel,
  dayMonth,
  draftFrom,
  draftPatch,
  ended,
  monthLabel,
  pickDay,
  presetDates,
  rankText,
  resolveDays,
  ridden,
  rideLines,
  rideSummary,
  searchPatch,
  shownOf,
  validateRange,
  viewOf,
  windowBest,
  windowName,
  windowWhen,
} from '../ui/format';

const TZ = 'Europe/London'; // BST in mid-October
const NOW = new Date('2026-10-14T09:00:00Z'); // Wednesday 10:00
const strict = { mode: 'strict', providerId: 'met-office' } as const;
const strip = availability(NOW, TZ, strict); // Wed 14 … Tue 20

test('availability follows the provider horizon', () => {
  expect(strip.map((d) => d.kind)).toEqual([
    'full',
    'full',
    'partial',
    'none',
    'none',
    'none',
    'none',
  ]);
  expect(strip[2]).toEqual({
    date: '2026-10-16',
    kind: 'partial',
    until: '10:00',
  });
  const bpf = availability(NOW, TZ, {
    mode: 'ordered-fallback',
    providerIds: ['met-office', 'met-office-bpf'],
  });
  expect(bpf.map((d) => d.kind).join()).toBe(
    'full,full,full,full,full,partial,none',
  );
  const apple = availability(NOW, TZ, {
    mode: 'strict',
    providerId: 'apple-weather',
  });
  expect(apple.every((d) => d.kind === 'full')).toBe(true);
  // "Next few days" stops at five even with ten days of forecast.
  expect(presetDates('next', apple)).toEqual(['2026-10-14', '2026-10-18']);
});

test('presets, picked days and expiry', () => {
  expect(presetDates('today', strip)).toEqual(['2026-10-14', '2026-10-14']);
  expect(presetDates('tomorrow', strip)).toEqual(['2026-10-15', '2026-10-15']);
  expect(presetDates('weekend', strip)).toEqual(['2026-10-17', '2026-10-18']);
  expect(presetDates('next', strip)).toEqual(['2026-10-14', '2026-10-16']);
  const range = (start: string, end: string) =>
    ({ kind: 'range', start, end }) as const;
  expect(resolveDays(range('2026-10-01', '2026-10-02'), strip)).toBeNull();
  expect(resolveDays(range('2026-10-13', '2026-10-25'), strip)).toEqual([
    '2026-10-14',
    '2026-10-20',
  ]);
  expect(pickDay(['2026-10-15', '2026-10-15'], '2026-10-14')).toEqual(
    range('2026-10-14', '2026-10-15'),
  );
  expect(pickDay(['2026-10-14', '2026-10-16'], '2026-10-15')).toEqual(
    range('2026-10-15', '2026-10-15'),
  );
  expect(datesLabel('2026-10-17', '2026-10-18')).toBe('Sat 17 – Sun 18 Oct');
  expect(datesLabel('2026-10-31', '2026-11-01')).toBe('Sat 31 Oct – Sun 1 Nov');
});

test('coverage note', () => {
  expect(coverageText(strip.slice(0, 2))).toBeNull();
  expect(coverageText(strip.slice(0, 4))).toBe(
    "Wednesday and Thursday available; Friday's forecast only covers the morning; Saturday's forecast isn't available yet.",
  );
});

test('distance range validation and units', () => {
  expect(validateRange('10', '20', 'km')).toEqual({
    fromError: null,
    toError: null,
    km: [10, 20],
  });
  expect(validateRange('', '5', 'km').fromError).toBe('Enter a distance.');
  expect(validateRange('-1', '5', 'km').fromError).toBe("Can't be below 0.");
  expect(validateRange('1a', '5', 'km').fromError).toBe(
    'Use numbers only, for example 15 or 22.5.',
  );
  expect(validateRange('0', '0', 'km').toError).toBe('Must be more than 0.');
  expect(validateRange('10', '500', 'km').toError).toBe('Can be up to 400 km.');
  expect(validateRange('30', '20', 'km').fromError).toBe(
    "Can't be more than To.",
  );
  expect(validateRange('10', '20', 'mi').km?.map(Math.round)).toEqual([16, 32]);
  expect(convert('20', 'km', 'mi')).toBe('12.4');
  expect(convert('12.4', 'mi', 'km')).toBe('20');
  expect(convert('abc', 'km', 'mi')).toBe('abc');
  const search = {
    climbing: 'flatter',
    mode: 'range',
    from: '10',
    to: '20',
  } as const;
  expect(rideSummary(search, 'km')).toBe(
    '10–20 km · Flatter: a shorter, gentler ride',
  );
  expect(searchPatch({ ...search, mode: 'none' }, 'km').distance).toBeNull();
  expect('distance' in searchPatch({ ...search, to: 'x' }, 'km')).toBe(false);
});

const conditions = {
  temperatureC: { minimum: 12, maximum: 15 },
  averageWindSpeedKph: 10,
  averageHeadwindKph: 2,
  averageTailwindKph: 8,
  averageCrosswindKph: 3,
  maximumPrecipitationProbability: 0.05,
};
const departure = (
  at: string,
  score: number,
  status: Departure['standards']['status'] = 'meets',
  failures: Departure['standards']['failures'] = [],
): Departure => ({
  departureAt: at,
  finishAt: new Date(Date.parse(at) + 2 * 3_600_000).toISOString(),
  score,
  standards: { status, failures },
  conditions,
});
const result = (
  routeId: string,
  best: Departure | null,
  extra: Partial<RouteResult> = {},
): RouteResult => ({
  routeId,
  routeName: `Route ${routeId}`,
  distanceKm: 30,
  distanceFit: null,
  estimatedDurationMinutes: 120,
  daylight: { start: '2026-10-14T06:20:00Z', end: '2026-10-14T17:10:00Z' },
  effectiveWindow: null,
  status: best ? 'assessed' : 'unassessable',
  departuresUnknown: 0,
  departuresStandardsUnknown: 0,
  best,
  issues: [],
  warnings: [],
  ...extra,
});
const recs = (
  date: string,
  status: Recommendations['minimumStandardsStatus'],
  rankings: RouteResult[],
  unranked: RouteResult[] = [],
): Recommendations => ({
  date,
  recommendedRouteId: rankings[0]?.routeId ?? null,
  minimumStandardsStatus: status,
  rankings,
  unranked,
  weather: { locations: [] },
});
const gust: Failure = {
  standard: 'maximumGustKph',
  limit: 45,
  actual: 52.4,
  sections: [],
};

test('cards: meeting rides lead, then below, unassessable and pending', () => {
  const day = recs(
    '2026-10-14',
    'match_found',
    [
      result('a', departure('2026-10-14T08:00:00Z', 80)),
      result('b', departure('2026-10-14T09:00:00Z', 90, 'below', [gust])),
    ],
    [result('c', null, { issues: ['missing-elevation'] })],
  );
  const out = buildResults(
    ['b', 'a', 'c', 'd'],
    {},
    [strip[0]],
    { '2026-10-14': day },
    TZ,
    true,
  );
  expect(out.status).toBe('match_found');
  expect(out.banners).toEqual([]);
  expect(out.daylight?.start).toBe('2026-10-14T06:20:00Z');
  const [a, b, c, d] = out.cards;
  expect(a).toMatchObject({
    routeId: 'a',
    state: 'meets',
    flag: 'Best pick',
    chip: 'Wed 14 · 09:00',
    when: 'Wed 14 Oct · depart 09:00 · finish ~11:00',
    weather: 'At ride time: 12–15° · tailwind 8 km/h · dry',
    score: 80,
  });
  expect(b).toMatchObject({
    state: 'below',
    flag: null,
    chip: 'Below minimums',
    drawbacks: ['Gusts reach 52 km/h (your limit 45 km/h)'],
  });
  expect(c).toMatchObject({
    state: 'incomplete',
    score: null,
    trade: ["No elevation data, so climbing isn't scored"],
    reason:
      "Can't be assessed without elevation data while you have a climbing preference.",
  });
  expect(d).toMatchObject({ state: 'pending', chip: 'Checking…' });
});

test('cards merge the selected days and keep each ride’s best departure', () => {
  const out = buildResults(
    ['a'],
    {},
    strip.slice(0, 2),
    {
      '2026-10-14': recs('2026-10-14', 'match_found', [
        result('a', departure('2026-10-14T08:00:00Z', 60)),
      ]),
      '2026-10-15': recs('2026-10-15', 'match_found', [
        result('a', departure('2026-10-15T08:00:00Z', 75)),
      ]),
    },
    TZ,
    true,
  );
  expect(out.cards[0].chip).toBe('Thu 15 · 09:00');
  expect(out.coverageWarn).toBe(false);
});

test('banners, flags and rides that cannot be scored', () => {
  const below = recs('2026-10-14', 'none_meet', [
    result('a', departure('2026-10-14T08:00:00Z', 70, 'below', [gust]), {
      distanceFit: { status: 'above_range', deviationKm: 5 },
    }),
  ]);
  const none = buildResults(
    ['a'],
    {},
    [strip[0]],
    { '2026-10-14': below },
    TZ,
    true,
  );
  expect(none.banners).toEqual(['nomatch', 'distance']);
  expect(none.cards[0]).toMatchObject({
    flag: 'Best available',
    trade: ['Longer than your preferred range'],
  });

  // A selected day without a response can't confirm a match.
  const partial = buildResults(
    ['a'],
    {},
    strip.slice(0, 3),
    { '2026-10-14': below },
    TZ,
    true,
  );
  expect(partial.status).toBe('unknown');
  expect(partial.banners[0]).toBe('incomplete');
  expect(partial.coverageWarn).toBe(true);

  const unset = buildResults(
    ['a'],
    {},
    [strip[0]],
    { '2026-10-14': below },
    TZ,
    false,
  );
  expect(unset.status).toBe('not_configured');
  expect(unset.cards[0].flag).toBe('Best pick');

  const nofit = buildResults(
    ['a'],
    {},
    [strip[0]],
    {
      '2026-10-14': recs(
        '2026-10-14',
        'no_feasible_departure',
        [],
        [
          result('a', null, {
            status: 'no_feasible_departure',
            estimatedDurationMinutes: 150,
            effectiveWindow: {
              start: '2026-10-14T07:00:00Z',
              end: '2026-10-14T09:00:00Z',
            },
          }),
        ],
      ),
    },
    TZ,
    true,
  );
  expect(nofit.cards[0]).toMatchObject({
    state: 'nofit',
    duration: 'Estimated ride time 2h 30m',
    reason: 'Your window, 08:00–10:00, allows 2h 00m.',
  });

  const later = buildResults(['a'], {}, [strip[3]], {}, TZ, true);
  expect(later.cards[0]).toMatchObject({
    state: 'incomplete',
    reason: "Can't be assessed. Saturday's forecast isn't available yet.",
  });
});

const prefs: Preferences = {
  temperature: { comfortMinC: 12, comfortMaxC: 22 },
  wind: { comfortableHeadwindKph: 15, comfortableCrosswindKph: 20 },
  climbing: { preference: 'neutral' },
  distance: { minKm: 20, maxKm: 40 },
  minimumStandards: { maximumGustKph: 40, maximumPrecipitationRateMmH: 2 },
};
const local: LocalPrefs = {
  sunshine: 'Nice to have',
  rain: 'Prefer dry',
  floorMode: 'fixed',
  floorFixedC: 3,
  floorMonthsC: [0, 0, 2, 4, 6, 8, 10, 10, 7, 5, 2, 0],
  rainPct: 50,
  gustKph: 45,
};

test('preferences draft round-trips through a PATCH', () => {
  const draft = draftFrom(prefs, local);
  expect(draft).toMatchObject({
    gustOn: true,
    gustKph: 40,
    rainOn: false,
    rainPct: 50,
  });
  const patch = draftPatch({
    ...draft,
    floorOn: true,
    floorFixedC: 2,
    gustOn: false,
  });
  // Only fields the API accepts; the rain rate isn't on the tab so it's never sent.
  expect(Object.keys(patch)).toEqual([
    'temperature',
    'wind',
    'minimumStandards',
  ]);
  expect(patch.minimumStandards).toEqual({
    minimumTemperature: { kind: 'fixed', valueC: 2 },
    maximumPrecipitationProbability: null,
    maximumGustKph: null,
  });
  expect(applyPatch(prefs, patch).minimumStandards).toEqual({
    minimumTemperature: { kind: 'fixed', valueC: 2 },
    maximumPrecipitationRateMmH: 2,
  });
  const monthly = draftPatch({ ...draft, floorOn: true, floorMode: 'monthly' });
  const floor = monthly.minimumStandards?.minimumTemperature;
  expect(floor?.kind === 'monthly' && floor.valuesC['7']).toBe(10);
  expect(applyPatch(prefs, { distance: null }).distance).toBeNull();
});

test('recentRides patches keep the lookback', () => {
  const recent = {
    ...prefs,
    recentRides: { mode: 'neutral', lookbackDays: 28 },
  } as const;
  expect(
    applyPatch(recent, { recentRides: { mode: 'prefer-variety' } }).recentRides,
  ).toEqual({ mode: 'prefer-variety', lookbackDays: 28 });
});

// Wed 14 Oct, 08:00–14:00: Route a at 09:00 BST, then b at 10:00.
const shownState: State = {
  ...initialState,
  user: {
    settings: { timeZone: TZ, weather: strict, preferences: prefs },
  } as User,
  selection: { version: 1, routeIds: ['b', 'a'], updatedAt: null },
  planning: {
    days: { kind: 'range', start: '2026-10-14', end: '2026-10-14' },
    time: { mode: 'custom', start: '08:00', end: '14:00' },
  },
  days: {
    '2026-10-14': recs('2026-10-14', 'match_found', [
      result('a', departure('2026-10-14T08:00:00Z', 80)),
      result('b', departure('2026-10-14T09:00:00Z', 70)),
    ]),
  },
};

test('the shown window, its end and its picks', () => {
  const shown = shownOf(shownState, NOW);
  expect(shown).toMatchObject({
    dates: ['2026-10-14', '2026-10-14'],
    endsAt: '14:00',
  });
  expect(shown?.picks.map((p) => [p.routeId, p.rank])).toEqual([
    ['a', 1],
    ['b', 2],
  ]);
  if (!shown) throw new Error('no window');
  expect(ended(shown, NOW, TZ)).toBe(false);
  expect(ended(shown, new Date('2026-10-14T12:59:00Z'), TZ)).toBe(false);
  expect(ended(shown, new Date('2026-10-14T13:00:00Z'), TZ)).toBe(true);
  expect(ended(shown, new Date('2026-10-15T00:00:00Z'), TZ)).toBe(true);
  // Daylight ends at sunset (18:10 BST); a custom window ends at the earlier of the two.
  const daylight = shownOf(
    {
      ...shownState,
      planning: {
        ...shownState.planning,
        time: { ...shownState.planning.time, mode: 'daylight' },
      },
    },
    NOW,
  );
  expect(daylight?.endsAt).toBe('18:10');
  // Once ended, the view reads as passed and shows the window that ended.
  const view = viewOf({ ...shownState, expired: shown }, NOW);
  expect(view.range).toBeNull();
  expect(view.cards).toEqual([]);
  expect(view.timeText).toContain('08:00');
});

const ride = (id: string, routeId: string, riddenOn: string): Ride => ({
  id,
  version: 1,
  routeId,
  route: {
    id: routeId,
    name: `Route ${routeId}`,
    version: 1,
    distanceM: 35_200,
    ascentM: null,
  },
  riddenOn,
  timeZone: TZ,
  recordedAt: `${riddenOn}T18:00:00Z`,
  updatedAt: `${riddenOn}T18:00:00Z`,
  plan: null,
});

test('ride tags and the ranked-lower date', () => {
  const today = '2026-10-14';
  const rides = [
    ride('1', 'a', today),
    ride('2', 'b', '2026-10-05'),
    ride('3', 'a', '2026-09-22'),
    ride('4', 'c', '2026-08-01'),
  ];
  const variety = { mode: 'prefer-variety', lookbackDays: 28 } as const;
  expect(ridden(rides, 'a', today, variety)).toEqual({
    latest: today,
    today: true,
    last: '2026-09-22',
    until: '2026-11-11',
  });
  expect(ridden(rides, 'a', today, { ...variety, mode: 'neutral' }).until).toBe(
    null,
  );
  expect(ridden(rides, 'b', today, variety)).toMatchObject({
    today: false,
    last: '2026-10-05',
    until: '2026-11-02',
  });
  expect(ridden(rides, 'c', today, variety).until).toBeNull(); // over four weeks ago
  expect(ridden(rides, 'd', today, variety)).toEqual({
    latest: null,
    today: false,
    last: null,
    until: null,
  });
  expect(dayMonth('2026-09-22', today)).toBe('22 Sep');
  expect(dayMonth('2025-12-30', today)).toBe('30 Dec 2025');
  expect(monthLabel('2026-10-11', today)).toBe('October');
  expect(monthLabel('2025-12-30', today)).toBe('December 2025');
  expect([1, 2, 3, 4, 11, 22, null].map(rankText)).toEqual([
    'your top pick',
    'your 2nd pick',
    'your 3rd pick',
    'your 4th pick',
    'your 11th pick',
    'your 22nd pick',
    'not a pick',
  ]);
});

test('check-in, next windows and history lines', () => {
  const today = '2026-10-14';
  const pick = {
    routeId: 'a',
    departureAt: '2026-10-14T07:00:00Z',
    finishAt: '2026-10-14T08:46:00Z',
    conditions,
    rank: 1,
  };
  expect(checkinDay(pick, today, TZ)).toBe('This morning, Wed 14 Oct');
  expect(checkinDay(pick, '2026-10-15', TZ)).toBe('Yesterday, Wed 14 Oct');
  expect(checkinDay(pick, '2026-10-17', TZ)).toBe('Wed 14 Oct');

  const best = {
    routeId: 'a',
    departureAt: '2026-10-15T08:00:00Z',
    finishAt: '2026-10-15T10:00:00Z',
    score: 84,
    conditions,
  };
  const tomorrow: NextWindow = {
    kind: 'tomorrow',
    date: '2026-10-15',
    window: { start: '08:00', end: '14:00' },
    effectiveWindow: null,
    best,
  };
  expect(windowName(tomorrow)).toBe('Tomorrow morning');
  expect(windowWhen(tomorrow, today, today, TZ)).toBe(
    'Thu 15 Oct · 08:00–14:00',
  );
  expect(windowBest(tomorrow, 'Richmond', TZ)).toBe(
    'Richmond, leave 09:00 · 15° dry',
  );
  const weekday: NextWindow = {
    ...tomorrow,
    kind: 'same_weekday',
    date: '2026-10-21',
    window: { start: '15:00', end: '18:00' },
  };
  expect(windowName(weekday)).toBe('Next Wednesday afternoon');
  expect(windowWhen(weekday, today, today, TZ)).toBe(
    'Wed 21 Oct · 15:00–18:00 · same as today',
  );
  const week: NextWindow = {
    ...tomorrow,
    kind: 'best_this_week',
    date: '2026-10-17',
    window: 'daylight',
    best: { ...best, departureAt: '2026-10-17T08:00:00Z' },
  };
  expect(windowName(week)).toBe('Best time this week');
  expect(windowWhen(week, today, today, TZ)).toBe(
    `Any daylight, ${datesLabel('2026-10-15', '2026-10-20')}`,
  );
  expect(windowBest(week, 'Richmond', TZ)).toBe(
    'Richmond, Sat 17 Oct 09:00 · 15° dry',
  );

  const logged = ride('1', 'a', today);
  expect(rideLines(logged, TZ)).toEqual(['Wed 14 Oct · 35 km']);
  expect(
    rideLines(
      {
        ...logged,
        plan: {
          ...pick,
          conditions: { ...conditions, maximumPrecipitationProbability: 0.4 },
          pickRank: 2,
        },
      },
      TZ,
    ),
  ).toEqual([
    'Wed 14 Oct · 08:00 · 35 km · 1h 46m',
    '15° · 40% rain · your 2nd pick',
  ]);
});
