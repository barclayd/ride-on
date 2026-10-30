import { expect, test } from 'bun:test';
import type { LibraryRoute } from './library.ts';
import {
  type Best,
  chips,
  dayName,
  libraryFacts,
  panel,
  type Ranking,
  type Recommendations,
  source,
  word,
} from './view.ts';

// Trimmed from a local `POST /recommendations` answer (30 October 2026, Met Office data).
const route = (
  id: string,
  name: string,
  distanceM: number,
  extra: Partial<LibraryRoute> = {},
): LibraryRoute => ({
  id,
  name,
  version: 1,
  distanceM,
  ascentM: 120,
  geometryStatus: 'available',
  createdAt: '2026-10-30T20:00:00Z',
  source: null,
  surfaceSummary: null,
  ...extra,
});
const best = (
  departureAt: string,
  finishAt: string,
  score: number,
  extra: Partial<Best> = {},
): Best => ({
  date: departureAt.slice(0, 10),
  departureAt,
  finishAt,
  score,
  standards: { status: 'not_configured', failures: [] },
  scoreChange: null,
  conditions: {
    temperatureC: { minimum: 15.3, maximum: 15.4 },
    averageWindSpeedKph: 5.06,
    precipitationSummary: 'dry',
    skyConditionDistanceFractions: null,
  },
  ...extra,
});
const ranking = (
  { id, name, distanceM }: LibraryRoute,
  b: Best | null,
  verdict: Ranking['verdict'] = { status: 'meets', reason: '' },
): Ranking => ({
  routeId: id,
  routeName: name,
  distanceM,
  ascentM: 120,
  best: b,
  verdict,
});

const richmond = route('rp', 'Richmond Park', 15_700);
const kingston = route('kl', 'Kingston Loop', 22_970, {
  source: { providerId: 'cycle-travel', externalId: '1' },
  surfaceSummary: { unpavedFraction: 0.12 },
});
const windsor = route('wr', 'Windsor Run', 39_840);
const boxHill = route('bh', 'Box Hill', 31_460);
const routes = [richmond, kingston, windsor, boxHill];
const recs: Recommendations = {
  generatedAt: '2026-10-30T20:36:30.455Z',
  timeZone: 'Europe/London',
  recommendation: { routeId: 'rp' },
  rankings: [
    ranking(
      richmond,
      best('2026-10-31T14:00:00.000Z', '2026-10-31T14:47:05.968Z', 97.47),
    ),
    ranking(
      kingston,
      best('2026-10-31T13:30:00.000Z', '2026-10-31T14:38:53.747Z', 96.18, {
        scoreChange: { by: 3 },
      }),
    ),
  ],
  unranked: [],
  weather: {
    retrieval: { latestAt: '2026-10-30T20:36:32.921Z' },
    attribution: [
      {
        text: 'Powered by Met Office data',
        url: 'https://www.metoffice.gov.uk/',
      },
    ],
  },
};
const input = {
  routes,
  shortlist: ['rp', 'kl'],
  recs,
  checking: new Set<string>(),
  recsFailed: false,
  query: '',
};

test('scores keep their words at the old band thresholds', () => {
  expect([82, 75, 74.4, 60, 59.6, 50, 49].map(word)).toEqual([
    'Great',
    'Great',
    'Good',
    'Good',
    'Good',
    'Fair',
    'Not recommended',
  ]);
});

test('days read Today, Tomorrow, then the weekday, in the rider’s time zone', () => {
  expect(dayName('2026-10-30', recs)).toBe('Today');
  expect(dayName('2026-10-31', recs)).toBe('Tomorrow');
  expect(dayName('2026-11-01', recs)).toBe('Sunday');
  // 23:30 UTC on the 31st is already 1 November in Paris.
  const paris = {
    ...recs,
    generatedAt: '2026-10-31T23:30:00Z',
    timeZone: 'Europe/Paris',
  };
  expect(dayName('2026-11-01', paris)).toBe('Today');
});

test('the best pick card', () => {
  expect(panel(input).best).toEqual({
    id: 'rp',
    day: 'Tomorrow',
    name: 'Richmond Park',
    dep: '14:00 → ~14:47',
    facts: '↔ 15.7 km · 120 m climb',
    score: 97,
    word: 'Great',
    chips: [
      { icon: 'thermometer', text: '15°' },
      { icon: 'wind', text: '5 km/h' },
      { icon: 'dropletOff', text: 'Dry' },
    ],
    verdict: { text: 'Meets your preferences', tone: 'meets' },
  });
});

test('chips show the sky for most of the ride, and the rain in words', () => {
  expect(
    chips({
      temperatureC: { minimum: 13.2, maximum: 15.4 },
      averageWindSpeedKph: null,
      precipitationSummary: 'light_showers',
      skyConditionDistanceFractions: { sunnyIntervals: 0.7, cloudy: 0.3 },
    }),
  ).toEqual([
    { icon: 'thermometer', text: '13–15°' },
    { icon: 'cloudSun', text: 'Sunny spells' },
    { icon: 'cloudRain', text: 'Light showers' },
  ]);
});

