import { expect, test } from 'bun:test';
import type {
  Conditions,
  Departure,
  Outline,
  Preferences,
  WindStretch,
} from '../lib/types';
import { METRIC } from '../ui/format';
import { compass, SKETCH, windPanel, windSketch } from '../ui/wind';

const C = (more: Partial<Conditions> = {}): Conditions => ({
  temperatureC: { minimum: 10, maximum: 14 },
  averageWindSpeedKph: 15,
  averageHeadwindKph: 2,
  averageTailwindKph: 10,
  averageCrosswindKph: 3,
  maximumPrecipitationProbability: 0,
  ...more,
});
const against = (kph: number): Conditions['gustExposure'] => ({
  directionBasis: 'prevailing-wind-estimate',
  maximumAdverseKph: kph,
});
const ride = (more: Partial<Departure> = {}): Departure => ({
  date: '2026-10-17',
  departureAt: '2026-10-17T08:30:00Z',
  finishAt: '2026-10-17T11:30:00Z',
  score: 80,
  standards: { status: 'meets', failures: [] },
  conditions: C(),
  ...more,
});
const at = (hhmm: string) => `2026-10-17T${hhmm}:00Z`;
const comfort = (kph: number, more: Partial<Preferences> = {}) => ({
  wind: {
    comfortableHeadwindKph: 15,
    comfortableCrosswindKph: 20,
    comfortableGustKph: kph,
  },
  ...more,
});
const stretch = (
  fromM: number,
  toM: number,
  effect: WindStretch['effect'],
  windFromDegrees: number | null,
  more: Partial<WindStretch> = {},
): WindStretch => ({
  fromM,
  toM,
  startAt: at('08:30'),
  endAt: at('09:30'),
  effect,
  windFromDegrees,
  averageWindSpeedKph: 18,
  maximumAdverseGustKph: 10,
  ...more,
});

test('compass points round to the nearest of eight', () => {
  expect([0, 22, 23, 225, 250, 300, 338, -45, 405].map(compass)).toEqual([
    'N',
    'N',
    'NE',
    'SW',
    'W',
    'NW',
    'N',
    'NW',
    'NE',
  ]);
});

// Before the API sends stretches: one block per ride hour, its main effect and where the wind comes from.
const hourly = ride({
  conditions: C({ maximumGustKph: 45, gustExposure: against(40) }),
  rideHours: [
    {
      start: at('08:30'),
      end: at('09:30'),
      conditions: C({
        distanceKm: 20,
        windFromDegrees: 225,
        windDistanceFractions: { tailwind: 0.8, crosswind: 0.2, headwind: 0 },
        gustExposure: against(20),
      }),
    },
    {
      start: at('09:30'),
      end: at('10:30'),
      conditions: C({
        distanceKm: 20,
        windFromDegrees: 270,
        windDistanceFractions: { tailwind: 0, crosswind: 1, headwind: 0 },
        gustExposure: against(25),
      }),
    },
    { start: at('10:15'), end: at('10:30'), conditions: null },
    {
      start: at('10:30'),
      end: at('11:30'),
      conditions: C({
        distanceKm: 20,
        windFromDegrees: 270,
        windDistanceFractions: { tailwind: 0, crosswind: 0.1, headwind: 0.9 },
        gustExposure: against(40),
      }),
    },
  ],
});

test('ride hours make the bar, the legend and the gusts until stretches arrive', () => {
  const w = windPanel(hourly, null, 'UTC', METRIC, comfort(35));
  expect(w.blocks.map(({ effect, label }) => [effect, label])).toEqual([
    ['tailwind', 'SW'],
    ['crosswind', 'W'],
    ['headwind', 'W'],
  ]);
  expect(w.blocks.reduce((sum, b) => sum + b.share, 0)).toBeCloseTo(1);
  // Each effect's share of the distance, hours mixing them: ~43%, 30% and 27%.
  expect(w.legend).toEqual([
    { effect: 'crosswind', name: 'Crosswind', speed: '15 km/h', share: '~45%' },
    { effect: 'headwind', name: 'Headwind', speed: '15 km/h', share: '~30%' },
    { effect: 'tailwind', name: 'Tailwind', speed: '15 km/h', share: '~25%' },
  ]);
  // Only the last hour's gusts pass comfort, so the row says where and when.
  expect(w.gusts).toEqual({
    warn: true,
    title: 'Gusts up to 45 km/h',
    text: 'Into your face late in the ride, 10:30–11:30. Over your 35 km/h comfort.',
  });
  expect(w.sketch).toBeNull();
});

test('neighbouring hours with the same effect and direction share a block', () => {
  const [first, second] = hourly.rideHours ?? [];
  const w = windPanel(
    ride({ rideHours: [first, { ...first, start: second.start }] }),
    null,
    'UTC',
  );
  expect(w.blocks).toEqual([{ effect: 'tailwind', share: 1, label: 'SW' }]);
});

