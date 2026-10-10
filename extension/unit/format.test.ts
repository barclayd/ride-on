import { expect, test } from 'bun:test';
import type { RankedRoute, Recommendations, User } from '../lib/types';
import {
  addDays,
  buildCards,
  conditionsLine,
  daysLabel,
  draftFromUser,
  pickDay,
  pickDrawback,
  preferencesPatch,
  resolveDays,
} from '../ui/format';

const horizon = (start: string, n = 5) =>
  Array.from({ length: n }, (_, i) => addDays(start, i));
const wed = horizon('2026-10-14'); // Wed–Sun
const mon = horizon('2026-10-12'); // Mon–Fri

test('resolveDays mirrors the API presets, clipping and past fallback', () => {
  const preset = (p: 'today' | 'tomorrow' | 'weekend' | 'next') =>
    ({ kind: 'preset', preset: p }) as const;
  expect(resolveDays(preset('weekend'), wed)).toEqual([
    '2026-10-17',
    '2026-10-18',
  ]);
  expect(resolveDays(preset('weekend'), mon)).toBeNull();
  expect(resolveDays(preset('tomorrow'), wed)).toEqual([
    '2026-10-15',
    '2026-10-15',
  ]);
  const range = (start: string, end: string) =>
    ({ kind: 'range', start, end }) as const;
  expect(resolveDays(range('2026-10-13', '2026-10-15'), wed)).toEqual([
    '2026-10-14',
    '2026-10-15',
  ]);
  expect(resolveDays(range('2026-10-01', '2026-10-02'), wed)).toEqual([
    '2026-10-14',
    '2026-10-18',
  ]);
});

test('pickDay extends a single day to a range, then resets', () => {
  expect(pickDay(['2026-10-16', '2026-10-16'], '2026-10-14')).toEqual({
    kind: 'range',
    start: '2026-10-14',
    end: '2026-10-16',
  });
  expect(pickDay(['2026-10-14', '2026-10-16'], '2026-10-15')).toEqual({
    kind: 'range',
    start: '2026-10-15',
    end: '2026-10-15',
  });
  expect(
    daysLabel(
      { kind: 'range', start: '2026-10-17', end: '2026-10-19' },
      horizon('2026-10-17'),
      '2026-10-17',
    ),
  ).toBe('Sat 17 – Mon 19');
});

const conditions = {
  temperatureC: { minimum: 9, maximum: 14.4 },
  averageWindSpeedKph: 15,
  averageHeadwindKph: 3,
  averageTailwindKph: 12,
  averageCrosswindKph: 4,
  maximumPrecipitationProbability: 0.05,
};

test('card text', () => {
  expect(conditionsLine(conditions)).toBe('14° · tailwind 12 km/h · dry');
  expect(
    pickDrawback([
      'Precipitation is possible during this ride; …',
      'Gusts exceed your comfort setting.',
    ]),
  ).toBe('Gusts exceed your comfort setting.');
});

test('buildCards orders ranked rides, then no-ride, then pending', () => {
  const ranked = (routeId: string, score: number): RankedRoute => ({
    routeId,
    routeName: routeId,
    distanceKm: 50.4,
    issues: [],
    confidence: 2,
    verdict: { status: 'ride', reason: null },
    best: {
      date: '2026-10-14',
      departureAt: '2026-10-14T08:00:00Z',
      finishAt: '2026-10-14T11:00:00Z',
      score,
      conditions,
      drawbacks: [],
    },
  });
  const recs: Recommendations = {
    message: '',
    rankings: [ranked('a', 81.6), ranked('b', 70)],
    unranked: [
      {
        ...ranked('c', 0),
        best: null,
        verdict: { status: 'no_ride', reason: 'Gusts reach 52 km/h.' },
      },
    ],
  };
  const cards = buildCards(
    ['p', 'c', 'b', 'a'],
    {},
    recs,
    'Europe/London',
    '2026-10-14',
  );
  expect(cards.map((c) => [c.routeId, c.rankLabel])).toEqual([
    ['a', 'Best pick'],
    ['b', '#2'],
    ['c', 'No ride'],
    ['p', '…'],
  ]);
  expect(cards[0]).toMatchObject({
    day: 'Today',
    window: '09:00–12:00',
    score: 82,
    km: 50,
  });
  expect(cards[2].reason).toBe('Gusts reach 52 km/h.');
});

test('preferences send only changed fields and never custom', () => {
  const user = {
    settings: {
      preferences: {
        temperature: { comfortMinC: 10, comfortMaxC: 22 },
        wind: { comfortableHeadwindKph: 15 },
        minimumStandards: {
          minimumTemperature: {
            kind: 'monthly',
            valuesC: { '10': 4 },
            fallbackC: null,
          },
        },
      },
    },
    preferenceLevels: {
      sunshine: 'custom',
      rain: 'light-ok',
      climbing: 'neutral',
      comfortableWindKph: 15,
    },
  } as unknown as User;
  const base = draftFromUser(user, '2026-10-14');
  expect(base).toMatchObject({
    sunshine: null,
    colderThanC: 4,
    rainAbovePct: 70,
    gustsAboveKph: 50,
  });
  expect(preferencesPatch(base, base)).toEqual({});
  expect(
    preferencesPatch(base, {
      ...base,
      rain: 'avoid',
      comfortMaxC: 24,
      colderThanC: 2,
    }),
  ).toEqual({
    preferenceLevels: { rain: 'avoid' },
    preferences: {
      temperature: { comfortMinC: 10, comfortMaxC: 24 },
      minimumStandards: { minimumTemperature: { kind: 'fixed', valueC: 2 } },
    },
  });
});
