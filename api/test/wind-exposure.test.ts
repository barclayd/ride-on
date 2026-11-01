import { expect, test } from 'bun:test';
import { conditionsSchema } from '../src/recommendations/conditions.ts';
import {
  orderDepartures,
  recommendRides,
  requiredWeatherFor,
} from '../src/recommendations/engine.ts';
import {
  windAssistanceBenefit,
  windExposure,
} from '../src/recommendations/wind-comfort.ts';
import {
  type HistoryAssessment,
  prepareHistory,
} from '../src/rides/overlap.ts';
import type { Route } from '../src/routes/model.ts';
import { skyConditions as sky } from '../src/weather/conditions.ts';
import {
  forecastsFor,
  inputFor,
  makeRoute,
  present,
} from './fixtures/rides.ts';

const mph = 1.609344;
const now = Date.parse('2026-10-14T12:00:00Z');
const preferences = {
  temperature: { comfortMinC: 16, comfortMaxC: 32 },
  wind: {
    preferTailwind: true,
    comfortableHeadwindKph: 16,
    comfortableCrosswindKph: 16,
    comfortableGustKph: 25,
    crosswindSensitivity: 5,
  },
  weights: {
    temperature: 0.15,
    wind: 0.4,
    dryness: 0.2,
    sunshine: 0.25,
    clearSkies: 0,
  },
};

// Deliberately synthetic geometry, with exact distance shares and one weather
// location. These are preference comparisons, not replays of the real routes.
const routeFor = async (bearing: (index: number) => number, km = 40) => {
  const route = await makeRoute();
  const leg = present(route.legs[0]);
  return {
    ...route,
    distanceM: km * 1000,
    legs: Array.from({ length: 100 }, (_, i) => ({
      ...leg,
      bearingDegrees: bearing(i),
      fromM: i * km * 10,
      toM: (i + 1) * km * 10,
    })),
  };
};
type Weather = (
  quantity: string,
  localHour: number,
  route: Route,
) => number | null;
const constant: Weather = (q) => {
  if (q === 'air-temperature') return 12;
  if (q === 'sky-condition') return sky.sunny;
  if (q === 'wind-from-direction') return 180;
  if (q === 'wind-speed') return (10 * mph) / 3.6;
  if (q === 'wind-gust') return (27 * mph) / 3.6;
  return 0;
};
const evaluate = (
  routes: Route[],
  weather = constant,
  overrides = {},
  history?: HistoryAssessment,
) => {
  const input = inputFor(routes, {
    date: '2026-10-17',
    preferences,
    riding: { window: { start: '08:00', end: '17:00' } },
    ...overrides,
  });
  const shift = (at: string) =>
    new Date(Date.parse(at) + 7 * 86_400_000).toISOString();
  const forecasts = forecastsFor(
    routes,
    (q, h, route) => weather(q, h + 1, route),
    requiredWeatherFor(input),
  ).map((result) => {
    if (result.status === 'unavailable') return result;
    return {
      ...result,
      series: result.series.map((series) => ({
        ...series,
        samples: series.samples.map((sample) => ({
          ...sample,
          validAt: shift(sample.validAt),
          time:
            sample.time.kind === 'instant'
              ? { ...sample.time, at: shift(sample.time.at) }
              : {
                  ...sample.time,
                  range: {
                    start: shift(sample.time.range.start),
                    end: shift(sample.time.range.end),
                  },
                },
        })),
      })),
    };
  });
  return recommendRides(
    routes,
    input,
    forecasts,
    now,
    undefined,
    undefined,
    history,
  );
};
const best = (route: Route, weather = constant, overrides = {}) =>
  present(evaluate([route], weather, overrides).rankings[0]?.best ?? undefined);

