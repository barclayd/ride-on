import { expect, test } from 'bun:test';
import data from '../src/climate/haduk-grid.json';
import { climateSource } from '../src/climate/seasonal.ts';
import { conditionsSchema } from '../src/recommendations/conditions.ts';
import {
  ALGORITHM_VERSION,
  recommendRides,
  requiredWeatherFor,
} from '../src/recommendations/engine.ts';
import {
  compileDisplayWeather,
  temperatureAlongRideFor,
  timeWeightedMean,
  usualClimateFor,
  usualTemperatureAt,
  usualTemperatureC,
  windChillC,
} from '../src/recommendations/temperature-along-ride.ts';
import { normaliseAppleWeather } from '../src/weather/apple-weather.ts';
import { cachedForecastSchema } from '../src/weather/cache.ts';
import type {
  ForecastRequest,
  LocationForecastResult,
} from '../src/weather/contracts.ts';
import { weatherDescriptors as d } from '../src/weather/descriptors.ts';
import { normaliseGlobalSpot } from '../src/weather/met-office-global-spot.ts';
import { APPLE_NOW, appleWeatherFixture } from './fixtures/apple-weather.ts';
import { globalSpotFixture } from './fixtures/global-spot.ts';
import {
  defaultValue,
  forecastsFor,
  inputFor,
  makeRoute,
  now,
  present,
} from './fixtures/rides.ts';

const hour = 3_600_000;
const at = (h: number) => Date.parse('2026-10-10T00:00:00Z') + h * hour;
const enriched = (input: ReturnType<typeof inputFor>) => [
  ...requiredWeatherFor(input),
  d.feelsLikeTemperature,
];

