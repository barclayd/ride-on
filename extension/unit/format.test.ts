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
  Levels,
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
  conditionsText,
  convert,
  coverageText,
  datesLabel,
  dayMonth,
  degrees,
  draftFrom,
  draftPatch,
  ended,
  logged,
  monthLabel,
  planFor,
  planningDates,
  rankText,
  regionUnits,
  ridden,
  rideLine,
  rideSummary,
  searchPatch,
  shownOf,
  skyChip,
  speed,
  tile,
  toggleDay,
  updatedText,
  validateRange,
  viewOf,
  windowBest,
  windowLabel,
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
  ]);
  expect(planningDates({ kind: 'preset', preset: 'tomorrow' }, today)).toEqual([
    '2026-10-15',
  ]);
  // Next 5 days starts tomorrow; the background sends it to the API as these dates.
  expect(planningDates({ kind: 'preset', preset: 'next' }, today)).toEqual([
    '2026-10-15',
    '2026-10-16',
    '2026-10-17',
    '2026-10-18',
    '2026-10-19',
  ]);
  expect(planningDates({ kind: 'preset', preset: 'weekend' }, today)).toEqual([
    '2026-10-17',
    '2026-10-18',
  ]);
  // On Sunday the weekend is what's left of it.
  expect(
    planningDates({ kind: 'preset', preset: 'weekend' }, '2026-10-18'),
  ).toEqual(['2026-10-18']);
  const range = (start: string, end: string) =>
    ({ kind: 'range', start, end }) as const;
  const dates = (...dates: string[]) => ({ kind: 'dates', dates }) as const;
  expect(planningDates(range('2026-10-01', '2026-10-13'), today)).toBeNull();
  expect(planningDates(range('2026-10-12', '2026-10-15'), today)).toEqual([
    today,
    '2026-10-15',
  ]);
  expect(
    planningDates(dates('2026-10-13', '2026-10-15', '2026-10-17'), today),
  ).toEqual(['2026-10-15', '2026-10-17']);
  expect(planningDates(dates('2026-10-12', '2026-10-13'), today)).toBeNull();
  // Days tap on and off, and gaps stay gaps.
  expect(toggleDay(null, '2026-10-14')).toEqual(dates('2026-10-14'));
  expect(toggleDay(['2026-10-15'], '2026-10-17')).toEqual(
    dates('2026-10-15', '2026-10-17'),
  );
  expect(toggleDay(['2026-10-15', '2026-10-17'], '2026-10-13')).toEqual(
    dates('2026-10-13', '2026-10-15', '2026-10-17'),
  );
  expect(
    toggleDay(['2026-10-14', '2026-10-15', '2026-10-16'], '2026-10-15'),
  ).toEqual(dates('2026-10-14', '2026-10-16'));
  expect(toggleDay(['2026-10-15'], '2026-10-15')).toBeNull();
  // Runs read as spans; the month shows where it changes.
  expect(datesLabel(['2026-10-17'])).toBe('Sat 17 Oct');
  expect(datesLabel(['2026-10-17', '2026-10-18'])).toBe('Sat 17 – Sun 18 Oct');
  expect(datesLabel(['2026-10-31', '2026-11-01'])).toBe(
    'Sat 31 Oct – Sun 1 Nov',
  );
  expect(datesLabel(['2026-10-13', '2026-10-17'])).toBe('Tue 13 & Sat 17 Oct');
  expect(
    datesLabel(['2026-10-12', '2026-10-13', '2026-10-15', '2026-10-17']),
  ).toBe('Mon 12 – Tue 13, Thu 15 & Sat 17 Oct');
  expect(datesLabel(['2026-10-30', '2026-11-01'])).toBe(
    'Fri 30 Oct & Sun 1 Nov',
  );
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
    title: 'Some weather details or hours are missing along your routes',
  });

  expect(coverageText(days.slice(0, 2), TZ)).toBeNull();
  expect(coverageText(days.slice(0, 4), TZ)).toBe(
    "Wednesday and Thursday available; Friday's forecast only covers the morning; Saturday's forecast isn't available yet.",
  );
  expect(coverageText([{ ...days[2], until: null }], TZ)).toBe(
    "Friday's forecast is missing some weather details or hours along your routes.",
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
  range: { start: '2026-10-14', end: '2026-10-14', dates: ['2026-10-14'] },
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

test('usable rides explain uncertain sunshine without an incomplete-forecast verdict', () => {
  for (const status of ['complete', 'partial', 'unavailable'] as const) {
    const best = {
      ...departure('2026-10-14T08:00:00Z', 80),
      sunshineAssessment: {
        status,
        unknownDistanceFraction: status === 'complete' ? 0 : 0.5,
      },
    };
    const out = buildResults(
      ['a'],
      {},
      recs('match_found', [result('a', best)]),
      [days[0]],
      TZ,
    );
    expect(out.cards[0]?.state).toBe('meets');
    expect(out.cards[0]?.coverage).toBe(
      status === 'complete' ? null : 'Sunshine is uncertain for this ride.',
    );
    expect(out.coverageWarn).toBe(false);
  }
});

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
  floorMode: 'fixed',
  floorFixedC: 3,
  floorMonthsC: [0, 0, 2, 4, 6, 8, 10, 10, 7, 5, 2, 0],
  heatC: 28,
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
    maximumTemperatureC: null,
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
  expect(
    draftPatch({ ...draft, heatOn: true }).minimumStandards
      ?.maximumTemperatureC,
  ).toBe(28);
  expect(applyPatch(prefs, { distance: null }).distance).toBeNull();
});

