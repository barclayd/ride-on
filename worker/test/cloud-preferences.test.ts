import { expect, test } from 'bun:test';
import profile from '../../evaluation/comfort-profile-v2.json';
import {
  recommendRides,
  requiredWeatherFor,
} from '../src/recommendations/engine.ts';
import {
  defaultValue,
  forecastsFor,
  inputFor,
  makeRoute,
  now,
} from './fixtures/rides.ts';

test('the provisional personal profile prefers cooler clear skies; another rider can favour warmth', async () => {
  const clear = await makeRoute({ name: 'Cool clear ride' });
  const cloudy = await makeRoute({ name: 'Warmer cloudy ride' });
  const routes = [cloudy, clear];
  const input = inputFor(routes, profile.request);
  const weather = forecastsFor(
    routes,
    (quantity, _hour, route) =>
      quantity === 'air-temperature'
        ? route.id === clear.id
          ? 14
          : 17
        : quantity === 'total-cloud-cover'
          ? route.id === clear.id
            ? 0.1
            : 0.8
          : defaultValue(quantity),
    requiredWeatherFor(input),
  );
  const result = recommendRides(routes, input, weather, now.getTime());
  expect(result.recommendedRouteId).toBe(clear.id);
  expect(result.rankings[0]?.best?.conditions.cloudCoverFraction?.mean).toBe(
    0.1,
  );
  expect(result.rankings[0]?.best?.factors.clearSkies).toBe(90);
  const warmer = inputFor(routes, {
    ...profile.request,
    preferences: {
      weights: { temperature: 1, wind: 0, dryness: 0, clearSkies: 0 },
    },
  });
  expect(
    recommendRides(routes, warmer, weather, now.getTime()).recommendedRouteId,
  ).toBe(cloudy.id);
});

test('cloud-aware departures balance sunshine against warmth without a fixed morning bonus', async () => {
  const route = await makeRoute();
  const input = inputFor([route], profile.request);
  for (const sunnyMorning of [true, false]) {
    const weather = forecastsFor(
      [route],
      (quantity, hour) => {
        if (quantity === 'air-temperature') return hour < 12 ? 14 : 17;
        if (quantity === 'total-cloud-cover')
          return hour < 12 === sunnyMorning ? 0.1 : 0.8;
        return defaultValue(quantity);
      },
      requiredWeatherFor(input),
    );
    const best = recommendRides([route], input, weather, now.getTime())
      .rankings[0]?.best;
    expect(best).toBeDefined();
    const departure = new Date(best?.departureAt ?? '');
    const departureHour =
      departure.getUTCHours() + departure.getUTCMinutes() / 60;
    expect(departureHour < 11.5).toBe(sunnyMorning);
    expect(best?.conditions.cloudCoverFraction?.mean).toBe(0.1);
  }
});

test('cloud cannot be assumed clear when absent or substituted with a different statistic', async () => {
  const route = await makeRoute();
  const input = inputFor([route], profile.request);
  for (const mode of ['missing', 'deterministic'] as const) {
    const weather = forecastsFor(
      [route],
      (quantity) =>
        quantity === 'total-cloud-cover' ? null : defaultValue(quantity),
      requiredWeatherFor(input),
    );
    const changed =
      mode === 'missing'
        ? weather
        : weather.map((r) =>
            r.status === 'unavailable'
              ? r
              : {
                  ...r,
                  series: r.series.map((s) =>
                    s.descriptor.kind === 'scalar'
                      ? {
                          ...s,
                          descriptor: {
                            ...s.descriptor,
                            statistic: { kind: 'deterministic' as const },
                          },
                        }
                      : s,
                  ),
                },
          );
    const result = recommendRides([route], input, changed, now.getTime());
    expect(result.recommendedRouteId).toBeNull();
    expect(result.unranked[0]?.departuresUnknown).toBeGreaterThan(0);
  }
});

test('dominant tailwind beats equal-speed crosswind; calm rides remain comfortable without assistance', async () => {
  const tail = await makeRoute({ name: 'Tailwind' });
  const cross = await makeRoute({ name: 'Crosswind' });
  const calm = await makeRoute({ name: 'Calm' });
  const routes = [tail, cross, calm];
  const input = inputFor(routes, profile.request);
  const weather = forecastsFor(
    routes,
    (quantity, _hour, route) => {
      if (quantity === 'wind-speed') return route.id === calm.id ? 1 : 5;
      // The oblique crosswind has a small positive tail component: it is still not helpful.
      if (quantity === 'wind-from-direction')
        return route.id === tail.id ? 180 : 100;
      if (quantity === 'total-cloud-cover') return 0;
      return defaultValue(quantity);
    },
    requiredWeatherFor(input),
  );
  const result = recommendRides(routes, input, weather, now.getTime());
  const tailRide = result.rankings.find((r) => r.routeId === tail.id)?.best;
  const crossRide = result.rankings.find((r) => r.routeId === cross.id)?.best;
  const calmRide = result.rankings.find((r) => r.routeId === calm.id)?.best;
  expect(tailRide?.score ?? 0).toBeGreaterThan(crossRide?.score ?? 0);
  expect(tailRide?.conditions.assistedDistanceFraction).toBe(1);
  expect(crossRide?.conditions.assistedDistanceFraction).toBe(0);
  expect(calmRide?.score ?? 0).toBeGreaterThan(98);
  expect(calmRide?.conditions.assistedDistanceFraction).toBe(0);
});
