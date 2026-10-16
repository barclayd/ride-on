import { expect, test } from 'bun:test';
import { planDepartures } from '../src/recommendations/daylight.ts';
import { recommendRides } from '../src/recommendations/engine.ts';
import {
  forecastsFor,
  inputFor,
  makeRoute,
  now,
  present,
} from './fixtures/rides.ts';

test('exact assessment preserves the searched score and can assess a departure absent from a changed grid', async () => {
  const route = await makeRoute(),
    input = inputFor([route], {
      riding: {
        window: { start: '09:00', end: '10:00' },
        departureStepMinutes: 15,
      },
    });
  const weather = forecastsFor([route]);
  const candidate = present(
    present(recommendRides([route], input, weather, now.getTime()).rankings[0])
      .alternatives[0],
  );
  const changed = {
    ...input,
    riding: { ...input.riding, departureStepMinutes: 120 },
  };
  const exact = present(
    recommendRides(
      [route],
      changed,
      weather,
      now.getTime(),
      10_000,
      0,
      undefined,
      new Map([[route.id, Date.parse(candidate.departureAt)]]),
    ).rankings[0],
  ).best;
  expect(exact).toEqual(candidate);
  const grid = planDepartures(route, changed, now.getTime());
  expect(grid.departures).not.toContain(Date.parse(candidate.departureAt));
});

test('pinned feasibility uses the full duration and calendar timezone across DST, independent of the grid', async () => {
  const route = await makeRoute();
  for (const [date, utcHour] of [
    ['2026-10-24', 8],
    ['2026-10-25', 9],
  ] as const) {
    const input = inputFor([route], {
      date,
      timeZone: 'Europe/London',
      riding: {
        window: { start: '09:10', end: '10:00' },
        departureStepMinutes: 120,
      },
    });
    const departure = Date.parse(
      `${date}T${String(utcHour).padStart(2, '0')}:20:00Z`,
    );
    const plan = planDepartures(route, input, now.getTime(), departure);
    expect(plan.departures).toEqual([departure]);
    const tooLate = Date.parse(
      `${date}T${String(utcHour + 1).padStart(2, '0')}:00:00Z`,
    );
    expect(
      planDepartures(route, input, now.getTime(), tooLate).departures,
    ).toEqual([]);
    expect(
      planDepartures(route, input, departure + 1, departure).departures,
    ).toEqual([]);
  }
});
