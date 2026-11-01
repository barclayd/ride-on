import { expect, test } from 'bun:test';
import assert from 'node:assert/strict';
import { planDepartures } from '../src/recommendations/daylight.ts';
import { recommendationSchema } from '../src/recommendations/input.ts';
import { inputFor, makeRoute, now } from './fixtures/rides.ts';

const iso = (values: number[]) =>
  values.map((value) => new Date(value).toISOString());

test('explicit window includes exact-fit rides, rejects overruns and anchors slots at the requested minute', async () => {
  const route = await makeRoute({ distanceM: 40_000 });
  const input = inputFor([route], {
    riding: { window: { start: '09:10', end: '11:10' } },
  });
  const plan = planDepartures(route, input, now.getTime());
  expect(iso(plan.departures)).toEqual(['2026-10-10T08:10:00.000Z']);
  assert.ok(plan.departures[0] !== undefined);
  expect(plan.departures[0] + plan.durationMs).toBe(
    Date.parse('2026-10-10T10:10:00Z'),
  );
  expect(
    planDepartures({ ...route, distanceM: 40_001 }, input, now.getTime())
      .departures,
  ).toEqual([]);
});

test('window excludes elapsed slots and uses the effective user time zone', async () => {
  const route = await makeRoute({ distanceM: 20_000 });
  const settings = { riding: { window: { start: '09:00', end: '13:00' } } };
  const local = planDepartures(
    route,
    inputFor([route], settings),
    Date.parse('2026-10-10T08:05:00Z'),
  );
  assert.ok(local.departures[0] !== undefined);
  expect(new Date(local.departures[0]).toISOString()).toBe(
    '2026-10-10T08:30:00.000Z',
  );
  expect(
    local.departures.every(
      (d) => d + local.durationMs <= Date.parse('2026-10-10T12:00:00Z'),
    ),
  ).toBe(true);
  const utc = planDepartures(
    route,
    inputFor([route], { ...settings, timeZone: 'UTC' }),
    now.getTime(),
  );
  assert.ok(utc.departures[0] !== undefined);
  expect(new Date(utc.departures[0]).toISOString()).toBe(
    '2026-10-10T09:00:00.000Z',
  );
});

test('explicit windows intersect daylight and can have no daylight overlap', async () => {
  const route = await makeRoute({ distanceM: 20_000 });
  const plan = planDepartures(
    route,
    inputFor([route], { riding: { window: { start: '06:00', end: '23:00' } } }),
    now.getTime(),
  );
  expect(plan.effectiveWindow).toEqual(plan.daylight);
  expect(plan.departures.length).toBeGreaterThan(0);
  assert.ok(plan.daylight);
  for (const departure of plan.departures) {
    expect(departure).toBeGreaterThanOrEqual(plan.daylight.start);
    expect(departure + plan.durationMs).toBeLessThanOrEqual(plan.daylight.end);
  }
  const night = planDepartures(
    route,
    inputFor([route], { riding: { window: { start: '00:00', end: '05:00' } } }),
    now.getTime(),
  );
  expect(night.effectiveWindow).toBeNull();
  expect(night.departures).toEqual([]);
});

test('valid clock-change days use the correct offset and elapsed ride duration', async () => {
  const route = await makeRoute({ distanceM: 40_000 });
  for (const [date, expected] of [
    ['2026-03-29', '2026-03-29T08:00:00.000Z'],
    ['2026-10-25', '2026-10-25T09:00:00.000Z'],
  ] as const) {
    const input = inputFor([route], {
      date,
      riding: { window: { start: '09:00', end: '11:00' } },
    });
    const plan = planDepartures(
      route,
      input,
      Date.parse('2026-01-01T00:00:00Z'),
    );
    expect(iso(plan.departures)).toEqual([expected]);
    expect(plan.durationMs).toBe(2 * 3_600_000);
  }
});

test('malformed, overnight, empty and ambiguous or nonexistent clock windows fail validation', async () => {
  const route = await makeRoute();
  for (const [date, start, end] of [
    ['2026-10-10', '13:00', '09:00'],
    ['2026-10-10', '09:00', '09:00'],
    ['2026-10-10', '9:00', '13:00'],
    ['2026-10-10', '09:00', '24:00'],
    ['2026-03-29', '01:30', '13:00'],
    ['2026-10-25', '01:30', '13:00'],
  ] as const) {
    expect(
      recommendationSchema.safeParse({
        routeIds: [route.id],
        date,
        riding: { window: { start, end } },
      }).success,
    ).toBe(false);
  }
});
