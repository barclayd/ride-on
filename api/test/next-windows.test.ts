import { expect, test } from 'bun:test';
import { nextWindowSearches } from '../src/recommendations/next-windows.ts';

test('suggestion calendar uses the effective local day across a year boundary, with no duplicate tomorrow weekday', () => {
  // Already Thursday in Auckland; after.date was Friday.
  const result = nextWindowSearches(
    { date: '2026-12-25', window: 'daylight' },
    'Pacific/Auckland',
    new Date('2026-12-30T12:00:00Z'),
  );
  expect(result[0]?.dates).toEqual(['2027-01-01']);
  expect(result[1]?.dates).toEqual(['2027-01-08']);
  expect(result[2]?.dates).toEqual([
    '2027-01-01',
    '2027-01-02',
    '2027-01-03',
    '2027-01-04',
    '2027-01-05',
    '2027-01-06',
  ]);
});

test('same weekday includes today plus two and future previous dates are invalid in the effective zone', () => {
  const now = new Date('2026-10-09T00:30:00Z'); // Thursday in California
  expect(
    nextWindowSearches(
      { date: '2026-10-03', window: 'daylight' },
      'America/Los_Angeles',
      now,
    )[1]?.dates,
  ).toEqual(['2026-10-10']);
  expect(() =>
    nextWindowSearches(
      { date: '2026-10-09', window: 'daylight' },
      'America/Los_Angeles',
      now,
    ),
  ).toThrow('today or earlier');
});