test('gusts that help read neutral; gusts against you or past the limit read amber', () => {
  const behind = ride({
    conditions: C({
      maximumGustKph: 48,
      gustExposure: against(12),
      windDistanceFractions: { tailwind: 0.7, crosswind: 0.2, headwind: 0.1 },
    }),
  });
  const w = windPanel(behind, null, 'UTC', METRIC, comfort(35));
  expect(w.gusts).toEqual({
    warn: false,
    title: 'Gusts up to 48 km/h',
    text: 'Mostly behind you, so they help. At most 12 km/h against you.',
  });
  expect(w.legend.map((l) => l.share)).toEqual(['~70%', '~20%', '~10%']);
  // No direction from the API: no compass letter in the bar.
  expect(w.blocks).toEqual([{ effect: 'tailwind', share: 1, label: '' }]);
  // Past the hard limit, even when little of it is against the rider.
  expect(
    windPanel(
      behind,
      null,
      'UTC',
      METRIC,
      comfort(35, { minimumStandards: { maximumGustKph: 40 } }),
    ).gusts,
  ).toEqual({
    warn: true,
    title: 'Gusts up to 48 km/h',
    text: 'Up to 12 km/h against you. Over your 40 km/h limit.',
  });
  // No exposure estimate: the peak itself is held to comfort.
  const calm = ride({
    conditions: C({ maximumGustKph: 30, averageTailwindKph: 0 }),
  });
  expect(windPanel(calm, null, 'UTC', METRIC, comfort(35)).gusts?.text).toBe(
    'Within your 35 km/h comfort.',
  );
  expect(windPanel(ride(), null, 'UTC').gusts).toBeNull();
});

// An out-and-back due north and home again, the wind from the south: behind on the way out.
const outAndBack: Outline = {
  version: 1,
  points: [
    [51.0, -0.3, 0],
    [51.05, -0.3, 5560],
    [51.1, -0.3, 11120],
    [51.05, -0.3, 16680],
    [51.0, -0.3, 22240],
  ],
};
const outAndBackWind = [
  stretch(0, 11120, 'tailwind', 180),
  stretch(11120, 11400, 'crosswind', 200), // a sliver: too short to label, still drawn
  stretch(11400, 22240, 'headwind', 180, {
    startAt: at('10:00'),
    endAt: at('11:00'),
    maximumAdverseGustKph: 41,
  }),
];

test('wind stretches place each effect exactly and say on which leg the gusts are', () => {
  const b = ride({
    conditions: C({ maximumGustKph: 41, gustExposure: against(41) }),
    windStretches: outAndBackWind,
  });
  const w = windPanel(b, outAndBack, 'UTC', METRIC, comfort(35));
  expect(w.blocks.map(({ effect, label }) => [effect, label])).toEqual([
    ['tailwind', 'S'],
    ['crosswind', ''],
    ['headwind', 'S'],
  ]);
  expect(w.legend.map((l) => [l.name, l.speed, l.share])).toEqual([
    ['Tailwind', '18 km/h', '~50%'],
    ['Headwind', '18 km/h', '~50%'],
    ['Crosswind', '18 km/h', '<5%'],
  ]);
  expect(w.gusts?.text).toBe(
    'Into your face on the way back, 10:00–11:00. Over your 35 km/h comfort.',
  );
  expect(w.sketch).not.toBeNull();
  // No outline, or no stretches: no sketch.
  expect(windPanel(b, null, 'UTC').sketch).toBeNull();
  expect(
    windPanel({ ...b, windStretches: [] }, outAndBack, 'UTC').sketch,
  ).toBeNull();
});

test('gusts split by a short calmer stretch still read as one place', () => {
  const b = ride({
    conditions: C({ maximumGustKph: 44, gustExposure: against(44) }),
    windStretches: [
      stretch(0, 11120, 'tailwind', 180),
      stretch(11120, 16000, 'headwind', 180, {
        startAt: at('10:00'),
        maximumAdverseGustKph: 41,
      }),
      stretch(16000, 16500, 'crosswind', 250, { maximumAdverseGustKph: 20 }),
      stretch(16500, 22240, 'headwind', 180, {
        endAt: at('11:00'),
        maximumAdverseGustKph: 44,
      }),
    ],
  });
  expect(windPanel(b, outAndBack, 'UTC', METRIC, comfort(35)).gusts?.text).toBe(
    'Into your face on the way back, 10:00–11:00. Over your 35 km/h comfort.',
  );
});

