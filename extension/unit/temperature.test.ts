import { expect, test } from 'bun:test';
import type {
  Departure,
  TemperatureAlongRide,
  TemperaturePoint,
} from '../lib/types';
import { regionUnits } from '../ui/format';
import { temperaturePanel } from '../ui/temperature';

const USUAL: NonNullable<TemperatureAlongRide['usual']> = {
  month: 10,
  averageHighC: 15,
  averageLowC: 8,
  bandHalfWidthC: 2.5,
  differenceC: 1.8,
  method: 'monthly-diurnal-estimate',
  coveredDistanceFraction: 1,
  source: {
    attribution:
      'Contains Met Office data licensed under the Open Government Licence v3.0.',
  },
};
// Leaves 08:30 BST; the last point is the finish.
const ride = (
  points: TemperaturePoint[],
  more: Partial<TemperatureAlongRide> = {},
): Departure => {
  const start = Date.parse('2026-10-17T07:30:00Z');
  return {
    date: '2026-10-17',
    departureAt: new Date(start).toISOString(),
    finishAt: new Date(
      start + (points.at(-1)?.[0] ?? 0) * 60_000,
    ).toISOString(),
    score: 80,
    standards: { status: 'meets', failures: [] },
    conditions: {
      temperatureC: { minimum: 9, maximum: 18 },
      averageWindSpeedKph: 15,
      averageHeadwindKph: 2,
      averageTailwindKph: 10,
      averageCrosswindKph: 3,
      maximumPrecipitationProbability: 0,
    },
    temperatureAlongRide: {
      points,
      feelsLikeBasis: 'provider',
      usual: USUAL,
      ...more,
    },
  };
};
const range = (lo: number, hi: number) => ({
  temperature: { comfortMinC: lo, comfortMaxC: hi },
});
const LONDON = 'Europe/London';
// The design's Horsham ride (24a): cool to start, then in range.
const HORSHAM: TemperaturePoint[] = [
  [0, 9, 6, 10],
  [60, 12, 10, 12],
  [120, 14, 13, 13.5],
  [180, 16, 16, 14.5],
  [240, 18, 18, 15],
  [265, 18, 18, 15],
];

test('a ride that starts cool says until when, and draws both lines on the 0–25°C scale', () => {
  const t = temperaturePanel(ride(HORSHAM), LONDON, undefined, range(10, 20));
  expect(t).toMatchObject({
    warn: false,
    label:
      'Temperature 9–18°C, feels like 6–18°C. Show temperature along the ride',
    headline:
      'Feels cooler than your range (down to 6°C) until about 09:30, then in your range to the finish',
    tone: 'even',
    high: { y: 20, label: '20°' },
    low: { y: 60, label: '10°' },
    from: '08:30',
    to: '~12:55',
    range: 'Your range 10–20°C',
    mark: { x: 0, y: 76, label: 'feels 6°', cool: true },
  });
  expect(t?.air).toBe('M0 64 L22.64 52 L45.28 44 L67.92 36 L90.57 28 L100 28');
  expect(t?.feels?.startsWith('M0 76 L22.64 60')).toBe(true);
  // The start label sits above the line when feels like is below it; the finish is right-aligned.
  expect(t?.ends).toEqual([
    { x: 0, y: 64, label: '9°', above: true, end: false },
    { x: 100, y: 28, label: '18°', above: false, end: true },
  ]);
});

test('the usual temperature gives the band and the usual range, without the averages', () => {
  const t = temperaturePanel(ride(HORSHAM), LONDON, undefined, range(10, 20));
  // The chart shows how it compares with usual, so there's no headline or footnote for it.
  expect(t?.usual).toEqual({
    sub: 'Usual for 08:30–12:55 in October: 8–18°C',
    month: 'October',
    band: expect.any(String),
  });
  expect(t?.usual?.band.startsWith('M0 50 L22.64 42')).toBe(true);
  expect(t?.usual?.band.endsWith('L0 70 Z')).toBe(true);
});

test('fractional offsets from the API, as at the finish and the extremes, are fine', () => {
  const t = temperaturePanel(
    ride([
      [0, 9, 6, 10],
      [10, 9.2, 6.3, 10.1],
      [17.4, 9.1, 5.9, 10.2],
      [20, 9.4, 6.4, 10.3],
      [24.6, 9.6, 6.6, 10.3],
    ]),
    LONDON,
    undefined,
    range(5, 20),
  );
  expect(t).toMatchObject({
    headline: 'Feels in your range the whole ride',
    tone: 'even',
    label:
      'Temperature 9–10°C, feels like 6–7°C. Show temperature along the ride',
    to: '~08:54',
  });
  expect(t?.air.endsWith('L100 61.6')).toBe(true);
});

