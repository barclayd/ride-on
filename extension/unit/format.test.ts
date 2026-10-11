import { expect, test } from 'bun:test';
import {
  type Checkin,
  initialState,
  type LocalPrefs,
  type Pick,
  type State,
} from '../lib/state';
import type {
  Conditions,
  DaySummary,
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
  buildResults,
  checkinDay,
  conditionChips,
  convert,
  coverageText,
  datesLabel,
  dayMonth,
  draftFrom,
  draftPatch,
  ended,
  logged,
  monthLabel,
  pickDay,
  planFor,
  planningDates,
  rankText,
  ridden,
  rideLine,
  rideSummary,
  searchPatch,
  shownOf,
  tile,
  validateRange,
  viewOf,
  windowBest,
  windowName,
  windowWhen,
} from '../ui/format';

const TZ = 'Europe/London'; // BST in mid-October
const NOW = new Date('2026-10-14T09:00:00Z'); // Wednesday 10:00
const strict = { mode: 'strict', providerId: 'met-office-bpf' } as const;

const summary = (
  date: string,
  extra: Partial<DaySummary> = {},
): DaySummary => ({
  date,
  availability: 'full',
  availabilityReason: 'available',
  until: null,
  daylight: { sunrise: `${date}T06:20:00Z`, sunset: `${date}T17:10:00Z` },
  temperatureMaxC: 14.6,
  quality: 72,
  selected: false,
  ...extra,
});
const notYet = {
  availability: 'none',
  availabilityReason: 'outside_forecast_horizon',
  daylight: null,
  temperatureMaxC: null,
  quality: null,
} as const;
// Wed 14 … Tue 20: two full days, Friday to 10:00 BST, then nothing yet.
const days = [
  summary('2026-10-14'),
  summary('2026-10-15'),
  summary('2026-10-16', {
    availability: 'partial',
    availabilityReason: 'partial',
    until: '2026-10-16T09:00:00Z',
  }),
  ...['17', '18', '19', '20'].map((d) => summary(`2026-10-${d}`, notYet)),
];