test('useful sustained tailwind beats calm, including ties at the 100-point ceiling', async () => {
  const tail = await routeFor(() => 0);
  const calm = await routeFor(() => 0);
  for (const temperature of [12, 20]) {
    const result = evaluate([calm, tail], (q, h, route) => {
      if (q === 'air-temperature') return temperature;
      if (route.id === calm.id && (q === 'wind-speed' || q === 'wind-gust'))
        return (3 * mph) / 3.6;
      return constant(q, h, route);
    });
    expect(result.recommendedRouteId).toBe(tail.id);
    const a = present(result.rankings[0]?.best ?? undefined);
    const b = present(result.rankings[1]?.best ?? undefined);
    expect(a.windAssistance.potentialPoints).toBe(4);
    if (temperature === 20) {
      expect(a.score).toBe(100);
      expect(b.score).toBe(100);
      expect(a.windAssistance.appliedPoints).toBe(0);
      expect(orderDepartures(a, b)).toBeLessThan(0);
    } else expect(a.score).toBeGreaterThan(b.score);
  }
});

test('no preference and explicit opt-out give no tailwind bonus or ceiling tie-break', async () => {
  const tail = await routeFor(() => 0);
  const calm = await routeFor(() => 0);
  const { preferTailwind: _choice, ...legacyWind } = preferences.wind;
  for (const temperature of [12, 20]) {
    const weather: Weather = (q, h, route) => {
      if (q === 'air-temperature') return temperature;
      if (route.id === calm.id && (q === 'wind-speed' || q === 'wind-gust'))
        return (3 * mph) / 3.6;
      return constant(q, h, route);
    };
    for (const wind of [legacyWind, { ...legacyWind, preferTailwind: false }]) {
      const result = evaluate([tail, calm], weather, {
        preferences: { ...preferences, wind },
      });
      const assisted = present(
        result.rankings.find((r) => r.routeId === tail.id)?.best ?? undefined,
      );
      const still = present(
        result.rankings.find((r) => r.routeId === calm.id)?.best ?? undefined,
      );
      expect(assisted.windAssistance).toEqual({
        usefulDistanceFraction: 1,
        potentialPoints: 0,
        appliedPoints: 0,
      });
      expect(assisted.score).toBe(still.score);
      expect(orderDepartures(assisted, still)).toBe(0);
    }
  }
});

test('tailwind preference changes only assistance, retaining discomfort and raw gust limits', async () => {
  const route = await routeFor((i) => (i < 80 ? 40 : 180));
  const on = best(route, constant, {
    preferences: { ...preferences, minimumStandards: { maximumGustKph: 35 } },
  });
  const off = best(route, constant, {
    preferences: {
      ...preferences,
      wind: { ...preferences.wind, preferTailwind: false },
      minimumStandards: { maximumGustKph: 35 },
    },
  });
  expect(on.conditions).toEqual(off.conditions);
  expect(on.factors).toEqual(off.factors);
  expect(on.standards).toEqual(off.standards);
  expect(off.standards.status).toBe('below');
  expect(on.score - off.score).toBeCloseTo(on.windAssistance.appliedPoints, 2);
  expect(on.windAssistance.appliedPoints).toBeGreaterThan(0);
  expect(off.windAssistance.potentialPoints).toBe(0);
  expect(off.windAssistance.appliedPoints).toBe(0);
});

test('aligned gusts add neither discomfort nor assistance; raw gust limits still apply', async () => {
  const tail = await routeFor(() => 0);
  let score: number | undefined;
  for (const gustMph of [18, 27, 45]) {
    const ride = best(
      tail,
      (q, h, r) =>
        q === 'wind-gust' ? (gustMph * mph) / 3.6 : constant(q, h, r),
      {
        preferences: {
          ...preferences,
          minimumStandards: { maximumGustKph: 55 },
        },
      },
    );
    expect(ride.score).toBe(score ?? ride.score);
    score = ride.score;
    expect(ride.conditions.maximumGustKph).toBeCloseTo(gustMph * mph, 2);
    expect(ride.conditions.gustExposure).toEqual({
      directionBasis: 'prevailing-wind-estimate',
      maximumAdverseKph: 0,
    });
    expect(ride.drawbacks.some((d) => d.includes('gust'))).toBe(false);
    expect(ride.standards.status).toBe(gustMph === 45 ? 'below' : 'meets');
  }
});

