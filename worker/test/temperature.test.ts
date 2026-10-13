import { expect, test } from 'bun:test';
import { recommendRides, sampleAt } from '../src/recommendations/engine.ts';
import { compileTemperature } from '../src/recommendations/temperature.ts';
import type { ForecastSample } from '../src/weather/contracts.ts';
import {
  defaultValue,
  forecastsFor,
  inputFor,
  makeRoute,
  now,
  present,
} from './fixtures/rides.ts';

const at = (hour: number) =>
  Date.parse('2026-10-10T00:00:00Z') + hour * 3_600_000;
const points = (values: (number | null)[]): ForecastSample[] =>
  values.map((value, i) => ({
    value,
    validAt: new Date(at(8 + i)).toISOString(),
    time: { kind: 'instant', at: new Date(at(8 + i)).toISOString() },
  }));

test('temperature changes continuously at half-hours and retains hourly extrema', () => {
  const t = compileTemperature(points([10, 12.5, 15.25, 17]));
  expect(t.at(at(8.5))).toBe(11.25);
  expect(t.at(at(8.5) + 1000)).toBeCloseTo(11.250694, 5);
  expect(t.at(at(10.25))).toBe(15.6875);
  expect(
    compileTemperature(points([10, 20, 10])).range(at(8.5), at(9.5)),
  ).toEqual({
    minimum: { at: at(8.5), value: 15 },
    maximum: { at: at(9), value: 20 },
  });
});

test('missing, non-instant, out-of-range and coarser readings remain unknown', () => {
  const t = compileTemperature(points([10, null, 15]));
  expect(t.at(at(8.5))).toBeNull();
  expect(t.range(at(8), at(10))).toBeNull();
  expect(t.at(at(7.99))).toBeNull();
  expect(t.at(at(10.01))).toBeNull();
  expect(
    compileTemperature(points([10, 12, 15]).filter((_, i) => i !== 1)).range(
      at(8),
      at(10),
    ),
  ).toBeNull();
  expect(
    compileTemperature([
      {
        ...present(points([10])[0]),
        time: {
          kind: 'period',
          aggregation: 'mean',
          range: {
            start: new Date(at(7)).toISOString(),
            end: new Date(at(8)).toISOString(),
          },
        },
      },
    ]).at(at(8)),
  ).toBeNull();
});

const richmondCase = async () => {
  const base = await makeRoute();
  const first = present(base.legs[0]);
  const route = {
    ...base,
    distanceM: 35_000,
    legs: Array.from({ length: 35 }, (_, i) => ({
      ...first,
      fromM: i * 1000,
      toM: (i + 1) * 1000,
    })),
  };
  const input = inputFor([route], {
    timeZone: 'Europe/London',
    riding: { window: { start: '09:30', end: '11:15' } },
    preferences: {
      minimumStandards: {
        minimumTemperature: { kind: 'fixed', valueC: 11.3 },
        maximumTemperatureC: 15.5,
      },
    },
  });
  const forecasts = forecastsFor([route], (quantity, h) =>
    quantity === 'air-temperature'
      ? ({ 8: 10, 9: 12.5, 10: 15.25, 11: 17 }[h] ?? 10)
      : quantity === 'wind-gust' && h === 11
        ? 8.25
        : defaultValue(quantity),
  );
  const result = recommendRides([route], input, forecasts, now.getTime());
  return {
    route,
    input,
    forecasts,
    result,
    best: present(result.rankings[0]?.best ?? undefined),
  };
};

test('ride range and minimum standards include departure and finish, with gusts unchanged', async () => {
  const { best, forecasts } = await richmondCase();
  expect(best.conditions.temperatureC).toEqual({
    minimum: 11.25,
    maximum: 15.69,
  });
  expect(
    best.standards.failures.map((f) => ({
      standard: f.standard,
      at: f.at,
      positionKm: f.positionKm,
    })),
  ).toEqual([
    {
      standard: 'minimumTemperatureC',
      at: new Date(at(8.5)).toISOString(),
      positionKm: 0,
    },
    {
      standard: 'maximumTemperatureC',
      at: new Date(at(10.25)).toISOString(),
      positionKm: 35,
    },
  ]);
  expect(best.conditions.maximumGustKph).toBe(29.7);
  const forecast = forecasts[0];
  if (!forecast || forecast.status === 'unavailable')
    throw new Error('Missing fixture');
  const gust = present(
    forecast.series.find(
      (s) =>
        s.descriptor.kind === 'scalar' &&
        s.descriptor.measure.quantity === 'wind-gust',
    ),
  );
  expect(sampleAt(gust.samples, at(10.25))).toBe(8.25);
});

test('missing departure bracket makes a ride unknown even with a usable midpoint', async () => {
  const { route, input, forecasts } = await richmondCase();
  for (const forecast of forecasts) {
    if (forecast.status === 'unavailable') continue;
    const temperature = forecast.series.find(
      (s) =>
        s.descriptor.kind === 'scalar' &&
        s.descriptor.measure.quantity === 'air-temperature',
    );
    const sample = temperature?.samples.find(
      (s) => s.validAt === new Date(at(8)).toISOString(),
    );
    if (sample) Object.assign(sample, { value: null });
  }
  const result = recommendRides([route], input, forecasts, now.getTime());
  expect(result.rankings).toHaveLength(0);
  expect(result.unranked[0]?.departuresUnknown).toBe(1);
});

test('forecast details contain only visited sites, bracket temperatures and full overlapping gust periods', async () => {
  const { best, forecasts } = await richmondCase();
  const details = best.forecastDetails;
  expect(details.locations).toHaveLength(1);
  const site = present(details.locations[0]);
  expect(site.retrievedAt).toBe(now.toISOString());
  expect(site.temperatures.map((s) => s.at)).toEqual(
    [8, 9, 10, 11].map((h) => new Date(at(h)).toISOString()),
  );
  expect(site.gusts.map((s) => [s.start, s.end])).toEqual(
    [8, 9, 10].map((h) => [
      new Date(at(h)).toISOString(),
      new Date(at(h + 1)).toISOString(),
    ]),
  );
  expect(site.gusts.at(-1)?.maximumKph).toBe(29.7);
  expect(site.temperatureStatistic).toEqual({ kind: 'deterministic' });
  expect(site.source.providerId).toBe('fixture');
  expect(forecasts).toHaveLength(2);
});