test('gust comfort persists independently of the maximum-gust cutoff', () => {
  const draft = draftFrom(
    { ...prefs, wind: { ...prefs.wind, comfortableGustKph: 25 } },
    local,
  );
  expect(draft.gustComfortKph).toBe(25);
  const patch = draftPatch({ ...draft, gustComfortKph: 30 });
  expect(patch.wind?.comfortableGustKph).toBe(30);
  expect(patch.minimumStandards?.maximumGustKph).toBe(40);
  expect(draftFrom(applyPatch(prefs, patch), local).gustComfortKph).toBe(30);
});

test('gust chips use ride maxima, personal comfort and selected units; older results remain readable', () => {
  const c: Conditions = {
    temperatureC: { minimum: 19.6, maximum: 19.9 },
    averageWindSpeedKph: 16,
    averageHeadwindKph: 0,
    averageCrosswindKph: 16,
    averageTailwindKph: 0,
    maximumPrecipitationProbability: 0,
    maximumGustKph: 49.9,
  };
  const chips = conditionChips(c, regionUnits('en-GB'), {
    temperature: prefs.temperature,
    wind: { ...prefs.wind, comfortableGustKph: 25 },
  });
  expect(chips[0]?.text).toBe('20°C');
  expect(chips[2]).toMatchObject({
    text: 'Gusts 31 mph',
    label: 'Maximum gusts during the ride 31 mph',
    warn: true,
  });
  expect(
    conditionChips(c, undefined, {
      wind: { ...prefs.wind, comfortableGustKph: 55 },
    })[2]?.warn,
  ).toBe(false);
  expect(conditionChips({ ...c, maximumGustKph: undefined })).toHaveLength(3);
});