test('crosswind and headwind gusts matter, including lateral gusts on an oblique tailwind', async () => {
  for (const bearing of [90, 180, 30]) {
    const route = await routeFor(() => bearing);
    const mild = best(route, (q, h, r) =>
      q === 'wind-gust' ? (12 * mph) / 3.6 : constant(q, h, r),
    );
    const strong = best(route, (q, h, r) =>
      q === 'wind-gust' ? (40 * mph) / 3.6 : constant(q, h, r),
    );
    expect(strong.score).toBeLessThan(mild.score);
    expect(strong.conditions.gustExposure?.maximumAdverseKph).toBeGreaterThan(
      25,
    );
    expect(
      strong.drawbacks.some((d) => d.includes('prevailing wind direction')),
    ).toBe(true);
  }
});

test('diagonal assistance keeps its forward benefit and its separate sideways discomfort', () => {
  const aligned = windExposure(-10, 0, 30, preferences.wind);
  const diagonal = windExposure(-10, 10, 30, preferences.wind);
  const gustier = windExposure(-10, 10, 50, preferences.wind);
  expect(diagonal.assistance).toBeGreaterThan(0);
  expect(diagonal.assistance).toBe(aligned.assistance);
  expect(diagonal.comfort).toBeLessThan(aligned.comfort);
  expect(gustier.assistance).toBe(diagonal.assistance);
  expect(gustier.comfort).toBeLessThan(diagonal.comfort);
  // A predominantly sideways wind with only a weak forward component should
  // not become useful assistance just because it has a tailwind component.
  expect(windExposure(-4, 16, 30, preferences.wind).assistance).toBe(0);
});

test('a winding route earns proportional diagonal assistance without hiding adverse exposure', async () => {
  // Synthetic headings: 60% diagonal tailwind, 20% weaker diagonal tailwind,
  // 10% crosswind and 10% headwind. Its mean assistance is below one half.
  const winding = await routeFor((i) =>
    i < 60 ? 50 : i < 80 ? 60 : i < 90 ? 90 : 180,
  );
  const tail = await routeFor(() => 0);
  const cross = await routeFor(() => 90);
  const ride = best(winding);
  expect(ride.windAssistance.usefulDistanceFraction).toBeCloseTo(0.8, 2);
  expect(ride.windAssistance.appliedPoints).toBeGreaterThan(1);
  expect(ride.windAssistance.potentialPoints).toBeLessThan(2);
  expect(ride.score).toBeLessThan(best(tail).score);
  expect(ride.score).toBeGreaterThan(best(cross).score);
  expect(ride.factors.wind).toBeLessThan(best(tail).factors.wind);
  expect(best(cross).windAssistance.potentialPoints).toBe(0);
});

test('90% assistance tolerates a brief crosswind; 60% tailwind / 40% headwind loses to calm', async () => {
  const tail = await routeFor(() => 0);
  const brief = await routeFor((i) => (i < 90 ? 0 : 90));
  const mixed = await routeFor((i) => (i < 60 ? 0 : 180));
  const calm = await routeFor(() => 0);
  const weather: Weather = (q, h, r) => {
    if (q === 'wind-gust') return ((r.id === calm.id ? 3 : 10) * mph) / 3.6;
    if (q === 'wind-speed' && r.id === calm.id) return (3 * mph) / 3.6;
    return constant(q, h, r);
  };
  const a = best(tail, weather);
  const b = best(brief, weather);
  expect(a.score - b.score).toBeLessThan(2);
  expect(b.score).toBeGreaterThan(best(calm, weather).score);
  expect(best(mixed, weather).score).toBeLessThan(best(calm, weather).score);
});