test('a thousand short stretches all keep their colour', () => {
  const many = Array.from({ length: 1000 }, (_, i) =>
    stretch(
      (i * 22240) / 1000,
      ((i + 1) * 22240) / 1000,
      i % 2 ? 'headwind' : 'tailwind',
      180,
    ),
  );
  const s = windSketch(outAndBack, many, ride());
  expect(s?.runs).toHaveLength(1000);
  expect(s?.sentence.split(', then ').length).toBeLessThanOrEqual(4);
  const w = windPanel(ride({ windStretches: many }), outAndBack, 'UTC');
  expect(w.blocks).toHaveLength(1000);
  expect(w.blocks.every((b) => b.label === '')).toBe(true);
});

test('light wind gets its own row, and one effect reads throughout', () => {
  const w = windPanel(
    ride({
      windStretches: [
        stretch(0, 10000, 'light', 90, { averageWindSpeedKph: 6 }),
      ],
    }),
    null,
    'UTC',
  );
  expect(w.blocks).toEqual([{ effect: 'light', share: 1, label: '' }]);
  expect(w.legend).toEqual([
    {
      effect: 'light',
      name: 'Light wind',
      speed: 'under 10 km/h',
      share: 'Throughout',
    },
  ]);
});

const parse = (points: string) =>
  points.split(' ').map((p) => p.split(',').map(Number));

test('the sketch fits right of the wind key, draws the return beside the way out and reads aloud', () => {
  const s = windSketch(outAndBack, outAndBackWind, ride());
  if (!s) throw new Error('no sketch');
  const casing = parse(s.casing);
  for (const [x, y] of casing) {
    expect(x).toBeGreaterThanOrEqual(72);
    expect(x).toBeLessThanOrEqual(220);
    expect(y).toBeGreaterThanOrEqual(10);
    expect(y).toBeLessThanOrEqual(86);
  }
  // The way back sits 3px beside the way out instead of on top of it.
  expect(casing[3][0]).toBeCloseTo(casing[1][0] - 3);
  expect(casing[3][1]).toBeCloseTo(casing[1][1]);
  // The sliver keeps its own colour.
  expect(s.runs.map((r) => r.effect)).toEqual([
    'tailwind',
    'crosswind',
    'headwind',
  ]);
  // The hover pointer starts on the start dot facing north, up the page, and comes back south.
  expect(s.track).toHaveLength(201);
  expect(s.track[0]).toMatchObject({ x: s.start.x, y: s.start.y, angle: -90 });
  expect(Math.abs(s.track[150].angle - 90)).toBeLessThan(5);
  // Back where it started: a start dot, no finish.
  expect(s.finish).toBeNull();
  expect(s.start.label.text).toBe('Start');
  // The wind from the south blows up the compass, from its tail dot at the bottom.
  expect(s.wind.lines).toEqual(['From S']);
  expect(s.wind.speed).toBe('15 km/h');
  expect(s.wind.arrow).toEqual({
    x1: 32,
    y1: 32.5,
    x2: 32,
    y2: 15.5,
    angle: -90,
  });
  expect(s.sentence).toBe(
    'Heads north with the wind behind, then south into the wind. Wind from the south.',
  );
});

test('a one-way ride gets a finish, labels clear of the wind key, and the wind turning', () => {
  const oneWay: Outline = {
    version: 1,
    points: [
      [51.0, -0.5, 0],
      [51.05, -0.4, 8000],
      [51.1, -0.3, 16000],
    ],
  };
  const s = windSketch(
    oneWay,
    [stretch(0, 9000, 'tailwind', 225), stretch(9000, 16000, 'crosswind', 270)],
    ride({ finishAt: at('10:40') }),
  );
  if (!s) throw new Error('no sketch');
  // Two directions take two lines in the key's narrow column.
  expect(s.wind.lines).toEqual(['From SW', 'then W']);
  expect(s.finish?.label.text).toBe('Finish');
  // The start, bottom left, would sit on the route to its right, so it reads left, just clear of the key.
  expect(s.start.label).toMatchObject({ anchor: 'end', x: s.start.x - 8 });
  expect(s.start.label.x - 'Start'.length * 5.3).toBeGreaterThanOrEqual(62);
  // The finish, top right, has the route to its left and room to its right.
  expect(s.finish?.label).toMatchObject({
    anchor: 'start',
    x: (s.finish?.x ?? 0) + 8,
  });
  for (const l of [s.start.label, s.finish?.label])
    expect(l?.x).toBeLessThanOrEqual(SKETCH.width);
  expect(s.sentence).toBe(
    'Heads north-east with the wind behind, then north-east across the wind. Wind from the south-west, then west.',
  );
  // Calm all the way: no arrow, no direction.
  const calm = windSketch(
    oneWay,
    [stretch(0, 16000, 'light', null, { averageWindSpeedKph: 5 })],
    ride(),
  );
  expect(calm?.wind.lines).toEqual(['Light wind']);
  expect(calm?.wind.arrow).toBeNull();
  expect(calm?.runs).toEqual([{ effect: 'light', points: expect.any(String) }]);
});
