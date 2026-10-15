import { expect, test } from 'bun:test';
import {
  orderDepartures,
  recommendRides,
  requiredWeatherFor,
} from '../src/recommendations/engine.ts';
import { mergeDays } from '../src/recommendations/multi-day.ts';
import {
  assessTailwindOpportunity,
  routeDirectionality,
} from '../src/recommendations/tailwind-opportunity.ts';
import { windExposure } from '../src/recommendations/wind-comfort.ts';
import type { Route } from '../src/routes/model.ts';
import { skyConditions as sky } from '../src/weather/conditions.ts';
import {
  forecastsFor,
  inputFor,
  makeRoute,
  now,
  present,
} from './fixtures/rides.ts';

const wind = {
  preferTailwind: true,
  prioritiseTailwindOpportunities: true,
  comfortableHeadwindKph: 16,
  comfortableCrosswindKph: 16,
  comfortableGustKph: 25,
  crosswindSensitivity: 5,
};
const preferences = {
  wind,
  temperature: { comfortMinC: 16, comfortMaxC: 32 },
  weights: {
    temperature: 0.15,
    wind: 0.4,
    dryness: 0.2,
    sunshine: 0.25,
    clearSkies: 0,
  },
};
const routeFor = async (heading: (i: number) => number) => {
  const r = await makeRoute();
  const leg = present(r.legs[0]);
  return {
    ...r,
    geometry: null,
    distanceM: 80_000,
    legs: Array.from({ length: 100 }, (_, i) => ({
      ...leg,
      fromM: i * 800,
      toM: (i + 1) * 800,
      bearingDegrees: heading(i),
    })),
  };
};
const exposure = (headwindKph: number, distanceM = 1) => ({
  headwindKph,
  distanceM,
  assistance: windExposure(headwindKph, 0, 20, wind).assistance,
});

test('one-way alignment earns at most five priority points; loops and out-and-backs cancel without needing full GPX', async () => {
  const line = await routeFor(() => 0);
  const loop = await routeFor((i) => Math.floor(i / 25) * 90);
  const outback = await routeFor((i) => (i < 50 ? 0 : 180));
  const winding = await routeFor((i) => (i % 2 ? 40 : 320));
  for (const r of [line, loop, outback, winding]) {
    const direction = routeDirectionality(r);
    expect(direction).toBe(r === line || r === winding ? 1 : 0);
    for (const speed of [0, 3, 5, 8, 16, 60, 150]) {
      const a = assessTailwindOpportunity(direction, [exposure(-speed)], wind);
      expect(a.priorityPoints).toBeGreaterThanOrEqual(0);
      expect(a.priorityPoints).toBeLessThanOrEqual(5);
      if (direction === 0 || speed <= 5) expect(a.priorityPoints).toBe(0);
      else if (speed >= 8) expect(a.priorityPoints).toBe(5);
    }
  }
  expect(
    assessTailwindOpportunity(1, [exposure(16)], wind).priorityPoints,
  ).toBe(0);
  expect(assessTailwindOpportunity(1, [], wind).priorityPoints).toBe(0);
});

test('majority assistance tolerates brief crosswind; minority assistance and significant headwinds do not qualify', () => {
  expect(
    assessTailwindOpportunity(1, [exposure(-16, 9), exposure(0, 1)], wind)
      .priorityPoints,
  ).toBe(4.5);
  for (const rows of [
    [exposure(-16, 4), exposure(0, 6)],
    [exposure(-16, 6), exposure(16, 4)],
  ])
    expect(assessTailwindOpportunity(1, rows, wind).priorityPoints).toBe(0);
  const base = [exposure(-16, 6), exposure(6, 1), exposure(0, 3)];
  const split = base.flatMap((row) =>
    Array.from({ length: 10 }, () => ({
      ...row,
      distanceM: row.distanceM / 10,
    })),
  );
  expect(assessTailwindOpportunity(1, base, wind)).toEqual(
    assessTailwindOpportunity(1, split, wind),
  );
  for (const threshold of [5, 6.5, 6.8, 8]) {
    const below = assessTailwindOpportunity(
      1,
      [exposure(-threshold + 0.001)],
      wind,
    );
    const above = assessTailwindOpportunity(
      1,
      [exposure(-threshold - 0.001)],
      wind,
    );
    expect(Math.abs(above.priorityPoints - below.priorityPoints)).toBeLessThan(
      0.03,
    );
  }
});

test('Calm disables opportunity while preserving the saved opt-in', () => {
  for (const p of [
    { ...wind, preferTailwind: false },
    { ...wind, prioritiseTailwindOpportunities: false },
  ]) {
    const result = assessTailwindOpportunity(1, [exposure(-16)], p);
    expect(result.enabled).toBe(false);
    expect(result.priorityPoints).toBe(0);
    expect(result.reason).toBeNull();
  }
});

const evaluate = (
  routes: Route[],
  weather: (q: string, h: number, r: Route, location: number) => number | null,
  extra: Record<string, unknown> = {},
) => {
  const input = inputFor(routes, {
    preferences,
    riding: { window: { start: '08:00', end: '12:00' } },
    ...extra,
  });
  return recommendRides(
    routes,
    input,
    forecastsFor(routes, weather, requiredWeatherFor(input)),
    now.getTime(),
  );
};
const mild = (q: string) =>
  q === 'air-temperature'
    ? 20
    : q === 'sky-condition'
      ? sky.sunny
      : q === 'wind-from-direction'
        ? 180
        : q === 'wind-speed' || q === 'wind-gust'
          ? 16 / 3.6
          : 0;

