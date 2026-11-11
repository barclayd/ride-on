import { expect, test } from 'bun:test';
import type { Ride } from '../lib/types';
import {
  checkTiming,
  feedbackLine,
  level,
  resetWhen,
  rideDuration,
  thisRide,
  weatherCheck,
} from '../ui/feedback';

const TZ = 'Europe/London';
const ride = { riddenOn: '2026-10-29', timeZone: TZ };
type Experience = NonNullable<Ride['experience']>;
const experience = (patch: Partial<Experience> = {}): Experience => ({
  timing: {
    startTime: '06:20',
    durationMinutes: 185,
    precision: 'approximate',
    routeFollowed: 'yes',
  },
  feedback: {
    enjoyment: 4,
    weatherComfort: 2,
    reasons: [],
    includeInLearning: true,
  },
  firstSubmittedAt: '2026-10-29T12:00:00.000Z',
  updatedAt: '2026-10-29T12:00:00.000Z',
  ...patch,
});
const on = { enabled: true, resetAt: null };

test('the History line shows ratings, else reasons, else times alone', () => {
  expect(feedbackLine(experience())).toBe('Enjoyment 4/5 · Weather 2/5');
  const reasons = (n: number) =>
    experience({
      feedback: {
        enjoyment: null,
        weatherComfort: null,
        reasons: Array.from({ length: n }, () => ({
          factor: 'wind' as const,
          impact: 'negative' as const,
        })),
        includeInLearning: true,
      },
    });
  expect(feedbackLine(reasons(1))).toBe('1 reason');
  expect(feedbackLine(reasons(2))).toBe('2 reasons');
  expect(feedbackLine(experience({ feedback: null }))).toBe('Ride times added');
  expect(feedbackLine(null)).toBeNull();
});

test('durations read as hours and padded minutes', () => {
  expect(rideDuration(185)).toBe('3 h 05 min');
  expect(rideDuration(45)).toBe('45 min');
  expect(rideDuration(120)).toBe('2 h 00 min');
});

test('timing is complete with a start and 1 to 1,440 minutes, and caught in the future', () => {
  const now = Date.parse('2026-10-29T12:00:00Z');
  const t = (start: string, hours: string, minutes: string) =>
    checkTiming({ start, hours, minutes }, ride, now);
  expect(t('', '', '')).toMatchObject({ any: false, complete: false });
  expect(t('06:20', '', '')).toMatchObject({ any: true, complete: false });
  expect(t('', '3', '5')).toMatchObject({ any: true, complete: false });
  expect(t('06:20', '3', '5')).toMatchObject({
    complete: true,
    minutes: 185,
    future: false,
  });
  expect(t('06:20', '24', '1').complete).toBe(false);
  // GMT on 29 October: 11:30 + 45 min ends at 12:15, after now.
  expect(t('11:30', '0', '45')).toMatchObject({
    future: true,
    endClock: '12:15',
  });
});

test('a ride counts only when included, timed on the saved route, rated and after a fresh start', () => {
  expect(thisRide(experience(), on)).toEqual({ status: 'included' });
  expect(thisRide(experience(), null)).toEqual({ status: 'included' });
  expect(thisRide(experience(), { enabled: false, resetAt: null })).toEqual({
    status: 'paused',
  });
  const off = experience();
  if (off.feedback) off.feedback.includeInLearning = false;
  expect(thisRide(off, on)).toEqual({ status: 'off' });
  expect(thisRide(experience({ timing: null }), on)).toEqual({
    status: 'not-used',
    why: 'timing',
  });
  const partly = experience();
  if (partly.timing) partly.timing.routeFollowed = 'partly';
  expect(thisRide(partly, on)).toEqual({ status: 'not-used', why: 'timing' });
  const unrated = experience();
  if (unrated.feedback) unrated.feedback.weatherComfort = null;
  expect(thisRide(unrated, on)).toEqual({ status: 'not-used', why: 'comfort' });
  expect(
    thisRide(experience(), {
      enabled: true,
      resetAt: '2026-10-29T13:00:00.000Z',
    }),
  ).toEqual({ status: 'not-used', why: 'reset' });
});

test('the weather check waits until the API has the ride’s weather', () => {
  expect(weatherCheck('not-requested')).toBe('waiting');
  expect(weatherCheck('pending')).toBe('waiting');
  expect(weatherCheck('processing')).toBe('waiting');
  expect(weatherCheck('ready')).toBe('done');
  expect(weatherCheck('unavailable')).toBe('unavailable');
});

test('progress needs five rides, then follows confidence', () => {
  expect(level({ evidenceCount: 4, confidence: 0.6 })).toBe(0);
  expect(level({ evidenceCount: 9, confidence: 0 })).toBe(0);
  expect(level({ evidenceCount: 5, confidence: 0.1 })).toBe(1);
  expect(level({ evidenceCount: 12, confidence: 0.3 })).toBe(2);
  expect(level({ evidenceCount: 30, confidence: 0.75 })).toBe(3);
});

test('a fresh start reads as today or its date', () => {
  const now = new Date('2026-10-30T15:00:00Z');
  expect(resetWhen('2026-10-30T09:05:00Z', TZ, now)).toBe('today at 09:05');
  expect(resetWhen('2026-10-12T09:05:00Z', TZ, now)).toBe('on 12 Oct');
});