test('exposure weighting is independent of segmentation, and tiny gust sections have tiny influence', async () => {
  const base = await routeFor((i) => (i === 0 ? 90 : 0));
  const subdivided = {
    ...base,
    legs: base.legs.flatMap((leg) =>
      Array.from({ length: 10 }, (_, i) => ({
        ...leg,
        fromM: leg.fromM + ((leg.toM - leg.fromM) * i) / 10,
        toM: leg.fromM + ((leg.toM - leg.fromM) * (i + 1)) / 10,
      })),
    ),
  };
  const whole = await routeFor(() => 0);
  expect(best(base).score).toBe(best(subdivided).score);
  expect(best(whole).score - best(base).score).toBeLessThan(0.5);
});

test('assistance saturates, respects zero wind weight and is not inferred from unknown weather', async () => {
  const tail = await routeFor(() => 0);
  const faster = best(tail, (q, h, r) =>
    q === 'wind-speed' ? (35 * mph) / 3.6 : constant(q, h, r),
  );
  expect(faster.windAssistance).toEqual(best(tail).windAssistance);
  const ignored = best(tail, constant, {
    preferences: {
      ...preferences,
      weights: { ...preferences.weights, wind: 0 },
    },
  });
  expect(ignored.windAssistance.potentialPoints).toBe(0);
  expect(ignored.windAssistance.appliedPoints).toBe(0);
  const missing = evaluate([tail], (q, h, r) =>
    q === 'wind-from-direction' ? null : constant(q, h, r),
  );
  expect(missing.rankings).toHaveLength(0);
  const stillGusty = best(tail, (q, h, r) =>
    q === 'wind-speed' ? 0 : constant(q, h, r),
  );
  expect(stillGusty.conditions.gustExposure?.maximumAdverseKph).toBeCloseTo(
    27 * mph,
    2,
  );
  expect(stillGusty.windAssistance.potentialPoints).toBe(0);
});

test('the interview still prefers 8°C continuous sunshine to 12°C sunny intervals', async () => {
  const sunny = await routeFor(() => 0);
  const intervals = await routeFor(() => 0);
  const result = evaluate([intervals, sunny], (q, h, r) => {
    if (q === 'air-temperature') return r.id === sunny.id ? 8 : 12;
    if (q === 'sky-condition')
      return r.id === sunny.id ? sky.sunny : sky.sunnyIntervals;
    return constant(q, h, r);
  });
  expect(result.recommendedRouteId).toBe(sunny.id);
});

test('weak-breeze thresholds cannot suddenly unlock assistance from the rest of the route', () => {
  const bonus = (weakKph: number) => {
    const weak = windExposure(-weakKph, 0, 20, preferences.wind);
    // Half the route has useful assistance; half is near the light-breeze threshold.
    return 40 * windAssistanceBenefit((1 + weak.assistance) / 2);
  };
  expect(bonus(5.01) - bonus(4.99)).toBeLessThan(0.01);
});

test('assistance explanation accounts for the final score floor after history deductions', async () => {
  const route = await routeFor(() => 0);
  const at = new Date(now).toISOString();
  const history = prepareHistory(
    [route],
    { mode: 'neutral', lookbackDays: 28 },
    null,
    at,
    at,
  );
  const evidence = history.assess(route.id, at);
  const result = evaluate(
    [route],
    (q, h, r) => {
      if (q === 'probability') return 1;
      if (q === 'precipitation-rate') return 2;
      return constant(q, h, r);
    },
    {
      preferences: {
        ...preferences,
        weights: {
          temperature: 0,
          sunshine: 0,
          clearSkies: 0,
          wind: 0.01,
          dryness: 0.99,
        },
      },
    },
    {
      ...history,
      assess: () => ({ ...evidence, status: 'assessed', penaltyPoints: 10 }),
    },
  );
  const ride = present(result.rankings[0]?.best ?? undefined);
  expect(ride.score).toBe(0);
  expect(ride.windAssistance.potentialPoints).toBeGreaterThan(0);
  expect(ride.windAssistance.appliedPoints).toBe(0);
});