const caseFor = async () => {
  const base = await makeRoute();
  const first = present(base.weatherLocations[0]);
  const locations = [first, { ...first, id: 'second' }];
  const route = {
    ...base,
    distanceM: 40_100,
    weatherLocations: locations,
    legs: [0, 1].map((i) => ({
      ...present(base.legs[0]),
      fromM: i * 20_050,
      toM: (i + 1) * 20_050,
      weatherLocationId: present(locations[i]).id,
    })),
  };
  const input = inputFor([route], {
    riding: { window: { start: '08:00', end: '12:00' } },
    timeZone: 'UTC',
  });
  const forecasts = forecastsFor(
    [route],
    (q, h, _r, i) =>
      q === 'air-temperature'
        ? i === 0
          ? 5 + h
          : 10 + h
        : q === 'feels-like-temperature'
          ? h === 9
            ? i === 0
              ? -2
              : 25
            : 8
          : defaultValue(q),
    enriched(input),
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

test('every returned trace keeps ten-minute points, exact finish, unique ordered offsets and all extrema', async () => {
  const { best, result } = await caseFor();
  for (const candidate of [best, ...present(result.rankings[0]).alternatives]) {
    const { points, feelsLikeBasis } = candidate.temperatureAlongRide;
    const duration =
      (Date.parse(candidate.finishAt) - Date.parse(candidate.departureAt)) /
      60_000;
    expect(points[0]?.[0]).toBe(0);
    expect(points.at(-1)?.[0]).toBe(duration);
    expect(Number.isInteger(duration)).toBe(false);
    const times = points.map((p) => p[0]);
    expect(new Set(times).size).toBe(times.length);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    for (let minute = 0; minute < duration; minute += 10)
      expect(times).toContain(minute);
    const air = points.flatMap((p) => (p[1] === null ? [] : [p[1]]));
    expect(Math.min(...air)).toBe(candidate.conditions.temperatureC.minimum);
    expect(Math.max(...air)).toBe(candidate.conditions.temperatureC.maximum);
    expect(feelsLikeBasis).toBe('provider');
  }
  const trace = best.temperatureAlongRide;
  expect(trace.points.every((p) => p[2] !== null)).toBe(true);
  expect(trace.usual).not.toBeNull();
  expect(best.temperatureAssessment.seasonal.status).toBe('disabled');
  expect(ALGORITHM_VERSION).toBe('comfort-v0.17');
});

test('section entry wins at a boundary, with the outgoing extremum preserved immediately before it', async () => {
  const { route, input } = await caseFor();
  const forecasts = forecastsFor([route], (q, _h, _r, i) =>
    q === 'air-temperature' ? (i === 0 ? 30 : 10) : defaultValue(q),
  );
  const display = new Map(
    forecasts.map((f) => [
      f.status === 'unavailable' ? f.requested.id : f.location.requested.id,
      compileDisplayWeather(f, requiredWeatherFor(input)),
    ]),
  );
  const trace = temperatureAlongRideFor(
    route,
    at(8),
    at(10),
    display,
    null,
    'UTC',
  );
  expect(trace.points.find((p) => p[0] === 60)?.[1]).toBe(10);
  expect(Math.max(...trace.points.map((p) => p[1] ?? -Infinity))).toBe(30);
  expect(trace.points.every((p) => p[2] === null && p[3] === null)).toBe(true);
  expect(trace.feelsLikeBasis).toBeNull();
});

test('interpolation uses instantaneous brackets and missing/long gaps break both lines', async () => {
  const { route, input, forecasts } = await caseFor();
  const source = present(forecasts[0]);
  if (source.status === 'unavailable') throw new Error('Expected forecast');
  const display = compileDisplayWeather(source, requiredWeatherFor(input));
  expect(display.air.at(at(8.5))).toBe(13.5);
  expect(display.feelsLike.at(at(8.5))).toBe(3);
  const gap: LocationForecastResult = {
    ...source,
    series: source.series.map((s) =>
      s.descriptor.kind === 'scalar' &&
      ['air-temperature', 'feels-like-temperature'].includes(
        s.descriptor.measure.quantity,
      )
        ? {
            ...s,
            samples: s.samples.filter(
              (sample) => Date.parse(sample.validAt) !== at(9),
            ),
          }
        : s,
    ),
  };
  const gapped = compileDisplayWeather(gap, requiredWeatherFor(input));
  expect(gapped.air.at(at(8.5))).toBeNull();
  const trace = temperatureAlongRideFor(
    route,
    at(8),
    at(10),
    new Map(route.weatherLocations.map((l) => [l.id, gapped])),
    usualClimateFor(route, input.date),
    'UTC',
  );
  expect(
    trace.points.some(
      (p) => p[0] > 0 && p[0] < 120 && p[1] === null && p[2] === null,
    ),
  ).toBe(true);
  expect(trace.usual?.differenceC).toBeNull();
});

test.each([
  [5, 20, 1.1],
  [12, 20, 12],
  [5, 3, 5],
])('BPF wind chill at %s°C and %s km/h is %s°C', (air, wind, expected) => {
  expect(Math.round(windChillC(air, wind) * 10) / 10).toBe(expected);
});

test('derived feels like is interpolated from BPF hourly values, with mixed provenance across locations', async () => {
  const { route, input } = await caseFor();
  const raw = forecastsFor(
    [route],
    (q) =>
      q === 'air-temperature'
        ? 5
        : q === 'wind-speed'
          ? 20 / 3.6
          : q === 'feels-like-temperature'
            ? 4
            : defaultValue(q),
    enriched(input),
  );
  const forecasts = raw.map((f, i) =>
    f.status === 'unavailable' || i === 1
      ? f
      : {
          ...f,
          provenance: {
            ...f.provenance,
            source: { ...f.provenance.source, providerId: 'met-office-bpf' },
          },
        },
  );
  const best = present(
    recommendRides([route], input, forecasts, now.getTime()).rankings[0]
      ?.best ?? undefined,
  );
  expect(best.temperatureAlongRide.feelsLikeBasis).toBe('mixed');
  expect(best.temperatureAlongRide.points.some((p) => p[2] === 1.1)).toBe(true);
  expect(best.conditions.precipitationAmountBasis).toBe('rate-estimate');
});

const request: ForecastRequest = {
  locations: [{ id: 'sample', coordinate: { latitude: 52, longitude: -1 } }],
  range: { start: '2026-10-09T10:00:00Z', end: '2026-10-09T12:00:00Z' },
  required: [
    d.airTemperature,
    d.windSpeed,
    d.windGust,
    d.windDirection,
    d.precipitationRate,
    d.precipitationProbability,
  ],
  maxAgeSeconds: 21600,
  maxLocationDistanceM: 10000,
  maxTimeStepSeconds: 3600,
  freshnessBasis: 'retrieval-time',
};
test('Apple and Global Spot include optional feels like and the native hourly accumulation without extra requests', () => {
  const location = present(request.locations[0]);
  const apple = appleWeatherFixture({
    latitude: 52,
    longitude: -1,
    start: '2026-10-09T00:00:00Z',
  });
  apple.forecastHourly.hours.forEach((row) => {
    row.precipitationAmount = 2.4;
  });
  const appleDisplay = compileDisplayWeather(
    normaliseAppleWeather(apple, location, request, APPLE_NOW),
    request.required,
  );
  const spotDisplay = compileDisplayWeather(
    normaliseGlobalSpot(
      globalSpotFixture(),
      location,
      request,
      '2026-10-09T09:30:00Z',
    ),
    request.required,
  );
  const time = Date.parse('2026-10-09T10:30:00Z');
  expect(appleDisplay.feelsLike.at(time)).toBe(17);
  expect(spotDisplay.feelsLike.at(time)).toBe(14);
  expect(appleDisplay.precipitationAmount(time)).toBe(2.4);
  expect(spotDisplay.precipitationAmount(time)).toBe(0.2);
  // Global Spot labels its preceding accumulation at the end of the period.
  expect(
    spotDisplay.precipitationAmount(Date.parse('2026-10-09T11:59:00Z')),
  ).toBe(0.2);
});

test('missing optional provider values stay null and cacheable even alongside unknown sunshine', () => {
  const fixture = globalSpotFixture();
  for (const row of present(fixture.features[0]).properties.timeSeries) {
    Object.assign(row, {
      feelsLikeTemperature: null,
      totalPrecipAmount: null,
      significantWeatherCode: 999,
    });
  }
  const result = normaliseGlobalSpot(
    fixture,
    present(request.locations[0]),
    { ...request, required: [...request.required, d.skyCondition] },
    '2026-10-09T09:30:00Z',
  );
  const display = compileDisplayWeather(result, request.required);
  expect(display.feelsLike.at(Date.parse('2026-10-09T10:30:00Z'))).toBeNull();
  expect(cachedForecastSchema.safeParse(result).success).toBe(true);
  expect(result.issues.some((i) => i.code === 'invalid-response')).toBe(false);
});

test('rain amounts use worst observed hour, preserve mixed bases, and round-trip as optional saved conditions', async () => {
  const { route, input } = await caseFor();
  const forecasts = forecastsFor(
    [route],
    (q, h) =>
      q === 'precipitation-rate'
        ? h % 2
          ? 0.2
          : 1.7
        : q === 'precipitation-amount'
          ? h % 2
            ? 2.4
            : 0.3
          : defaultValue(q),
    [...requiredWeatherFor(input), d.precipitationAmount],
  ).map((f, i) =>
    f.status === 'unavailable'
      ? f
      : {
          ...f,
          series: f.series.flatMap((s) =>
            s.descriptor === d.precipitationAmount
              ? i === 1
                ? []
                : [
                    {
                      ...s,
                      samples: s.samples.map((sample) => ({
                        ...sample,
                        time: {
                          kind: 'period' as const,
                          aggregation: 'accumulation' as const,
                          range: {
                            start: sample.validAt,
                            end: new Date(
                              Date.parse(sample.validAt) + hour,
                            ).toISOString(),
                          },
                        },
                      })),
                    },
                  ]
              : [s],
          ),
        },
  );
  const best = present(
    recommendRides([route], input, forecasts, now.getTime()).rankings[0]
      ?.best ?? undefined,
  );
  expect(best.conditions.precipitationAmountBasis).toBe('mixed');
  expect(best.conditions.maximumPrecipitationAmountMm).toBe(
    Math.max(
      ...best.rideHours.map(
        (h) => h.conditions?.maximumPrecipitationAmountMm ?? 0,
      ),
    ),
  );
  expect(conditionsSchema.parse(best.conditions)).toEqual(best.conditions);
  const {
    maximumPrecipitationAmountMm: _amount,
    precipitationAmountBasis: _basis,
    ...legacy
  } = best.conditions;
  expect(conditionsSchema.parse(legacy)).toEqual(legacy);
});

test('bundled minimums cover all matching cells and retain the scoring data version', () => {
  expect(data.cells).toHaveLength(1707);
  for (const cell of data.cells) {
    expect(cell.minimumC).toHaveLength(12);
    expect(
      cell.minimumC.every(
        (v, i) => Number.isFinite(v) && v <= (cell.maximumC[i] ?? -Infinity),
      ),
    ).toBe(true);
  }
  expect(climateSource.version).toBe('haduk-grid-1.1.0.0-1991-2020-12km-tmax');
});

test('usual uses raw monthly high/low, coverage-weighted values, and no nearest-cell guesses abroad', async () => {
  const { route } = await caseFor();
  const usual = present(usualClimateFor(route, '2026-10-10') ?? undefined);
  expect(usual?.month).toBe(10);
  expect(usual?.averageHighC).toBe(15.7);
  expect(usual?.averageLowC).toBe(8.8);
  expect(usual?.coveredDistanceFraction).toBe(1);
  expect(usual?.source.statistics).toEqual(['maximum', 'minimum']);
  const foreign = {
    ...route,
    legs: route.legs.map((l) => ({
      ...l,
      coordinate: { latitude: 48.86, longitude: 2.35 },
    })),
  };
  expect(usualClimateFor(foreign, '2026-10-10')).toBeNull();
  const half = {
    ...route,
    legs: [present(route.legs[0]), present(foreign.legs[1])],
  };
  expect(usualClimateFor(half, '2026-10-10')).toEqual({
    ...usual,
    coveredDistanceFraction: 0.5,
  });
});

test('usual follows the daily curve and local clock through the October DST transition', async () => {
  for (const h of [3, 5, 21, 23]) expect(usualTemperatureC(h, 8, 16)).toBe(8);
  expect(usualTemperatureC(15, 8, 16)).toBe(16);
  expect(usualTemperatureC(10, 8, 16)).toBeCloseTo(12);
  const { route } = await caseFor();
  const usual = present(usualClimateFor(route, '2026-10-25') ?? undefined);
  expect(
    usualTemperatureAt(
      Date.parse('2026-10-24T14:00:00Z'),
      usual,
      'Europe/London',
    ),
  ).toBe(usual.averageHighC);
  expect(
    usualTemperatureAt(
      Date.parse('2026-10-25T15:00:00Z'),
      usual,
      'Europe/London',
    ),
  ).toBe(usual.averageHighC);
  for (const time of ['00:30', '01:30', '02:30'])
    expect(
      usualTemperatureAt(
        Date.parse(`2026-10-25T${time}:00Z`),
        usual,
        'Europe/London',
      ),
    ).toBe(usual.averageLowC);
});

test('difference from usual is time weighted and display evidence changes no scores', async () => {
  expect(
    timeWeightedMean([
      { at: 0, value: 0 },
      { at: 1, value: 10 },
      { at: 10, value: 10 },
    ]),
  ).toBe(9.5);
  const { route, input, best, forecasts } = await caseFor();
  const stripped = forecasts.map((f) =>
    f.status === 'unavailable'
      ? f
      : {
          ...f,
          series: f.series.filter(
            (s) => s.descriptor !== d.feelsLikeTemperature,
          ),
        },
  );
  const before = present(
    recommendRides([route], input, stripped, now.getTime()).rankings[0]?.best ??
      undefined,
  );
  expect(best.score).toBe(before.score);
  expect(best.weatherScore).toBe(before.weatherScore);
  expect(best.factors).toEqual(before.factors);
  expect(best.pointsLost).toEqual(before.pointsLost);
  // At night the usual curve is constant; unequal sections have a duration-weighted mean.
  const display = new Map(
    forecasts.map((f) => [
      f.status === 'unavailable' ? f.requested.id : f.location.requested.id,
      compileDisplayWeather(f, requiredWeatherFor(input)),
    ]),
  );
  const usual = usualClimateFor(route, input.date);
  const trace = temperatureAlongRideFor(
    route,
    at(1),
    at(3),
    display,
    usual,
    'UTC',
  );
  // Hourly air: first half 6→7, second half 12→13; mean 9.5.
  expect(trace.usual?.differenceC).toBe(
    Math.round((9.5 - (usual?.averageLowC ?? 0)) * 10) / 10,
  );
});

test('a short location with no feels-like series breaks the line between regular samples', async () => {
  const { route, input, forecasts } = await caseFor();
  const source = present(forecasts[0]);
  if (source.status === 'unavailable') throw new Error('Expected evidence');
  const missing = {
    ...source,
    series: source.series.filter(
      (s) => s.descriptor !== d.feelsLikeTemperature,
    ),
  };
  const leg = present(route.legs[0]);
  const segmented = {
    ...route,
    distanceM: 20000,
    legs: [
      { ...leg, fromM: 0, toM: 1000, weatherLocationId: 'known' },
      { ...leg, fromM: 1000, toM: 2000, weatherLocationId: 'missing' },
      { ...leg, fromM: 2000, toM: 20000, weatherLocationId: 'known' },
    ],
  };
  const display = new Map([
    ['known', compileDisplayWeather(source, requiredWeatherFor(input))],
    ['missing', compileDisplayWeather(missing, requiredWeatherFor(input))],
  ]);
  const trace = temperatureAlongRideFor(
    segmented,
    at(8),
    at(9),
    display,
    null,
    'UTC',
  );
  expect(trace.points.find((p) => p[0] === 0)?.[2]).not.toBeNull();
  expect(trace.points.find((p) => p[0] === 10)?.[2]).not.toBeNull();
  expect(trace.points.some((p) => p[0] > 0 && p[0] < 10 && p[2] === null)).toBe(
    true,
  );
  // Completely absent data stays compact even for a route split into many sections.
  const dense = {
    ...route,
    legs: Array.from({ length: 1000 }, (_, i) => ({
      ...leg,
      fromM: (i * route.distanceM) / 1000,
      toM: ((i + 1) * route.distanceM) / 1000,
      weatherLocationId: 'missing',
    })),
  };
  expect(
    temperatureAlongRideFor(dense, at(8), at(9), display, null, 'UTC').points
      .length,
  ).toBeLessThanOrEqual(11);
  const halfMissing = {
    ...dense,
    legs: dense.legs.map((l, i) => ({
      ...l,
      weatherLocationId: i < 500 ? 'known' : 'missing',
    })),
  };
  expect(
    temperatureAlongRideFor(halfMissing, at(8), at(9), display, null, 'UTC')
      .points.length,
  ).toBeLessThanOrEqual(13);
});

test('sub-minute air and feels-like exit extrema survive a different entering section', async () => {
  const { route, input } = await caseFor();
  const forecasts = forecastsFor(
    [route],
    (q, h, _r, i) =>
      q === 'air-temperature'
        ? i === 0
          ? h * 2
          : 5
        : q === 'feels-like-temperature'
          ? i === 0
            ? -h
            : 10
          : defaultValue(q),
    enriched(input),
  );
  const display = new Map(
    forecasts.map((f) => [
      f.status === 'unavailable' ? f.requested.id : f.location.requested.id,
      compileDisplayWeather(f, requiredWeatherFor(input)),
    ]),
  );
  const trace = temperatureAlongRideFor(
    route,
    at(8),
    at(10.01),
    display,
    null,
    'UTC',
  );
  // The first section ends at 09:00:18, neither a ten-minute nor whole-minute point.
  const air = trace.points.map((p) => p[1] ?? -Infinity);
  const feels = trace.points.map((p) => p[2] ?? Infinity);
  expect(Math.max(...air)).toBe(18);
  expect(Math.min(...feels)).toBe(-9);
  const extreme = trace.points.find(
    (p) => p[0] > 60.1 && p[1] === 18 && p[2] === -9,
  );
  expect(extreme?.[0]).toBeCloseTo(60.3, 3);
  expect(trace.points.at(-1)?.[1]).toBe(5);
});

test('partial assessments include the same trace when elevation alone is unavailable', async () => {
  const { route } = await caseFor();
  const partialRoute = { ...route, ascentM: null };
  const input = inputFor([partialRoute], {
    preferences: { climbing: { preference: 'flatter' } },
  });
  const result = recommendRides(
    [partialRoute],
    input,
    forecastsFor([partialRoute]),
    now.getTime(),
  );
  const partial = result.unranked[0]?.partialAssessment;
  expect(partial?.temperatureAlongRide.points[0]?.[0]).toBe(0);
  expect(partial?.temperatureAlongRide.usual).not.toBeNull();
});
