import { expect, test } from 'bun:test';
import {
  recommendRides,
  requiredWeatherFor,
} from '../src/recommendations/engine.ts';
import { daySummary } from '../src/recommendations/multi-day.ts';
import { importGpx } from '../src/routes/gpx.ts';
import { normaliseAppleWeather } from '../src/weather/apple-weather.ts';
import { skyConditions } from '../src/weather/conditions.ts';
import { APPLE_NOW, appleWeatherFixture } from './fixtures/apple-weather.ts';
import {
  defaultValue,
  forecastsFor,
  inputFor,
  makeRoute,
  present,
} from './fixtures/rides.ts';

test('mixed known and unknown route sections retain partial sunshine uncertainty', async () => {
  const route = await importGpx(
    `<gpx version="1.1"><trk><trkseg>${Array.from({ length: 15 }, (_, i) => `<trkpt lat="${51.2 + i * 0.03}" lon="-1"/>`).join('')}</trkseg></trk></gpx>`,
  );
  const input = inputFor([route], {
    preferences: { weights: { sunshine: 0.25 } },
  });
  const forecasts = forecastsFor(
    [route],
    (quantity, _hour, _route, locationIndex) =>
      quantity === 'sky-condition'
        ? locationIndex === 0
          ? null
          : 1
        : defaultValue(quantity),
    requiredWeatherFor(input),
  );
  const result = recommendRides(
    [route],
    input,
    forecasts,
    Date.parse(APPLE_NOW),
  );
  const best = result.rankings[0]?.best;
  expect(best?.sunshineAssessment?.status).toBe('partial');
  expect(best?.sunshineAssessment?.unknownDistanceFraction).toBeGreaterThan(0);
  expect(best?.sunshineAssessment?.unknownDistanceFraction).toBeLessThan(1);
  expect(best?.factors.sunshine).toBeNull();
  expect(best?.conditions.skyConditionDistanceFractions).toBeNull();
});

test('sky shares retain the known distance within a ride hour when symbols stop or have an interior gap', async () => {
  const route = await importGpx(
    `<gpx version="1.1"><trk><trkseg>${Array.from({ length: 15 }, (_, i) => `<trkpt lat="${51.2 + i * 0.03}" lon="-1"/>`).join('')}</trkseg></trk></gpx>`,
  );
  const departure = Date.parse('2026-10-10T09:15:00Z');
  for (const interior of [false, true]) {
    for (const sunshine of [0.25, 0]) {
      const input = inputFor([route], {
        preferences: { weights: { sunshine } },
      });
      const forecasts = forecastsFor(
        [route],
        (quantity, hour) =>
          quantity === 'sky-condition'
            ? (interior ? hour === 11 : hour >= 11)
              ? null
              : skyConditions.sunny
            : defaultValue(quantity),
        requiredWeatherFor(input),
      );
      const result = recommendRides(
        [route],
        input,
        forecasts,
        Date.parse(APPLE_NOW),
        10_000,
        3,
        undefined,
        new Map([[route.id, departure]]),
      );
      const best = present(present(result.rankings[0]).best);
      if (!best) throw new Error('Expected an assessed departure');
      expect(best.conditions.skyConditionDistanceFractions).toBeNull();
      expect(best.factors.sunshine).toBeNull();
      if (sunshine === 0) {
        expect(best.sunshineAssessment).toBeNull();
        expect(best.conditions.skyConditionShares).toBeNull();
        for (const hour of best.rideHours)
          expect(hour.conditions?.skyConditionShares).toBeNull();
        continue;
      }
      const shares = best.conditions.skyConditionShares;
      expect(Object.keys(shares ?? {}).sort()).toEqual(
        [...Object.keys(skyConditions), 'unknown'].sort(),
      );
      expect(shares?.sunny).toBeGreaterThan(0);
      expect(shares?.unknown).toBeGreaterThan(0);
      expect(shares?.unknown).toBeCloseTo(
        best.sunshineAssessment?.unknownDistanceFraction ?? -1,
        2,
      );
      expect(
        Object.values(shares ?? {}).reduce((sum, v) => sum + v, 0),
      ).toBeCloseTo(1, 2);
      const boundary = present(best.rideHours[1]).conditions;
      expect(boundary?.skyConditionDistanceFractions).toBeNull();
      expect(boundary?.skyConditionShares?.sunny).toBeGreaterThan(0);
      expect(boundary?.skyConditionShares?.unknown).toBeGreaterThan(0);
      // Each hour has its own denominator; the boundary hour isn't the whole route.
      expect(boundary?.skyConditionShares?.unknown).not.toBe(shares?.unknown);
      expect(best.rideHours[0]?.conditions?.skyConditionShares?.sunny).toBe(1);
    }
  }
});

