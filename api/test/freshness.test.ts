import { expect, test } from 'bun:test';
import { forecastRefreshSeconds } from '../src/recommendations/freshness.ts';

test.each([
  [['2026-10-11'], 3],
  [['2026-10-12'], 6],
  [['2026-10-13'], 12],
  [['2026-10-15'], 12],
  [['2026-10-13', '2026-10-11'], 3],
  [['2026-10-15', '2026-10-12'], 6],
] as const)('refreshes dates %j after %i hours', (dates, hours) => {
  expect(
    forecastRefreshSeconds(
      dates,
      new Date('2026-10-11T08:00:00Z'),
      'Europe/London',
    ),
  ).toBe(hours * 3600);
});

test('calendar-day policy follows the rider timezone across midnight and DST', () => {
  const beforeMidnight = new Date('2026-10-10T22:59:00Z');
  const afterMidnight = new Date('2026-10-10T23:01:00Z');
  expect(
    forecastRefreshSeconds(['2026-10-11'], beforeMidnight, 'Europe/London'),
  ).toBe(21600);
  expect(
    forecastRefreshSeconds(['2026-10-11'], afterMidnight, 'Europe/London'),
  ).toBe(10800);
  expect(forecastRefreshSeconds(['2026-10-11'], afterMidnight, 'UTC')).toBe(
    21600,
  );
  // The UK's 25-hour autumn day still counts as one calendar day.
  expect(
    forecastRefreshSeconds(
      ['2026-10-26'],
      new Date('2026-10-24T23:30:00Z'),
      'Europe/London',
    ),
  ).toBe(21600);
});
