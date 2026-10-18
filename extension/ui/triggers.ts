// The alerts dialog's words (handoff v10, 29c): its triggers, when alerts run and its button.
import type { PushStatus } from '../lib/push';
import type { AlertTriggers, Preferences } from '../lib/types';
import {
  addDays,
  clock,
  degrees,
  instant,
  localDate,
  METRIC,
  shortDate,
  speed,
  type Units,
} from './format';

export const ALL_TRIGGERS: AlertTriggers = {
  rain: true,
  wind: true,
  cold: true,
  betterTime: true,
};
// The API sends its final forecast at 19:00 until brief v11 moves it to 18:00 and says so.
export const SUMMARY_TIME = '19:00';

export type TriggerRow = {
  key: keyof AlertTriggers;
  label: string;
  colour: string;
  path: string; // on a 16-unit grid, stroked
};

// Thresholds come from Preferences; a limit the rider hasn't set has no switch.
export const triggerRows = (
  prefs: Partial<Preferences> | undefined,
  u: Units = METRIC,
): TriggerRow[] => {
  const gust = prefs?.minimumStandards?.maximumGustKph;
  const cold = prefs?.temperature?.comfortMinC;
  const rows: (TriggerRow | false)[] = [
    {
      key: 'rain',
      label: 'Rain becomes likely',
      colour: '#2f5f8a',
      path: 'M4.6 10.4h6.9a2.4 2.4 0 0 0 .3-4.8 3.4 3.4 0 0 0-6.6.8 2 2 0 0 0-.6 4z M5.8 12.4l-.5 1.4 M8.3 12.4l-.5 1.4 M10.8 12.4l-.5 1.4',
    },
    gust != null && {
      key: 'wind',
      label: `Gusts pass your ${speed(gust, u)} limit`,
      colour: '#6e8a3a',
      path: 'M2 6h8.5a2 2 0 1 0-2-2 M2 9.5h11a2 2 0 1 1-2 2',
    },
    cold != null && {
      key: 'cold',
      label: `It feels colder than your ${degrees(cold, u)}° minimum`,
      colour: '#3d5f7d',
      path: 'M5.5 9.3V3.5a1.5 1.5 0 0 1 3 0v5.8a3 3 0 1 1-3 0z M7 7v4 M12.5 3v5 M10.8 6.4l1.7 1.7 1.7-1.7',
    },
    {
      key: 'betterTime',
      label: 'A better time or day opens up',
      colour: '#4c6223',
      path: 'M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2z M8 4.8V8l2.2 1.4',
    },
  ];
  return rows.filter((row) => row !== false);
};

// The final forecast is the evening before; a ride tracked after it only stops at departure.
export const timingLine = (
  departureAt: string,
  timeZone: string,
  now: Date,
  summaryTime = SUMMARY_TIME,
) => {
  const eve = addDays(localDate(departureAt, timeZone), -1);
  const stop = `Alerts stop at ${clock(departureAt, timeZone)} when you leave.`;
  return now.getTime() < Date.parse(instant(eve, summaryTime, timeZone))
    ? `Plus the final forecast at ${summaryTime} on ${shortDate(eve)}. ${stop}`
    : stop;
};

export const confirmLabel = (on: number, moving: boolean) =>
  on === 0
    ? 'Pick at least one'
    : moving
      ? 'Move alerts here'
      : 'Turn on alerts';

// Before this device has notifications set up, confirming asks for them.
export const asksPermission = (push: PushStatus) =>
  push.status === 'off' || push.status === 'setup';
