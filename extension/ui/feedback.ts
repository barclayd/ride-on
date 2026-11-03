// Ride feedback and Tailored Rides: the copy and rules behind ride-feedback.tsx.
// The API says "learning"; riders only ever see Tailored Rides (docs/ride-learning.md).
import type {
  FeedbackFactor,
  LearningFactor,
  LearningProfile,
  Ride,
  RideExperience,
} from '../lib/types';
import { clock, instant, localDate } from './format';

export const ENJOYMENT = [
  '',
  "Didn't enjoy it",
  'Not much',
  'It was OK',
  'Enjoyed it',
  'Loved it',
];
export const COMFORT = [
  '',
  'Very uncomfortable',
  'Uncomfortable',
  'Bearable',
  'Comfortable',
  'Perfect',
];
export const REASONS: { factor: FeedbackFactor; label: string }[] = [
  { factor: 'sunshine', label: 'Sunshine' },
  { factor: 'temperature', label: 'Temperature' },
  { factor: 'wind', label: 'Wind' },
  { factor: 'rain', label: 'Rain' },
  { factor: 'surface', label: 'Surface' },
  { factor: 'hills', label: 'Hills' },
  { factor: 'distance', label: 'Distance' },
  { factor: 'traffic', label: 'Traffic' },
  { factor: 'company', label: 'Company' },
  { factor: 'tiredness', label: 'Tiredness' },
  { factor: 'mechanical', label: 'Mechanical' },
];
export const reasonLabel = (factor: FeedbackFactor) =>
  REASONS.find((r) => r.factor === factor)?.label ?? factor;
export const MAX_REASONS = 2;

type Followed = NonNullable<RideExperience['timing']>['routeFollowed'];
export const FOLLOWED: { value: Followed; label: string }[] = [
  { value: 'yes', label: 'Yes' },
  { value: 'partly', label: 'Partly' },
  { value: 'different', label: 'Different Route' },
  { value: 'unknown', label: 'Not Sure' },
];

export const FACTOR_NAMES: Record<LearningFactor, string> = {
  cold: 'Cold',
  heat: 'Heat',
  wind: 'Wind',
  rain: 'Rain',
  shade: 'Lack of Sun',
};
export const LEVELS = ['Not enough yet', 'A little', 'Some', 'Strong'];
// A factor needs five rides before it shows any progress; the API caps confidence at 0.75.
export const NEEDED = 5;
export const level = (f: { evidenceCount: number; confidence: number }) =>
  f.confidence <= 0 || f.evidenceCount < NEEDED
    ? 0
    : f.confidence < 0.25
      ? 1
      : f.confidence < 0.5
        ? 2
        : 3;
export const rides = (n: number) => `${n} ride${n === 1 ? '' : 's'}`;

// "3 h 05 min", or "45 min" under an hour.
export const rideDuration = (minutes: number) => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`;
};

// The History row's one line: ratings first, then reasons, then times alone.
export const feedbackLine = (experience: Ride['experience']) => {
  const f = experience?.feedback;
  const ratings = [
    f?.enjoyment != null && `Enjoyment ${f.enjoyment}/5`,
    f?.weatherComfort != null && `Weather ${f.weatherComfort}/5`,
  ].filter(Boolean);
  if (ratings.length) return ratings.join(' · ');
  if (f?.reasons.length)
    return f.reasons.length === 1 ? '1 reason' : `${f.reasons.length} reasons`;
  return experience?.timing ? 'Ride times added' : null;
};

// The form's start time and duration as typed. Planned times are only ever offered, never filled.
export type TimingInput = { start: string; hours: string; minutes: string };
export const checkTiming = (
  t: TimingInput,
  ride: Pick<Ride, 'riddenOn' | 'timeZone'>,
  now = Date.now(),
) => {
  const minutes = (Number(t.hours) || 0) * 60 + (Number(t.minutes) || 0);
  const any = Boolean(t.start || t.hours || t.minutes);
  const complete =
    /^\d{2}:\d{2}$/.test(t.start) &&
    Number.isInteger(minutes) &&
    minutes >= 1 &&
    minutes <= 1440;
  const end = complete
    ? Date.parse(instant(ride.riddenOn, t.start, ride.timeZone)) +
      minutes * 60_000
    : null;
  return {
    minutes,
    any,
    complete,
    future: end !== null && end > now,
    endClock: end === null ? null : clock(new Date(end), ride.timeZone),
  };
};

// Why this ride does or doesn't count towards Tailored Rides, as the API decides it.
export type ThisRide =
  | { status: 'paused' }
  | { status: 'off' }
  | { status: 'not-used'; why: 'timing' | 'comfort' | 'reset' }
  | { status: 'included' };
export const thisRide = (
  experience: NonNullable<Ride['experience']>,
  learning: Pick<LearningProfile, 'enabled' | 'resetAt'> | null,
): ThisRide => {
  if (learning && !learning.enabled) return { status: 'paused' };
  const { timing, feedback } = experience;
  if (feedback && !feedback.includeInLearning) return { status: 'off' };
  if (timing?.routeFollowed !== 'yes')
    return { status: 'not-used', why: 'timing' };
  if (feedback?.weatherComfort == null)
    return { status: 'not-used', why: 'comfort' };
  if (learning?.resetAt && experience.firstSubmittedAt <= learning.resetAt)
    return { status: 'not-used', why: 'reset' };
  return { status: 'included' };
};

export const weatherCheck = (status: string | undefined) =>
  status === 'ready'
    ? 'done'
    : status === 'unavailable'
      ? 'unavailable'
      : 'waiting';

// "today at 14:05", else "on 12 Oct", in the browser's own zone.
export const resetWhen = (
  resetAt: string,
  timeZone: string,
  now = new Date(),
) => {
  const day = localDate(resetAt, timeZone);
  return day === localDate(now, timeZone)
    ? `today at ${clock(resetAt, timeZone)}`
    : `on ${new Intl.DateTimeFormat('en-GB', { timeZone, day: 'numeric', month: 'short' }).format(new Date(resetAt))}`;
};