const assess = async (
  change: (row: Record<string, unknown>, hour: number) => void,
  weights: Record<string, number> = { sunshine: 0.25, clearSkies: 0 },
) => {
  const route = await makeRoute();
  const input = inputFor([route], {
    preferences: {
      weights,
      minimumStandards: { maximumGustKph: 45 },
    },
  });
  const required = requiredWeatherFor(input);
  const forecasts = route.weatherLocations.map((location) => {
    const raw = appleWeatherFixture(location.coordinate);
    raw.forecastHourly.hours.forEach(change);
    return normaliseAppleWeather(
      raw,
      location,
      {
        locations: [location],
        range: { start: '2026-10-10T00:00:00Z', end: '2026-10-11T00:00:00Z' },
        required,
        maxTimeStepSeconds: 3600,
        maxLocationDistanceM: 10_000,
        maxAgeSeconds: 43200,
        freshnessBasis: 'retrieval-time',
      },
      APPLE_NOW,
    );
  });
  const result = recommendRides(
    [route],
    input,
    forecasts,
    Date.parse(APPLE_NOW),
  );
  return {
    result,
    forecasts,
    day: daySummary(
      [route],
      input,
      result,
      forecasts,
      required,
      Date.parse(APPLE_NOW),
    ),
  };
};

test('Apple wind/heat and unknown sky codes retain complete essential coverage and an honest sunshine assessment', async () => {
  for (const code of ['Breezy', 'Windy', 'Hot', 'Frigid', 'FutureCode']) {
    const { result, forecasts, day } = await assess((row) => {
      row.conditionCode = code;
    });
    const ranked = present(result.rankings[0]);
    const best = present(ranked.best);
    if (!best) throw new Error('Expected an assessed departure');
    expect(day.availability).toBe('full');
    expect(day.availabilityReason).toBe('available');
    expect(ranked.departuresUnknown).toBe(0);
    expect(best.standards.status).toBe('meets');
    expect(best.sunshineAssessment).toEqual({
      status: 'unavailable',
      unknownDistanceFraction: 1,
    });
    expect(best.factors.sunshine).toBeNull();
    expect(best.conditions.skyConditionDistanceFractions).toBeNull();
    expect(best.conditions.skyConditionShares).toEqual({
      sunny: 0,
      sunnyIntervals: 0,
      cloudy: 0,
      overcast: 0,
      obscured: 0,
      precipitation: 0,
      clearNight: 0,
      partlyCloudyNight: 0,
      unknown: 1,
    });
    expect(best.drawbacks).toContain(
      'Sunshine details are incomplete; unknown sections have a neutral effect on the score.',
    );
    expect(forecasts[0]?.issues.some((i) => i.code === 'missing-data')).toBe(
      true,
    );
  }
});

test('one unknown sunshine hour does not punch an interior coverage gap', async () => {
  const { result, day } = await assess((row, hour) => {
    if (hour === 12) row.conditionCode = 'Breezy';
  });
  expect(day.availability).toBe('full');
  expect(day.coverage[0]?.intervals).toHaveLength(1);
  expect(result.rankings[0]?.departuresUnknown).toBe(0);
});

test('unknown sunshine scores between observed sun and overcast without claiming 50 percent sunshine', async () => {
  const scores = [];
  for (const code of ['Clear', 'Breezy', 'Cloudy']) {
    const { result } = await assess(
      (row) => {
        row.conditionCode = code;
      },
      { temperature: 0, wind: 0, dryness: 0, clearSkies: 0, sunshine: 1 },
    );
    scores.push(result.rankings[0]?.best?.weatherScore);
    const conditions = result.rankings[0]?.best?.conditions;
    if (code !== 'Breezy') {
      const fractions = conditions?.skyConditionDistanceFractions;
      if (!fractions) throw new Error('Expected complete sky fractions');
      expect(conditions?.skyConditionShares).toEqual({
        ...fractions,
        unknown: 0,
      });
    }
  }
  expect(scores).toEqual([100, 50, 0]);
});

test('missing core fields and explicitly requested cloud cover still limit coverage', async () => {
  for (const field of [
    'temperature',
    'windSpeed',
    'windDirection',
    'windGust',
    'precipitationAmount',
    'precipitationChance',
    'cloudCover',
  ]) {
    const { result, day } = await assess(
      (row, hour) => {
        if (hour === 12) delete row[field];
      },
      { sunshine: 0.25, clearSkies: 0.1 },
    );
    expect(day.availability).toBe('partial');
    expect(day.until).toBeNull();
    expect(day.coverage[0]?.intervals).toHaveLength(2);
    expect(present(result.rankings[0]).departuresUnknown).toBeGreaterThan(0);
  }
});

test('neutral sunshine cannot hide failed minimums and is absent when not requested', async () => {
  const { result } = await assess((row) => {
    row.conditionCode = 'Breezy';
    row.windGust = 60;
  });
  expect(result.rankings[0]?.best?.standards.status).toBe('below');
  expect(result.rankings[0]?.best?.standards.failures[0]?.standard).toBe(
    'maximumGustKph',
  );
  const ignored = await assess(
    (row) => {
      row.conditionCode = 'Breezy';
    },
    { sunshine: 0, clearSkies: 0 },
  );
  expect(ignored.result.rankings[0]?.best?.sunshineAssessment).toBeNull();
  expect(
    ignored.result.rankings[0]?.best?.drawbacks.some((d) =>
      d.startsWith('Sunshine details'),
    ),
  ).toBe(false);
});