test('new gust evidence survives saved condition parsing; historical conditions need no inferred direction', async () => {
  const ride = best(await routeFor(() => 0));
  expect(conditionsSchema.parse(ride.conditions).gustExposure).toEqual(
    ride.conditions.gustExposure,
  );
  const { gustExposure: _omitted, ...historical } = ride.conditions;
  expect(conditionsSchema.parse(historical).gustExposure).toBeUndefined();
});

// Hourly shapes transcribed from the supplied town screenshots (6am–5pm).
// Spatial weather is held constant; route headings are synthetic. Exact live
// route scores and the global best half-hour cannot be inferred from screenshots.
const townWeather = (town: 'horsham' | 'richmond'): Weather => {
  const temperatures =
    town === 'horsham'
      ? [6, 6, 6, 7, 9, 11, 12, 13, 13, 13, 13, 12]
      : [7, 7, 7, 8, 9, 11, 12, 13, 13, 14, 13, 13];
  const winds =
    town === 'horsham'
      ? [6, 6, 6, 7, 9, 10, 10, 11, 11, 11, 10, 10]
      : [5, 4, 4, 5, 6, 7, 7, 8, 9, 9, 9, 8];
  const gusts =
    town === 'horsham'
      ? [16, 17, 18, 22, 24, 27, 27, 27, 27, 28, 26, 24]
      : [16, 17, 18, 19, 23, 27, 28, 28, 28, 28, 28, 26];
  return (q, hour) => {
    const index = Math.max(0, Math.min(11, hour - 6));
    if (q === 'air-temperature') return temperatures[index] ?? 0;
    if (q === 'wind-speed') return ((winds[index] ?? 0) * mph) / 3.6;
    if (q === 'wind-gust') return ((gusts[index] ?? 0) * mph) / 3.6;
    if (q === 'wind-from-direction') return 180;
    if (q === 'sky-condition')
      return hour <= 10 ? sky.sunny : sky.sunnyIntervals;
    // Use 4% as one explicit synthetic value for the screenshot's <5% band.
    if (q === 'probability')
      return town === 'horsham'
        ? hour < 14
          ? 0.04
          : hour < 15
            ? 0.1
            : 0.2
        : hour < 13
          ? 0.04
          : hour === 13
            ? 0.1
            : hour === 14
              ? 0.2
              : 0.3;
    return 0;
  };
};
test('whole-ride examples favour Horsham at 10 over 8/noon, and Richmond at 8:30 over 10', async () => {
  const horsham = await routeFor(() => 0, 89);
  const richmond = await routeFor((i) => Math.floor(i / 25) * 90, 35);
  // Evaluate exactly one requested departure by taking its candidate, not the
  // optimizer's best later slot.
  const fixed = (route: Route, town: 'horsham' | 'richmond', start: string) => {
    const duration = (route.distanceM / 20 / 1000) * 60;
    const [h = 0, m = 0] = start.split(':').map(Number);
    const endMinutes = Math.ceil(h * 60 + m + duration);
    return best(route, townWeather(town), {
      riding: {
        window: {
          start,
          end: `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`,
        },
      },
    });
  };
  const h8 = fixed(horsham, 'horsham', '08:00');
  const h10 = fixed(horsham, 'horsham', '10:00');
  const h12 = fixed(horsham, 'horsham', '12:00');
  const r830 = fixed(richmond, 'richmond', '08:30');
  const r10 = fixed(richmond, 'richmond', '10:00');
  expect(h10.score).toBeGreaterThan(h8.score);
  expect(h10.score).toBeGreaterThan(h12.score);
  expect(r830.score).toBeGreaterThan(r10.score);
  expect(h10.score).toBeGreaterThan(r830.score);
});