test('shortlist rows: the score, its change, the window and the conditions', () => {
  const view = panel(input);
  expect(view.rows).toEqual([
    {
      id: 'kl',
      name: 'Kingston Loop',
      score: '96',
      delta: '▲ 3',
      l1: 'Great · 13:30 → ~14:38',
      l2: '23.0 km · 15° · 5 km/h · dry',
      below: '',
    },
  ]);
  expect(view.count).toBe('2 of 12');
  expect(view.footer).toEqual({
    updated: 'Updated 20:36 · forecast retrieved 20:36',
    attribution: recs.weather?.attribution ?? [],
  });
});

test('a row on another day than the best pick names its day', () => {
  const later = ranking(
    windsor,
    best('2026-11-01T10:00:00.000Z', '2026-11-01T12:00:00.000Z', 61),
  );
  const view = panel({
    ...input,
    shortlist: ['rp', 'wr'],
    recs: { ...recs, rankings: [recs.rankings[0] as Ranking, later] },
  });
  expect(view.rows[0]?.l1).toBe('Good · Sunday 10:00 → ~12:00');
});

test('below your minimums: the warning line says which, and the verdict turns grey', () => {
  const below = ranking(
    windsor,
    best('2026-10-31T10:00:00.000Z', '2026-10-31T12:00:00.000Z', 40, {
      standards: {
        status: 'below',
        failures: [
          { standard: 'maximumGustKph', limit: 30, actual: 38.2 },
          { standard: 'minimumTemperatureC', limit: 4, actual: 2.1 },
        ],
      },
    }),
    { status: 'below_minimums', reason: '' },
  );
  const view = panel({
    ...input,
    shortlist: ['wr'],
    recs: { ...recs, recommendation: null, rankings: [below] },
  });
  expect(view.best?.verdict).toEqual({
    text: 'Below your minimums',
    tone: 'low',
  });
  const other = panel({
    ...input,
    shortlist: ['rp', 'wr'],
    recs: { ...recs, rankings: [recs.rankings[0] as Ranking, below] },
  });
  expect(other.rows[0]?.below).toBe(
    'Below your minimums: gusts 38 km/h, low of 2°',
  );
});

test("routes that don't fit get their own section; incomplete ones stay in the shortlist", () => {
  const view = panel({
    ...input,
    shortlist: ['rp', 'wr', 'bh'],
    recs: {
      ...recs,
      rankings: [recs.rankings[0] as Ranking],
      unranked: [
        ranking(windsor, null, {
          status: 'doesnt_fit',
          reason: 'Takes 2 h 10 min; your window is 1 h 30 min.',
        }),
        ranking(boxHill, null, {
          status: 'incomplete',
          reason: 'No forecast for this area yet.',
        }),
      ],
    },
  });
  expect(view.doesntFit).toEqual([
    {
      id: 'wr',
      name: 'Windsor Run',
      facts: '39.8 km · 120 m climb',
      reason: 'Takes 2 h 10 min; your window is 1 h 30 min.',
    },
  ]);
  expect(view.rows.map(({ id, score, l1 }) => ({ id, score, l1 }))).toEqual([
    { id: 'bh', score: '–', l1: 'No forecast for this area yet.' },
  ]);
});

test('a just-added route reads "Checking the forecast…" until the answer comes', () => {
  const adding = { ...input, shortlist: ['rp', 'kl', 'wr'] };
  const checking = panel({ ...adding, checking: new Set(['wr']) });
  expect(checking.rows.at(-1)).toMatchObject({
    id: 'wr',
    score: '–',
    l1: 'Checking the forecast…',
    l2: '39.8 km',
  });
  const failed = panel({
    ...adding,
    checking: new Set(['wr']),
    recsFailed: true,
  });
  expect(failed.rows.at(-1)?.l1).toBe("Couldn't check the forecast");
  // Before the first answer, every shortlisted route is waiting.
  expect(panel({ ...input, recs: null }).rows.map((row) => row.id)).toEqual([
    'rp',
    'kl',
  ]);
});

test('the library lists the routes not shortlisted, with where they came from', () => {
  const view = panel({ ...input, shortlist: ['rp'] });
  expect(view.library.map((row) => row.id)).toEqual(['kl', 'wr', 'bh']);
  expect(view.library[0]).toEqual({
    id: 'kl',
    name: 'Kingston Loop',
    facts: '23.0 km · 120 m · 12% unpaved',
    src: 'cycle.travel',
  });
  expect(view.libraryCount).toBe('3 routes');
  expect(libraryFacts(richmond)).toBe('15.7 km · 120 m');
  expect(source(richmond)).toBe('GPX upload');
});

test('search filters every section by name, the best pick included', () => {
  const view = panel({ ...input, shortlist: ['rp', 'kl'], query: ' king ' });
  expect(view.best).toBeNull();
  expect(view.rows.map((row) => row.id)).toEqual(['kl']);
  expect(view.library).toEqual([]);
  // The counts stay the shortlist's, not the search's.
  expect(view.count).toBe('2 of 12');
});
