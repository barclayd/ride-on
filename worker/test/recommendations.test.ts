import { describe, expect, test } from 'bun:test';
import {
  daylightWindow,
  planDepartures,
} from '../src/recommendations/daylight.ts';
import { recommendRides, sampleAt } from '../src/recommendations/engine.ts';
import { resolveMinimumTemperature } from '../src/recommendations/input.ts';
import type { Route } from '../src/routes/model.ts';

import {
  defaultValue,
  forecastsFor,
  inputFor,
  makeRoute,
  now,
  present,
} from './fixtures/rides.ts';

const hour = 3_600_000;

// The same data drives adapter-independent algorithm and HTTP tests.
describe('daylight and ride timing', () => {
  test('20 km/h default, whole ride inside daylight, future departures only', async () => {
    const route = await makeRoute();
    const input = inputFor([route]);
    const plan = planDepartures(route, input, now.getTime());
    expect(input.riding.averageSpeedKph).toBe(20);
    expect(plan.durationMs).toBeCloseTo((route.distanceM / 20) * 3600);
    expect(plan.departures.length).toBeGreaterThan(10);
    for (const start of plan.departures) {
      expect(start).toBeGreaterThanOrEqual(plan.daylight?.start ?? 0);
      expect(start + plan.durationMs).toBeLessThanOrEqual(
        plan.daylight?.end ?? 0,
      );
    }
    const later = planDepartures(
      route,
      input,
      Date.parse('2026-10-10T13:20:00Z'),
    );
    expect(later.departures[0]).toBe(Date.parse('2026-10-10T13:30:00Z'));
  });
  test('winter / summer and DST use the requested local day', async () => {
    const route = await makeRoute();
    for (const date of [
      '2026-03-29',
      '2026-10-25',
      '2026-06-21',
      '2026-12-21',
    ]) {
      const window = daylightWindow(route, date, 'Europe/London');
      expect(window).not.toBeNull();
      expect(new Date(window?.start ?? 0).toISOString().slice(0, 10)).toBe(
        date,
      );
    }
    const summer = daylightWindow(route, '2026-06-21', 'Europe/London');
    const winter = daylightWindow(route, '2026-12-21', 'Europe/London');
    expect((summer?.end ?? 0) - (summer?.start ?? 0)).toBeGreaterThan(
      (winter?.end ?? 0) - (winter?.start ?? 0),
    );
  });
  test('a ride too long for daylight has no departures', async () => {
    const route = await makeRoute({ distanceM: 400_000 });
    expect(
      planDepartures(route, inputFor([route]), now.getTime()).departures,
    ).toEqual([]);
  });
});

describe('weather aligned to ride progress', () => {
  test('native period boundaries and unavailable samples are respected', () => {
    const at = Date.parse('2026-10-10T10:00:00Z');
    const samples = [
      {
        validAt: '2026-10-10T10:00:00Z',
        value: 0.8,
        time: {
          kind: 'period' as const,
          aggregation: 'event' as const,
          range: { start: '2026-10-10T09:30:00Z', end: '2026-10-10T10:30:00Z' },
        },
      },
    ];
    expect(sampleAt(samples, at)).toBe(0.8);
    expect(sampleAt(samples, at + hour / 2)).toBeNull();
    expect(sampleAt([{ ...present(samples[0]), value: null }], at)).toBeNull();
  });
  test('dry / cool beats warm / wet under provisional weights', async () => {
    const dry = await makeRoute({ name: 'Dry' });
    const wet = await makeRoute({ name: 'Wet' });
    const result = recommendRides(
      [wet, dry],
      inputFor([wet, dry]),
      forecastsFor([wet, dry], (quantity, _h, route) =>
        quantity === 'air-temperature'
          ? route.id === wet.id
            ? 18
            : 13
          : quantity === 'probability'
            ? route.id === wet.id
              ? 0.8
              : 0
            : defaultValue(quantity),
      ),
      now.getTime(),
    );
    expect(result.recommendedRouteId).toBe(dry.id);
  });
  test('wind assisting most distance outranks headwind for the same temperatures', async () => {
    const north = await makeRoute();
    const southBase = await makeRoute();
    const south = {
      ...southBase,
      legs: southBase.legs.map((leg) => ({ ...leg, bearingDegrees: 180 })),
    };
    const forecasts = forecastsFor([north, south], (quantity) =>
      quantity === 'wind-speed' ? 8 : defaultValue(quantity),
    );
    const result = recommendRides(
      [south, north],
      inputFor([south, north]),
      forecasts,
      now.getTime(),
    );
    expect(result.recommendedRouteId).toBe(north.id);
    expect(result.rankings[0]?.best?.conditions.assistedDistanceFraction).toBe(
      1,
    );
    expect(result.rankings[1]?.best?.conditions.assistedDistanceFraction).toBe(
      0,
    );
  });
  test('search chooses a departure whose actual ride avoids the wet hours', async () => {
    const route = await makeRoute();
    const result = recommendRides(
      [route],
      inputFor([route]),
      forecastsFor([route], (quantity, h) =>
        quantity === 'probability'
          ? h < 12
            ? 0.9
            : 0
          : defaultValue(quantity),
      ),
      now.getTime(),
    );
    expect(
      Date.parse(result.rankings[0]?.best?.departureAt ?? ''),
    ).toBeGreaterThanOrEqual(Date.parse('2026-10-10T11:30:00Z'));
    expect(
      result.rankings[0]?.best?.conditions.maximumPrecipitationProbability,
    ).toBe(0);
  });
  test('weather at later locations is evaluated later in the ride', async () => {
    const base = await makeRoute();
    const first = present(base.weatherLocations[0]);
    const last = present(base.weatherLocations[1]);
    const route: Route = {
      ...base,
      distanceM: 40_000,
      legs: [
        {
          ...present(base.legs[0]),
          fromM: 0,
          toM: 20_000,
          weatherLocationId: first.id,
        },
        {
          ...present(base.legs[0]),
          fromM: 20_000,
          toM: 40_000,
          weatherLocationId: last.id,
        },
      ],
    };
    const result = recommendRides(
      [route],
      inputFor([route], { riding: { departureStepMinutes: 60 } }),
      forecastsFor([route], (quantity, h, _r, locationIndex) =>
        quantity === 'air-temperature'
          ? h === 9 + locationIndex
            ? 20
            : 5
          : defaultValue(quantity),
      ),
      now.getTime(),
    );
    expect(result.rankings[0]?.best?.departureAt).toBe(
      '2026-10-10T09:00:00.000Z',
    );
    expect(result.rankings[0]?.best?.conditions.temperatureC.minimum).toBe(20);
  });
});