test('outside the climate grid there is no usual', () => {
  const points = HORSHAM.map(
    ([m, a, f]) => [m, a, f, null] as TemperaturePoint,
  );
  expect(
    temperaturePanel(
      ride(points, { usual: null }),
      LONDON,
      undefined,
      range(10, 20),
    )?.usual,
  ).toBeNull();
});

test('feeling warm the whole ride is amber, with the warmest point marked', () => {
  const t = temperaturePanel(
    ride([
      [0, 15, 15, 12],
      [60, 17, 18, 13],
      [120, 19, 20, 14],
      [180, 20, 22, 14],
      [190, 21, 22, 14],
    ]),
    LONDON,
    undefined,
    range(5, 15),
  );
  expect(t).toMatchObject({
    warn: true,
    headline: 'Feels warmer than your range the whole ride, 15–22°C',
    tone: 'warm',
    mark: { x: 94.74, label: 'feels 22°', cool: false },
  });
});

test('feeling cool the whole ride is the headline, in the cool tone', () => {
  const t = temperaturePanel(
    ride([
      [0, 11, 9, 12],
      [60, 12, 10, 13],
      [90, 12, 10, 13],
    ]),
    LONDON,
    undefined,
    range(12, 20),
  );
  expect(t).toMatchObject({
    headline: 'Feels cooler than your range the whole ride, 9–10°C',
    tone: 'cool',
  });
});

test('crossings under 10 minutes are ignored', () => {
  const t = temperaturePanel(
    ride([
      [0, 15, 15, 12],
      [30, 15, 15, 12],
      [33, 15, 9, 12],
      [36, 15, 15, 12],
      [60, 15, 15, 12],
    ]),
    LONDON,
    undefined,
    range(10, 20),
  );
  expect(t?.headline).toBe('Feels in your range the whole ride');
  expect(t?.mark).toBeNull();
});

test('three spells name each, with times to the nearest 10 minutes', () => {
  const t = temperaturePanel(
    ride([
      [0, 8, 6, 10],
      [47, 12, 12, 11],
      [120, 18, 18, 13],
      [184, 24, 24, 14],
      [200, 24, 24, 14],
    ]),
    LONDON,
    undefined,
    range(10, 20),
  );
  expect(t?.headline).toBe(
    'Feels cooler than your range (down to 6°C) until about 09:00, then in your range until about 10:50, then warmer than your range (up to 24°C) to the finish',
  );
});

test('without feels like it judges on air and drops the dashed line and the marker', () => {
  const points = HORSHAM.map(
    ([m, a, , u]) => [m, a, null, u] as TemperaturePoint,
  );
  const t = temperaturePanel(
    ride(points, { feelsLikeBasis: null }),
    LONDON,
    undefined,
    range(10, 20),
  );
  expect(t).toMatchObject({
    feels: null,
    mark: null,
    label: 'Temperature 9–18°C. Show temperature along the ride',
  });
  expect(
    t?.headline.startsWith('Feels cooler than your range (down to 9°C)'),
  ).toBe(true);
});

test('a gap in the air temperature breaks the line', () => {
  const t = temperaturePanel(
    ride([
      [0, 10, 10, 12],
      [10, null, null, 12],
      [20, 11, 11, 12],
      [30, 12, 12, 12],
    ]),
    LONDON,
    undefined,
    range(10, 20),
  );
  expect(t?.air).toBe('M0 60 M66.67 56 L100 52');
});

test('Fahrenheit labels, on the same Celsius scale', () => {
  const t = temperaturePanel(
    ride(HORSHAM),
    LONDON,
    regionUnits('en-US'),
    range(10, 20),
  );
  expect(t).toMatchObject({
    headline:
      'Feels cooler than your range (down to 43°F) until about 09:30, then in your range to the finish',
    high: { y: 20, label: '68°' },
    range: 'Your range 50–68°F',
    usual: { sub: 'Usual for 08:30–12:55 in October: 46–64°F' },
  });
});

test('no trace or no ideal range keeps the plain chip', () => {
  expect(
    temperaturePanel(
      { ...ride(HORSHAM), temperatureAlongRide: undefined },
      LONDON,
      undefined,
      range(10, 20),
    ),
  ).toBeNull();
  expect(temperaturePanel(ride(HORSHAM), LONDON)).toBeNull();
});