test('opportunity changes priority but never Conditions, factor losses, history, or comfort ceilings', async () => {
  const line = await routeFor(() => 0);
  const on = present(evaluate([line], mild).rankings[0]?.best ?? undefined);
  const off = present(
    evaluate([line], mild, {
      preferences: {
        ...preferences,
        wind: { ...wind, prioritiseTailwindOpportunities: false },
      },
    }).rankings[0]?.best ?? undefined,
  );
  for (const key of [
    'score',
    'baseScore',
    'weatherScore',
    'pointsLost',
    'factors',
    'conditions',
    'standards',
    'recentRides',
    'windAssistance',
  ] as const)
    expect(on[key]).toEqual(off[key]);
  expect(on.score).toBe(100);
  expect(on.recommendationPriority).toBe(105);
  expect(off.recommendationPriority).toBe(off.score);
  expect(on.tailwindOpportunity.reason).toBe(
    'Favourable tailwind opportunity.',
  );
  const zeroWeight = present(
    evaluate([line], mild, {
      preferences: {
        ...preferences,
        weights: { ...preferences.weights, wind: 0 },
      },
    }).rankings[0]?.best ?? undefined,
  );
  expect(zeroWeight.tailwindOpportunity.priorityPoints).toBe(5);
});

test('interview: full sunshine beats all-intervals assistance; mostly sunny assistance narrowly beats sunny calm', async () => {
  const tail = await routeFor((i) => (i < 90 ? 0 : 90));
  // At 20 km/h the first 60 km are exactly three hours. Use spatial samples
  // so the hourly nearest-symbol rule cannot shift the sunshine boundary.
  tail.legs = tail.legs.map((leg, i) => ({
    ...leg,
    weatherLocationId: present(tail.weatherLocations[i < 75 ? 0 : 1]).id,
  }));
  const calm = await routeFor(() => 0);
  for (const sunnyHours of [0, 3]) {
    const result = evaluate([tail, calm], (q, _h, r, location) => {
      if (r.id === calm.id && (q === 'wind-speed' || q === 'wind-gust'))
        return (3 * 1.609344) / 3.6;
      if (q === 'sky-condition' && r.id === tail.id)
        return sunnyHours === 3 && location === 0
          ? sky.sunny
          : sky.sunnyIntervals;
      return mild(q);
    });
    expect(result.recommendedRouteId).toBe(
      sunnyHours === 0 ? calm.id : tail.id,
    );
    const assisted = present(
      result.rankings.find((r) => r.routeId === tail.id)?.best ?? undefined,
    );
    const still = present(
      result.rankings.find((r) => r.routeId === calm.id)?.best ?? undefined,
    );
    if (sunnyHours === 3) {
      expect(Math.abs(assisted.score - still.score)).toBeLessThan(2);
      expect(
        assisted.recommendationPriority - still.recommendationPriority,
      ).toBeGreaterThan(3);
    }
  }
});

test('72 with opportunity can beat 75, never 82; shared daily ordering retains standards first', async () => {
  const r = await routeFor((i) => (i < 90 ? 0 : 90));
  const candidate = present(evaluate([r], mild).rankings[0]?.best ?? undefined);
  const assisted = {
    ...candidate,
    score: 72,
    recommendationPriority: 72 + candidate.tailwindOpportunity.priorityPoints,
  };
  const calm = { ...candidate, score: 75, recommendationPriority: 75 };
  expect(orderDepartures(assisted, calm)).toBeLessThan(0);
  expect(
    orderDepartures(assisted, {
      ...calm,
      score: 82,
      recommendationPriority: 82,
    }),
  ).toBeGreaterThan(0);
  expect(
    orderDepartures(
      { ...assisted, standards: { ...assisted.standards, status: 'below' } },
      { ...calm, standards: { ...calm.standards, status: 'meets' } },
    ),
  ).toBeGreaterThan(0);
  const base = evaluate([r], mild);
  const ranked = present(base.rankings[0]);
  const days = [assisted, calm].map((best) => ({
    ...base,
    rankings: [{ ...ranked, best, alternatives: [] }],
  }));
  expect(mergeDays(days, false).rankings[0]?.best?.recommendationPriority).toBe(
    76.5,
  );
});

test('unknown weather and missing elevation stay unranked', async () => {
  const route = await routeFor(() => 0);
  expect(
    evaluate([route], (q) => (q === 'wind-from-direction' ? null : mild(q)))
      .rankings,
  ).toHaveLength(0);
  const partial = evaluate([{ ...route, ascentM: null }], mild, {
    preferences: { ...preferences, climbing: { preference: 'hillier' } },
  });
  expect(partial.rankings).toHaveLength(0);
  expect(
    partial.unranked[0]?.partialAssessment?.recommendationPriority,
  ).toBeNull();
  expect(
    partial.unranked[0]?.partialAssessment?.tailwindOpportunity,
  ).toBeNull();
});