describe('personal standards and uncertainty', () => {
  test('all failures still yield best available with explicit none-meet result', async () => {
    const route = await makeRoute();
    const input = inputFor([route], {
      preferences: {
        minimumStandards: { minimumTemperature: { kind: 'fixed', valueC: 20 } },
      },
    });
    const result = recommendRides(
      [route],
      input,
      forecastsFor([route]),
      now.getTime(),
    );
    expect(result.recommendedRouteId).toBe(route.id);
    expect(result.minimumStandardsStatus).toBe('none_meet');
    expect(result.rankings[0]?.best?.standards.failures[0]?.actual).toBe(18);
  });
  test('meeting minimums takes priority over a higher comfort score', async () => {
    const dry = await makeRoute();
    const wet = await makeRoute();
    const input = inputFor([dry, wet], {
      preferences: {
        weights: { temperature: 1, dryness: 0, wind: 0 },
        minimumStandards: { maximumPrecipitationProbability: 0.1 },
      },
    });
    const result = recommendRides(
      [wet, dry],
      input,
      forecastsFor([wet, dry], (quantity, _h, route) =>
        quantity === 'air-temperature'
          ? route.id === wet.id
            ? 18
            : 10
          : quantity === 'probability'
            ? route.id === wet.id
              ? 0.5
              : 0
            : defaultValue(quantity),
      ),
      now.getTime(),
    );
    expect(result.recommendedRouteId).toBe(dry.id);
    expect(result.minimumStandardsStatus).toBe('match_found');
  });
  test('missing weather never becomes calm/dry or a claim every route fails', async () => {
    const known = await makeRoute();
    const unknown = await makeRoute();
    const input = inputFor([known, unknown], {
      preferences: {
        minimumStandards: { minimumTemperature: { kind: 'fixed', valueC: 20 } },
      },
    });
    const result = recommendRides(
      [known, unknown],
      input,
      forecastsFor([known, unknown], (quantity, _h, route) =>
        route.id === unknown.id && quantity === 'wind-speed'
          ? null
          : defaultValue(quantity),
      ),
      now.getTime(),
    );
    expect(result.minimumStandardsStatus).toBe('unknown');
    expect(result.unranked[0]?.status).toBe('unassessable');
    expect(result.rankings).toHaveLength(1);
  });
  test('monthly settings are personal and unresolved months stay unknown', async () => {
    const route = await makeRoute();
    const input = inputFor([route], {
      preferences: {
        minimumStandards: {
          minimumTemperature: { kind: 'monthly', valuesC: { '1': 0, '6': 16 } },
        },
      },
    });
    expect(resolveMinimumTemperature(input).resolved).toBe(false);
    expect(
      recommendRides([route], input, forecastsFor([route]), now.getTime())
        .minimumStandardsStatus,
    ).toBe('unknown');
    expect(
      resolveMinimumTemperature({ ...input, date: '2026-06-01' }).valueC,
    ).toBe(16);
    expect(
      resolveMinimumTemperature({ ...input, date: '2026-01-01' }).valueC,
    ).toBe(0);
  });
});

test('an unresolved alternative prevents a false none-meet conclusion even when the best departure fails another limit', async () => {
  const route = await makeRoute();
  const input = inputFor([route], {
    preferences: {
      minimumStandards: {
        minimumTemperature: { kind: 'monthly', valuesC: { '1': 0 } },
        maximumGustKph: 40,
      },
    },
  });
  const result = recommendRides(
    [route],
    input,
    forecastsFor([route], (quantity, h) =>
      quantity === 'air-temperature'
        ? h < 12
          ? 5
          : 18
        : quantity === 'wind-gust'
          ? h < 12
            ? 3
            : 12
          : defaultValue(quantity),
    ),
    now.getTime(),
  );
  expect(result.rankings[0]?.best?.standards.status).toBe('below');
  expect(result.rankings[0]?.departuresStandardsUnknown).toBeGreaterThan(0);
  expect(result.minimumStandardsStatus).toBe('unknown');
  expect(
    result.rankings[0]?.best?.standards.failures[0]?.sections.length,
  ).toBeGreaterThan(0);
});
