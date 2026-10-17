import { expect, test } from 'bun:test';
import {
  activePause,
  pauseResumesAt,
  validatePauseDate,
} from '../src/users/pause.ts';

test('pause dates use the first instant of the local day across DST and skipped midnight', () => {
  for (const [date, zone, instant] of [
    ['2026-10-25', 'Europe/London', '2026-10-24T23:00:00.000Z'],
    ['2026-10-26', 'Europe/London', '2026-10-26T00:00:00.000Z'],
    ['2026-10-25', 'America/Los_Angeles', '2026-10-25T07:00:00.000Z'],
    ['2026-11-02', 'America/Los_Angeles', '2026-11-02T08:00:00.000Z'],
    ['2018-11-04', 'America/Sao_Paulo', '2018-11-04T03:00:00.000Z'],
    ['2011-12-30', 'Pacific/Apia', '2011-12-30T10:00:00.000Z'],
  ] as const)
    expect(pauseResumesAt(date, zone)).toBe(instant);
});

test('pause validation counts calendar days in the profile zone, including a leap year', () => {
  const at = new Date('2027-03-01T00:30:00.000Z');
  // It is still February 28 in California, so February 28 next year is 365 days away.
  for (const until of [null, '2027-03-01', '2028-02-28'])
    expect(() =>
      validatePauseDate(until, 'America/Los_Angeles', at),
    ).not.toThrow();
  for (const until of [
    '2027-02-28',
    '2028-02-29',
    '2027-02-30',
    '2027-2-28',
    '',
  ])
    expect(() => validatePauseDate(until, 'America/Los_Angeles', at)).toThrow();
});

test('a dated pause expires at the boundary without storage cleanup; indefinite pauses do not', () => {
  const pause = {
    until: '2026-10-25',
    resumesAt: '2026-10-24T23:00:00.000Z',
    pausedAt: '2026-10-18T09:12:00.000Z',
  };
  expect(activePause(pause, new Date('2026-10-24T22:59:59.999Z'))).toEqual(
    pause,
  );
  expect(activePause(pause, new Date(pause.resumesAt))).toBeNull();
  expect(activePause(pause, new Date('2027-01-01T00:00:00.000Z'))).toBeNull();
  const indefinite = { ...pause, until: null, resumesAt: null };
  expect(activePause(indefinite, new Date('2030-01-01T00:00:00.000Z'))).toEqual(
    indefinite,
  );
});