test('helpful gusts avoid the comfort warning while opposing exposure and raw gust limits remain visible', () => {
  const c: Conditions = {
    temperatureC: { minimum: 9, maximum: 13 },
    averageWindSpeedKph: 16,
    averageHeadwindKph: 0,
    averageTailwindKph: 16,
    averageCrosswindKph: 0,
    maximumPrecipitationProbability: 0,
    maximumGustKph: 43,
    gustExposure: {
      directionBasis: 'prevailing-wind-estimate',
      maximumAdverseKph: 0,
    },
  };
  const preferences = { wind: { ...prefs.wind, comfortableGustKph: 25 } };
  expect(conditionChips(c, undefined, preferences)[2]).toMatchObject({
    text: 'Gusts 43 km/h',
    warn: false,
  });
  expect(
    conditionChips(
      {
        ...c,
        gustExposure: {
          directionBasis: 'prevailing-wind-estimate',
          maximumAdverseKph: 30,
        },
      },
      undefined,
      preferences,
    )[2]?.warn,
  ).toBe(true);
  expect(
    conditionChips(c, undefined, {
      ...preferences,
      minimumStandards: { maximumGustKph: 40 },
    })[2]?.warn,
  ).toBe(true);
  expect(
    conditionChips({ ...c, gustExposure: undefined }, undefined, preferences)[2]
      ?.warn,
  ).toBe(true);
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
  expect(view.range).toEqual(['2026-10-14']);
  expect(view.selected.map((d) => d.date)).toEqual(['2026-10-14']);
  expect(view.datesText).toBe('Wed 14 Oct');
  expect(view.retrieved).toBe('09:50');
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
  expect(shown.dates).toEqual(['2026-10-14']);
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
    'Any daylight, Thu 15 – Tue 20 Oct',
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
    conditionChips({ ...calm, ...c }, undefined, { temperature: comfort }).map(
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
  // Amber when the speed shown beats the rider's comfort for its direction (15 head, 20 cross here);
  // a mix is held to the headwind comfort; tailwinds never.
  const windy = (
    f: Record<'headwind' | 'tailwind' | 'crosswind', number>,
    kph = 18,
  ) => chips({ averageWindSpeedKph: kph, windDistanceFractions: f })[1];
  expect(windy({ headwind: 0.1, tailwind: 0.6, crosswind: 0.3 }, 30)).toBe(
    'wind 30 km/h tailwind | Tailwind 30 km/h',
  );
  expect(windy({ headwind: 0.2, tailwind: 0.2, crosswind: 0.6 })).toBe(
    'wind 18 km/h crosswind | Crosswind 18 km/h',
  );
  expect(windy({ headwind: 0.2, tailwind: 0.2, crosswind: 0.6 }, 22)).toBe(
    'wind 22 km/h crosswind | Crosswind 22 km/h !',
  );
  expect(windy({ headwind: 0.6, tailwind: 0.2, crosswind: 0.2 })).toBe(
    'wind 18 km/h headwind | Headwind 18 km/h !',
  );
  expect(windy({ headwind: 0.4, tailwind: 0.3, crosswind: 0.3 })).toBe(
    'wind 18 km/h | Wind 18 km/h !',
  );
  expect(windy({ headwind: 0.4, tailwind: 0.3, crosswind: 0.3 }, 12)).toBe(
    'wind 12 km/h | Wind 12 km/h',
  );
  // Before the API ships fractions, the speed alone.
  expect(chips({ averageWindSpeedKph: 15 })[1]).toBe(
    'wind 15 km/h | Wind 15 km/h',
  );
  // Prefer calm: any named wind lowers the score, a tailwind too; below it stays green.
  const ideal = (preferTailwind: boolean | undefined, kph: number) =>
    conditionChips(
      {
        ...calm,
        averageWindSpeedKph: kph,
        windDistanceFractions: { headwind: 0.1, tailwind: 0.8, crosswind: 0.1 },
      },
      undefined,
      {
        wind: {
          comfortableHeadwindKph: 15,
          comfortableCrosswindKph: 20,
          preferTailwind,
        },
      },
    )[1].warn;
  expect(ideal(false, 10)).toBe(true);
  expect(ideal(undefined, 12)).toBe(true); // the API's default
  expect(ideal(false, 9)).toBe(false);
  expect(ideal(true, 30)).toBe(false);

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

  // The sky has its own chip (handoff v4): the rain slot says Dry whatever the sky.
  expect(
    chips({
      skyConditionDistanceFractions: {
        sunny: 1,
        sunnyIntervals: 0,
        cloudy: 0,
        overcast: 0,
        obscured: 0,
      },
    })[2],
  ).toBe('dry Dry | Dry, no rain');

  // Preference levels: rain never amber when they don't mind; a bare chance only above their rain limit.
  const leveled = (
    more: Partial<Conditions>,
    levels: Levels,
    prefs: Partial<Preferences> = {},
  ) => conditionChips({ ...calm, ...more }, undefined, prefs, levels)[2];
  const dontMind = { sunshine: 'nice', rain: 'dont-mind' } as const;
  expect(leveled({ precipitationSummary: 'rain' }, dontMind).warn).toBe(false);
  const preferDry = { sunshine: 'nice', rain: 'light-ok' } as const;
  expect(leveled({ precipitationSummary: 'rain' }, preferDry).warn).toBe(true);
  const chance = { maximumPrecipitationProbability: 0.3 };
  const limit = (p: number) => ({
    minimumStandards: { maximumPrecipitationProbability: p },
  });
  expect(leveled(chance, preferDry).warn).toBe(true);
  expect(leveled(chance, preferDry, limit(0.4)).warn).toBe(false);
  expect(leveled(chance, preferDry, limit(0.2)).warn).toBe(true);
});

test('sky chip (handoff v4, 18a): labels, the timeline in ride order and rounded legend shares', () => {
  const complete = { status: 'complete', unknownDistanceFraction: 0 } as const;
  const hour = (km: number, shares: Record<string, number> | null) => ({
    start: '',
    end: '',
    conditions: {
      ...conditions,
      distanceKm: km,
      skyConditionDistanceFractions: null,
      skyConditionShares: shares,
    },
  });
  const sky = (
    overall: Record<string, number> | null,
    hours: ReturnType<typeof hour>[] = [],
    assessed: Departure['sunshineAssessment'] = complete,
    sunshine?: Levels['sunshine'],
  ) =>
    skyChip(
      {
        ...departure('2026-10-17T08:00:00Z', 73),
        conditions: { ...conditions, skyConditionShares: overall },
        rideHours: hours,
        sunshineAssessment: assessed,
      },
      sunshine,
    );
  const brief = (k: ReturnType<typeof sky>) =>
    k &&
    `${k.icon} ${k.text}${k.partial ? ' (dashed)' : ''} | ${k.label} | ${k.segments
      ?.map((g) => `${g.kind} ${g.share.toFixed(2)}`)
      .join(
        ', ',
      )} | ${k.legend?.map((l) => `${l.name} ${l.share}`).join(', ')}`;

  // Horsham: sun for two hours, then intervals. One label for any mix; the order is the timeline's.
  expect(
    brief(
      sky({ sunny: 0.55, sunnyIntervals: 0.45 }, [
        hour(20, { sunny: 1 }),
        hour(20, { sunny: 0.75, sunnyIntervals: 0.25 }),
        hour(20, { sunnyIntervals: 1 }),
      ]),
    ),
  ).toBe(
    'sunCloud Sun and sunny intervals | Sky: sun and sunny intervals | sunny 0.58, sunnyIntervals 0.42 | Sunny ~55%, Sunny intervals ~45%',
  );
  // Richmond: sunny throughout.
  expect(
    brief(sky({ sunny: 1 }, [hour(20, { sunny: 1 }), hour(15, { sunny: 1 })])),
  ).toBe(
    'sun Sunny throughout | Sky: sunny throughout | sunny 1.00 | Sunny Throughout',
  );
  // A rounded 1 isn't throughout when a ride hour has intervals; never shortened to "Sunny".
  expect(
    sky({ sunny: 1 }, [
      hour(20, { sunny: 1 }),
      hour(20, { sunny: 0.99, sunnyIntervals: 0.01 }),
    ])?.text,
  ).toBe('Sun and sunny intervals');
  // Mostly intervals: under 10% sun.
  expect(sky({ sunny: 0.05, sunnyIntervals: 0.95 })?.text).toBe(
    'Sunny intervals',
  );
  // Neighbouring hours merge; an hour's mix carries on the last colour first.
  expect(
    sky({ sunny: 0.5, sunnyIntervals: 0.5 }, [
      hour(10, { sunnyIntervals: 1 }),
      hour(10, { sunny: 0.5, sunnyIntervals: 0.5 }),
      hour(10, { sunny: 1 }),
    ])?.segments?.map((g) => g.kind),
  ).toEqual(['sunnyIntervals', 'sunny']);

  // The forecast stops before the finish: dashed, with the gap last.
  const partial = { status: 'partial', unknownDistanceFraction: 0.3 } as const;
  expect(
    brief(
      sky(
        { sunny: 0.7, unknown: 0.3 },
        [hour(20, { sunny: 1 }), hour(20, { sunny: 0.4, unknown: 0.6 })],
        partial,
      ),
    ),
  ).toBe(
    'sun Sunny where forecast (dashed) | Sky: sunny where forecast | sunny 0.70, unknown 0.30 | Sunny ~70%, Not forecast yet ~30%',
  );
  expect(
    sky({ sunny: 0.4, sunnyIntervals: 0.3, unknown: 0.3 }, [], partial)?.label,
  ).toBe('Sky: sun and sunny intervals where forecast');
  // Before skyConditionShares, a gap nulls the overall shares and its hour's: rebuilt from the hours.
  expect(
    brief(
      skyChip({
        ...departure('2026-10-17T08:00:00Z', 73),
        conditions: { ...conditions, skyConditionDistanceFractions: null },
        rideHours: [
          {
            ...hour(30, null),
            conditions: {
              ...conditions,
              distanceKm: 30,
              skyConditionDistanceFractions: {
                sunny: 1,
                sunnyIntervals: 0,
                cloudy: 0,
                overcast: 0,
                obscured: 0,
              },
            },
          },
          hour(10, null),
        ],
        sunshineAssessment: partial,
      }),
    ),
  ).toBe(
    'sun Sunny where forecast (dashed) | Sky: sunny where forecast | sunny 0.75, unknown 0.25 | Sunny ~75%, Not forecast yet ~25%',
  );

  // Mostly cloud keeps its word, amber only when sunshine is Important; cloud on a sunny ride is a mix.
  expect(brief(sky({ sunnyIntervals: 0.3, cloudy: 0.3, overcast: 0.4 }))).toBe(
    'cloud Overcast | Sky: overcast on 70% of the route | undefined | undefined',
  );
  expect(sky({ cloudy: 1 }, [], complete, 'important')?.warn).toBe(true);
  expect(sky({ cloudy: 1 })?.warn).toBe(false);
  expect(sky({ obscured: 0.7, cloudy: 0.3 })?.text).toBe('Fog');
  expect(
    brief(sky({ sunny: 0.6, overcast: 0.4 }))?.endsWith(
      'Sunny ~60%, Cloud ~40%',
    ),
  ).toBe(true);
  expect(sky({ sunny: 0.6, overcast: 0.4 })?.text).toBe('Sun and cloud');

  // Hidden when sunshine isn't weighed or nothing is forecast.
  expect(sky({ sunny: 1 }, [], null)).toBeNull();
  expect(
    sky({ unknown: 1 }, [], {
      status: 'unavailable',
      unknownDistanceFraction: 1,
    }),
  ).toBeNull();
});

test('units: region defaults and display conversion', () => {
  expect(regionUnits('en-US')).toEqual({ temperature: '°F', wind: 'mph' });
  expect(regionUnits('en-GB')).toEqual({ temperature: '°C', wind: 'mph' });
  expect(regionUnits('de-DE')).toEqual({ temperature: '°C', wind: 'km/h' });
  expect(regionUnits('fr')).toEqual({ temperature: '°C', wind: 'km/h' });
  const us = regionUnits('en-US');
  expect(degrees(10, us)).toBe(50);
  expect(degrees(-5, us)).toBe(23);
  expect(speed(15, us)).toBe('9 mph');
  expect(speed(15, regionUnits('de'))).toBe('15 km/h');

  const c = {
    temperatureC: { minimum: 9.6, maximum: 11.4 },
    averageWindSpeedKph: 15,
    averageTailwindKph: 2,
    averageHeadwindKph: 0,
    averageCrosswindKph: 15,
    maximumPrecipitationProbability: 0,
    windDistanceFractions: { headwind: 0.1, tailwind: 0.1, crosswind: 0.8 },
  } as Conditions;
  expect(
    conditionChips(c, us, {
      temperature: { comfortMinC: 10, comfortMaxC: 22 },
      wind: { comfortableHeadwindKph: 15, comfortableCrosswindKph: 5 },
    }).map((chip) => `${chip.text}${chip.warn ? ' !' : ''}`),
  ).toEqual(['50–52°F', '9 mph crosswind !', 'Dry']);
  // The 10 km/h threshold holds whatever the unit: 9 km/h is 6 mph, unnamed.
  expect(conditionChips({ ...c, averageWindSpeedKph: 9 }, us)[1].text).toBe(
    '6 mph',
  );
  expect(conditionsText(c, us)).toBe('50–52° · crosswind 9 mph · dry');
});

test('Rides tab heading: the window, then how old the forecast is', () => {
  const custom = (start: string, end: string) =>
    ({ mode: 'custom', start, end }) as const;
  const day = { kind: 'preset', preset: 'tomorrow' } as const;
  const today = '2026-10-11';
  const tomorrow = ['2026-10-12'];
  expect(
    windowLabel({ days: day, time: custom('07:00', '11:00') }, tomorrow, today),
  ).toBe('Tomorrow morning');
  expect(
    windowLabel({ days: day, time: custom('08:00', '14:00') }, tomorrow, today),
  ).toBe('Tomorrow');
  expect(
    windowLabel(
      {
        days: { kind: 'preset', preset: 'weekend' },
        time: custom('17:00', '20:00'),
      },
      ['2026-10-17', '2026-10-18'],
      today,
    ),
  ).toBe('This weekend');
  const at = '2026-10-11T10:00:00Z';
  expect(updatedText(at, new Date('2026-10-11T10:00:40Z'))).toBe(
    'Updated just now',
  );
  expect(updatedText(at, new Date('2026-10-11T10:05:00Z'))).toBe(
    'Updated 5 minutes ago',
  );
  expect(updatedText(at, new Date('2026-10-11T12:30:00Z'))).toBe(
    'Updated 2 hours ago',
  );
});