test('planned dates resolve like the API', () => {
  const today = '2026-10-14';
  expect(planningDates({ kind: 'preset', preset: 'today' }, today)).toEqual([
    today,
    today,
  ]);
  expect(planningDates({ kind: 'preset', preset: 'tomorrow' }, today)).toEqual([
    '2026-10-15',
    '2026-10-15',
  ]);
  // Next 5 days starts tomorrow; the background sends it to the API as this range.
  expect(planningDates({ kind: 'preset', preset: 'next' }, today)).toEqual([
    '2026-10-15',
    '2026-10-19',
  ]);
  expect(planningDates({ kind: 'preset', preset: 'weekend' }, today)).toEqual([
    '2026-10-17',
    '2026-10-18',
  ]);
  // On Sunday the weekend is what's left of it.
  expect(
    planningDates({ kind: 'preset', preset: 'weekend' }, '2026-10-18'),
  ).toEqual(['2026-10-18', '2026-10-18']);
  const range = (start: string, end: string) =>
    ({ kind: 'range', start, end }) as const;
  expect(planningDates(range('2026-10-01', '2026-10-13'), today)).toBeNull();
  expect(planningDates(range('2026-10-12', '2026-10-15'), today)).toEqual([
    today,
    '2026-10-15',
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

test('day tiles and the coverage note come from the API', () => {
  expect(days.map((d) => tile(d, TZ).label)).toEqual([
    '15°',
    '15°',
    'To 10:00',
    'Not yet',
    'Not yet',
    'Not yet',
    'Not yet',
  ]);
  expect(tile(days[2], TZ)).toMatchObject({
    kind: 'partial',
    title: 'Forecast up to 10:00',
    quality: 72,
  });
  expect(tile(undefined, TZ)).toMatchObject({ label: '–', quality: null });
  const none = (availabilityReason: string) =>
    tile(summary('2026-10-14', { ...notYet, availabilityReason }), TZ).label;
  expect(
    [
      'provider_unavailable',
      'missing_data',
      'no_feasible_departure',
      'no_remaining_window',
    ].map(none),
  ).toEqual(['No data', 'No data', 'No fit', 'Passed']);
  expect(tile({ ...days[2], until: null }, TZ)).toMatchObject({
    label: 'Partial',
    title: 'Partial forecast',
  });

  expect(coverageText(days.slice(0, 2), TZ)).toBeNull();
  expect(coverageText(days.slice(0, 4), TZ)).toBe(
    "Wednesday and Thursday available; Friday's forecast only covers the morning; Saturday's forecast isn't available yet.",
  );
  expect(coverageText([{ ...days[2], until: null }], TZ)).toBe(
    "Friday's forecast only covers part of the day.",
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
  date: at.slice(0, 10),
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
  daylight: null,
  effectiveWindow: null,
  status: best ? 'assessed' : 'unassessable',
  departuresUnknown: 0,
  departuresStandardsUnknown: 0,
  best,
  issues: [],
  warnings: [],
  verdict: best
    ? { status: 'meets', code: 'meets' }
    : { status: 'incomplete', code: 'forecast_unavailable' },
  ...extra,
});
const attribution = [
  { text: 'Powered by Met Office data', url: 'https://www.metoffice.gov.uk/' },
];
const recs = (
  status: Recommendations['minimumStandardsStatus'],
  rankings: RouteResult[],
  unranked: RouteResult[] = [],
  extra: Partial<Recommendations> = {},
): Recommendations => ({
  generatedAt: '2026-10-14T08:55:00Z',
  algorithmVersion: '2026-10-10',
  timeZone: TZ,
  minimumStandardsStatus: status,
  recommendation: rankings[0]
    ? {
        routeId: rankings[0].routeId,
        kind: status === 'none_meet' ? 'best_available' : 'best_pick',
      }
    : null,
  rankings,
  unranked,
  range: { start: '2026-10-14', end: '2026-10-14' },
  expired: false,
  days,
  weather: { retrieval: { latestAt: '2026-10-14T08:50:00Z' }, attribution },
  ...extra,
});
const gust: Failure = {
  standard: 'maximumGustKph',
  limit: 45,
  actual: 52.4,
  sections: [],
};
const below = { status: 'below_minimums', code: 'below_minimums' } as const;

test('cards follow the API: ranked, then unranked, then pending', () => {
  const out = buildResults(
    ['b', 'a', 'c', 'd'],
    {},
    recs(
      'match_found',
      [
        result('a', departure('2026-10-14T08:00:00Z', 80.4)),
        result('b', departure('2026-10-14T09:00:00Z', 90, 'below', [gust]), {
          verdict: below,
        }),
      ],
      [
        result('c', null, {
          verdict: { status: 'incomplete', code: 'missing_elevation' },
        }),
      ],
    ),
    [days[0]],
    TZ,
  );
  expect(out.status).toBe('match_found');
  expect(out.banners).toEqual([]);
  expect(out.daylight).toEqual({
    start: '2026-10-14T06:20:00Z',
    end: '2026-10-14T17:10:00Z',
  });
  expect(out.coverageWarn).toBe(false);
  const [a, b, c, d] = out.cards;
  expect(a).toMatchObject({
    routeId: 'a',
    state: 'meets',
    flag: 'Best pick',
    chip: 'Wed 14 · 09:00',
    when: 'Wed 14 Oct · depart 09:00 · finish ~11:00',
    weather: 'At ride time: 12–15° · tailwind 8 km/h · dry',
    score: 80,
    recent: false,
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

test('banners, flags, recent roads and rides that cannot be scored', () => {
  const recent = (penaltyPoints: number) => ({
    ...departure('2026-10-14T08:00:00Z', 70, 'below', [gust]),
    recentRides: { status: 'assessed', penaltyPoints } as const,
  });
  const none = buildResults(
    ['a', 'b'],
    {},
    recs('none_meet', [
      result('a', recent(4), {
        verdict: below,
        distanceFit: { status: 'above_range', deviationKm: 5 },
      }),
      result('b', recent(0), {
        verdict: below,
        distanceFit: { status: 'below_range', deviationKm: 2 },
      }),
    ]),
    [days[0]],
    TZ,
  );
  expect(none.banners).toEqual(['nomatch', 'distance']);
  expect(none.cards[0]).toMatchObject({
    flag: 'Best available',
    recent: true,
    trade: ['Longer than your preferred range'],
  });
  expect(none.cards[1]).toMatchObject({ flag: null, recent: false });

  const unknown = buildResults(
    ['a'],
    {},
    recs('unknown', [result('a', recent(0))]),
    days.slice(0, 3),
    TZ,
  );
  expect(unknown.banners).toEqual(['incomplete']);
  expect(unknown.coverageWarn).toBe(true);
  // A failed provider is named instead of the vaguer 'incomplete'.
  const down = buildResults(
    ['a'],
    {},
    recs('unknown', []),
    [
      summary('2026-10-14', {
        ...notYet,
        availabilityReason: 'provider_unavailable',
      }),
    ],
    TZ,
  );
  expect(down.banners).toEqual(['provider']);

  const nofit = buildResults(
    ['a'],
    {},
    recs(
      'no_feasible_departure',
      [],
      [
        result('a', null, {
          status: 'no_feasible_departure',
          verdict: { status: 'doesnt_fit', code: 'no_feasible_departure' },
          estimatedDurationMinutes: 150,
          effectiveWindow: {
            start: '2026-10-14T07:00:00Z',
            end: '2026-10-14T09:00:00Z',
          },
        }),
      ],
    ),
    [days[0]],
    TZ,
  );
  expect(nofit.cards[0]).toMatchObject({
    state: 'nofit',
    duration: 'Estimated ride time 2h 30m',
    reason: 'Your window, 08:00–10:00, allows 2h 00m.',
  });

  // No answer yet: only days beyond the forecast read as incomplete.
  expect(buildResults(['a'], {}, null, [days[3]], TZ).cards[0]).toMatchObject({
    state: 'incomplete',
    reason: "Can't be assessed. Saturday's forecast isn't available yet.",
  });
  expect(buildResults(['a'], {}, null, [days[0]], TZ).cards[0].state).toBe(
    'pending',
  );
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
    weatherProviderId: 'met-office',
    settings: { timeZone: TZ, weather: strict, preferences: prefs },
  } as User,
  selection: { version: 1, routeIds: ['b', 'a'], updatedAt: null },
  planning: {
    days: { kind: 'range', start: '2026-10-14', end: '2026-10-14' },
    time: { mode: 'custom', start: '08:00', end: '14:00' },
  },
  recs: recs('match_found', [
    result('a', departure('2026-10-14T08:00:00Z', 80)),
    result('b', departure('2026-10-14T09:00:00Z', 70)),
  ]),
};

test('the view: strip, selected days and weather', () => {
  const view = viewOf(shownState, NOW);
  expect(view.strip.map((d) => d.label)).toEqual([
    '15°',
    '15°',
    'To 10:00',
    'Not yet',
    'Not yet',
    'Not yet',
    'Not yet',
  ]);
  expect(view.range).toEqual(['2026-10-14', '2026-10-14']);
  expect(view.selected.map((d) => d.date)).toEqual(['2026-10-14']);
  expect(view.datesText).toBe('Wed 14 Oct');
  expect(view.retrieved).toBe('09:50');
  expect(view.attributions).toEqual(attribution);
  expect(view.cards.map((c) => c.routeId)).toEqual(['a', 'b']);
  expect(view.provider).toBe('Your forecast provider');
  expect(
    viewOf(
      {
        ...shownState,
        providers: [{ id: 'met-office', name: 'Met Office' }],
      } as State,
      NOW,
    ).provider,
  ).toBe('Met Office');
});

test('the shown window, its end and its picks', () => {
  const shown = shownOf(shownState, NOW);
  if (!shown) throw new Error('no window');
  expect(shown.dates).toEqual(['2026-10-14', '2026-10-14']);
  // The earlier of 14:00 BST and sunset.
  expect(shown.endsAt).toBe('2026-10-14T13:00:00.000Z');
  expect(shown.picks.map((p) => [p.routeId, p.date, p.rank])).toEqual([
    ['a', '2026-10-14', 1],
    ['b', '2026-10-14', 2],
  ]);
  expect(shown.meta).toEqual({
    generatedAt: '2026-10-14T08:55:00Z',
    algorithmVersion: '2026-10-10',
    attribution,
  });
  expect(ended(shown, new Date('2026-10-14T12:59:00Z'))).toBe(false);
  expect(ended(shown, new Date('2026-10-14T13:00:00Z'))).toBe(true);
  const daylight = {
    ...shownState.planning,
    time: { ...shownState.planning.time, mode: 'daylight' },
  } as const;
  expect(shownOf({ ...shownState, planning: daylight }, NOW)?.endsAt).toBe(
    '2026-10-14T17:10:00.000Z',
  );
  // No sunset: the end of the local day.
  const dark = recs('match_found', [], [], {
    days: [{ ...days[0], daylight: null }],
  });
  expect(
    shownOf({ ...shownState, planning: daylight, recs: dark }, NOW)?.endsAt,
  ).toBe('2026-10-14T23:00:00.000Z');
  expect(
    shownOf(
      { ...shownState, recs: recs('match_found', [], [], { range: null }) },
      NOW,
    ),
  ).toBeNull();
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
const pick = (routeId: string, rank: number): Pick => ({
  routeId,
  date: '2026-10-14',
  departureAt: '2026-10-14T07:00:00Z',
  finishAt: '2026-10-14T08:46:00Z',
  conditions,
  rank,
});

test('check-in: settled by a pick, and the plan it sends', () => {
  const picks = [pick('a', 1), pick('b', 2)];
  expect(logged('2026-10-14', picks, [ride('1', 'c', '2026-10-14')])).toBe(
    false,
  );
  expect(logged('2026-10-14', picks, [ride('1', 'b', '2026-10-13')])).toBe(
    false,
  );
  expect(logged('2026-10-14', picks, [ride('1', 'b', '2026-10-14')])).toBe(
    true,
  );

  const checkin: Checkin = {
    date: '2026-10-14',
    picks,
    meta: {
      generatedAt: '2026-10-14T06:00:00Z',
      algorithmVersion: '2026-10-10',
      attribution,
    },
    status: 'ask',
    routeId: null,
    rideId: null,
    key: null,
  };
  expect(planFor(checkin, 'b')).toEqual({
    schemaVersion: 1,
    departureAt: '2026-10-14T07:00:00Z',
    finishAt: '2026-10-14T08:46:00Z',
    conditions,
    pickRank: 2,
    generatedAt: '2026-10-14T06:00:00Z',
    algorithmVersion: '2026-10-10',
    weather: { attribution },
  });
  expect(planFor(checkin, 'z')).toBeNull(); // not a pick
  expect(
    planFor({ ...checkin, meta: { ...checkin.meta, attribution: [] } }, 'a'),
  ).toBeNull();
  // Planned after it left: the API would refuse it.
  expect(
    planFor(
      {
        ...checkin,
        meta: { ...checkin.meta, generatedAt: '2026-10-14T07:30:00Z' },
      },
      'a',
    ),
  ).toBeNull();

  expect(checkinDay(picks[0], '2026-10-14', TZ)).toBe(
    'This morning, Wed 14 Oct',
  );
  expect(checkinDay(picks[0], '2026-10-15', TZ)).toBe('Yesterday, Wed 14 Oct');
  expect(checkinDay(picks[0], '2026-10-17', TZ)).toBe('Wed 14 Oct');
});

test('ride tags, dates and history lines', () => {
  const today = '2026-10-14';
  const rides = [ride('1', 'a', '2026-09-22'), ride('2', 'c', '2026-08-01')];
  const sum = (routeId: string, lastRiddenOn: string | null) => ({
    routeId,
    rideCount: 2,
    lastRiddenOn,
  });
  expect(ridden(sum('a', today), rides, 'a', today)).toEqual({
    today: true,
    last: '2026-09-22',
  });
  expect(ridden(sum('b', '2026-10-05'), rides, 'b', today)).toEqual({
    today: false,
    last: '2026-10-05',
  });
  expect(ridden(undefined, rides, 'c', today)).toEqual({
    today: false,
    last: '2026-08-01',
  });
  expect(ridden(undefined, rides, 'd', today)).toEqual({
    today: false,
    last: null,
  });
  expect(rideLine(ride('1', 'a', today))).toBe('Wed 14 Oct · 35 km');
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

test('next windows', () => {
  const today = '2026-10-14';
  const tomorrow: NextWindow = {
    kind: 'tomorrow',
    date: '2026-10-15',
    window: { start: '08:00', end: '12:00' },
    effectiveWindow: null,
    recommendationKind: 'best_pick',
    warnings: [],
    best: {
      ...departure('2026-10-15T08:00:00Z', 84),
      routeId: 'a',
      routeName: 'Richmond',
    },
  };
  expect(windowName(tomorrow)).toBe('Tomorrow morning');
  // Named only when the whole window lies in one part of the day.
  expect(
    windowName({ ...tomorrow, window: { start: '08:00', end: '14:00' } }),
  ).toBe('Tomorrow');
  expect(windowWhen(tomorrow, today, today, TZ)).toBe(
    'Thu 15 Oct · 08:00–12:00',
  );
  expect(windowBest(tomorrow, TZ)).toBe('Richmond, leave 09:00 · 15° dry');
  const weekday: NextWindow = {
    ...tomorrow,
    kind: 'same_weekday',
    date: '2026-10-21',
    window: { start: '15:00', end: '17:00' },
  };
  expect(windowName(weekday)).toBe('Next Wednesday afternoon');
  expect(
    windowName({ ...weekday, window: { start: '18:00', end: '20:00' } }),
  ).toBe('Next Wednesday evening');
  expect(windowName({ ...weekday, window: 'daylight' })).toBe('Next Wednesday');
  expect(windowWhen(weekday, today, today, TZ)).toBe(
    'Wed 21 Oct · 15:00–17:00 · same as today',
  );
  const week: NextWindow = {
    ...tomorrow,
    kind: 'best_next_days',
    date: '2026-10-17',
    window: 'daylight',
    best: { ...tomorrow.best, departureAt: '2026-10-17T08:00:00Z' },
  };
  expect(windowName(week)).toBe('Best in the next 6 days');
  expect(windowWhen(week, today, today, TZ)).toBe(
    `Any daylight, ${datesLabel('2026-10-15', '2026-10-20')}`,
  );
  expect(windowBest(week, TZ)).toBe('Richmond, Sat 17 Oct 09:00 · 15° dry');
});

test('condition chips: temperature, wind, rain, amber where it lowers the score', () => {
  const calm = {
    temperatureC: { minimum: 9.6, maximum: 11.4 },
    averageWindSpeedKph: 3.2,
    averageHeadwindKph: 1,
    averageTailwindKph: 2,
    averageCrosswindKph: 1,
    maximumPrecipitationProbability: 0.04,
  };
  const comfort = { comfortMinC: 8, comfortMaxC: 20 };
  const chips = (c: Partial<Conditions>) =>
    conditionChips({ ...calm, ...c }, comfort).map(
      (chip) =>
        `${chip.icon} ${chip.text} | ${chip.label}${chip.warn ? ' !' : ''}`,
    );

  // Calm: speed only, even with fractions; no summary yet and a low chance reads dry.
  expect(
    chips({
      windDistanceFractions: { headwind: 0.1, tailwind: 0.8, crosswind: 0.1 },
    }),
  ).toEqual([
    'temperature 10–11°C | Temperature 10–11°C',
    'wind 3 km/h | Wind 3 km/h',
    'dry Dry | Dry, no rain',
  ]);
  // Mostly tailwind is fine; mostly crosswind or headwind is amber; no majority names nothing.
  const windy = (f: Record<'headwind' | 'tailwind' | 'crosswind', number>) =>
    chips({ averageWindSpeedKph: 12, windDistanceFractions: f })[1];
  expect(windy({ headwind: 0.1, tailwind: 0.6, crosswind: 0.3 })).toBe(
    'wind 12 km/h tailwind | Tailwind 12 km/h',
  );
  expect(windy({ headwind: 0.2, tailwind: 0.2, crosswind: 0.6 })).toBe(
    'wind 12 km/h crosswind | Crosswind 12 km/h !',
  );
  expect(windy({ headwind: 0.4, tailwind: 0.3, crosswind: 0.3 })).toBe(
    'wind 12 km/h | Wind 12 km/h',
  );
  // Before the API ships fractions, the speed alone.
  expect(chips({ averageWindSpeedKph: 15 })[1]).toBe(
    'wind 15 km/h | Wind 15 km/h',
  );

  // Outside the comfort range; one rounded value shows once.
  expect(chips({ temperatureC: { minimum: 6.6, maximum: 7.4 } })[0]).toBe(
    'temperature 7°C | Temperature 7°C !',
  );
  expect(conditionChips(calm)[0].warn).toBe(false);

  // Rain: the API's summary, else the chance.
  expect(chips({ precipitationSummary: 'light_showers' })[2]).toBe(
    'wet Light showers | Rain: light showers !',
  );
  expect(
    chips({
      precipitationSummary: 'dry',
      maximumPrecipitationProbability: 0.2,
    })[2],
  ).toBe('dry Dry | Dry, no rain');
  expect(chips({ maximumPrecipitationProbability: 0.35 })[2]).toBe(
    'wet 35% chance of rain | 35% chance of rain !',
  );
});
