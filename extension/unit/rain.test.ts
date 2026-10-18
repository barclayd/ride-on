import { expect, test } from 'bun:test';
import type { Conditions, Departure } from '../lib/types';
import { rainPanel } from '../ui/rain';

const C = (more: Partial<Conditions> = {}): Conditions => ({
  temperatureC: { minimum: 10, maximum: 14 },
  averageWindSpeedKph: 15,
  averageHeadwindKph: 2,
  averageTailwindKph: 10,
  averageCrosswindKph: 3,
  maximumPrecipitationProbability: 0,
  ...more,
});
// The design's rides (handoff v7, 25b), leaving on the hour's half past in October (BST).
const ride = (
  hours: [number, number | undefined][],
  more: Partial<Departure> = {},
): Departure => {
  const start = Date.parse('2026-10-17T07:30:00Z');
  const at = (h: number) => new Date(start + h * 3_600_000).toISOString();
  return {
    date: '2026-10-17',
    departureAt: at(0),
    finishAt: at(hours.length),
    score: 80,
    standards: { status: 'meets', failures: [] },
    conditions: C(),
    rideHours: hours.map(([chance, mm], h) => ({
      start: at(h),
      end: at(h + 1),
      conditions: C({
        maximumPrecipitationProbability: chance / 100,
        maximumPrecipitationAmountMm: mm,
      }),
    })),
    ...more,
  };
};
const LONDON = 'Europe/London';

test('rain from the third hour that never eases names it and the heaviest hour', () => {
  const rain = rainPanel(
    ride([
      [5, 0],
      [10, 0],
      [45, 0.3],
      [70, 1.6],
      [50, 0.6],
    ]),
    LONDON,
  );
  expect(rain).toMatchObject({
    text: 'Rain likely 10:30',
    label: 'Rain likely 10:30. Show rain along the ride',
    wet: true,
    dry: false,
    headline: 'Rain likely from about 10:30',
    sentence:
      'Rain likely from about 10:30 until the finish. Heaviest around 11:30: moderate, 1.6 mm in the hour, 70% chance.',
  });
  expect(
    rain?.hours.map((h) => `${h.time} ${h.chance}% ${h.word} ${h.mm}`),
  ).toEqual([
    '08:30 5% None 0',
    '09:30 10% None 0',
    '10:30 45% Light 0.3',
    '11:30 70% Moderate 1.6',
    '12:30 50% Light 0.6',
  ]);
});

test('rain that eases says when, and heavy is 4 mm or more', () => {
  const rain = rainPanel(
    ride([
      [20, 0],
      [60, 2.5],
      [85, 5.2],
      [35, 0.4],
    ]),
    LONDON,
  );
  expect(rain?.sentence).toBe(
    'Rain likely from about 09:30, easing by about 11:30. Heaviest around 10:30: heavy, 5.2 mm in the hour, 85% chance.',
  );
  expect(rain?.hours.map((h) => h.level)).toEqual([0, 2, 3, 1]);
});

test('light rain from the first hour is drizzle at start', () => {
  const rain = rainPanel(
    ride([
      [80, 0.2],
      [75, 0.3],
      [35, 0.1],
    ]),
    LONDON,
  );
  expect(rain).toMatchObject({
    text: 'Drizzle likely at start',
    headline: 'Drizzle likely from the start',
    sentence:
      'Drizzle likely from the start, easing by about 10:30. Heaviest around 09:30: light, 0.3 mm in the hour, 75% chance.',
  });
});

test('a highest chance under 60% is possible', () => {
  expect(
    rainPanel(
      ride([
        [10, 0],
        [55, 1.2],
      ]),
      LONDON,
    )?.text,
  ).toBe('Rain possible 09:30');
});

test('every hour under 20% is a dry ride, under 40% a small chance', () => {
  expect(
    rainPanel(
      ride([
        [5, 0],
        [10, 0],
      ]),
      LONDON,
    ),
  ).toMatchObject({
    text: 'Dry',
    wet: false,
    dry: true,
    headline: 'Dry ride',
    sentence: 'Chance of rain stays under 20% for the whole ride.',
  });
  expect(
    rainPanel(
      ride([
        [25, 0.1],
        [10, 0],
      ]),
      LONDON,
    ),
  ).toMatchObject({
    text: 'Small chance of rain',
    wet: false,
    dry: false,
    headline: 'Rain unlikely',
    sentence: 'Chance of rain stays under 40% for the whole ride.',
  });
});

test('a wet chance with no measurable rain says so instead of a heaviest hour', () => {
  expect(
    rainPanel(
      ride([
        [45, 0],
        [50, 0.04],
      ]),
      LONDON,
    )?.sentence,
  ).toBe(
    'Drizzle possible from the start until the finish. Under 0.1 mm in any hour, up to 50% chance.',
  );
});

test('sleet, hail, snow and thunder keep their own word', () => {
  const snow = ride(
    [
      [10, 0],
      [70, 2],
    ],
    { conditions: C({ precipitationSummary: 'snow' }) },
  );
  expect(rainPanel(snow, LONDON)?.text).toBe('Snow likely 09:30');
});

test("until the API sends the hour's amount, its heaviest rate stands in", () => {
  const b = ride([[50, undefined]]);
  const hour = b.rideHours?.[0].conditions;
  if (hour) hour.maximumPrecipitationRateMmH = 1.26;
  expect(rainPanel(b, LONDON)?.hours[0]).toMatchObject({
    mm: 1.3,
    word: 'Moderate',
  });
});

test('no ride hours keeps the summary chip; hours without conditions are skipped', () => {
  expect(rainPanel(ride([], { rideHours: undefined }), LONDON)).toBeNull();
  const gap = ride([
    [10, 0],
    [50, 1],
  ]);
  gap.rideHours = [
    { start: gap.departureAt, end: gap.finishAt, conditions: null },
    ...(gap.rideHours ?? []),
  ];
  expect(rainPanel(gap, LONDON)?.hours).toHaveLength(2);
});
