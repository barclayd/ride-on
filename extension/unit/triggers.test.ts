import { expect, test } from 'bun:test';
import type { PushStatus } from '../lib/push';
import { regionUnits } from '../ui/format';
import {
  asksPermission,
  confirmLabel,
  timingLine,
  triggerRows,
} from '../ui/triggers';

const PREFS = {
  minimumStandards: { maximumGustKph: 40 },
  temperature: { comfortMinC: 6, comfortMaxC: 20 },
};
const labels = (rows: ReturnType<typeof triggerRows>) =>
  rows.map((row) => [row.key, row.label]);

test('the four triggers read the limits from Preferences', () => {
  expect(labels(triggerRows(PREFS))).toEqual([
    ['rain', 'Rain becomes likely'],
    ['wind', 'Gusts pass your 40 km/h limit'],
    ['cold', 'It feels colder than your 6° minimum'],
    ['betterTime', 'A better time or day opens up'],
  ]);
});

test('the limits follow the units', () => {
  expect(labels(triggerRows(PREFS, regionUnits('en-US'))).slice(1, 3)).toEqual([
    ['wind', 'Gusts pass your 25 mph limit'],
    ['cold', 'It feels colder than your 43° minimum'],
  ]);
});

test('a limit the rider has not set has no switch', () => {
  expect(triggerRows({}).map((row) => row.key)).toEqual(['rain', 'betterTime']);
  expect(triggerRows(undefined).map((row) => row.key)).toEqual([
    'rain',
    'betterTime',
  ]);
});

// Leaves 08:30 BST on Saturday 17 October.
const DEPARTURE = '2026-10-17T07:30:00Z';
const LONDON = 'Europe/London';

test('before the final forecast it says when that is and when alerts stop', () => {
  expect(timingLine(DEPARTURE, LONDON, new Date('2026-10-16T12:00:00Z'))).toBe(
    'Plus the final forecast at 19:00 on Fri 16 Oct. Alerts stop at 08:30 when you leave.',
  );
});

test('after the final forecast only when alerts stop', () => {
  expect(timingLine(DEPARTURE, LONDON, new Date('2026-10-16T18:30:00Z'))).toBe(
    'Alerts stop at 08:30 when you leave.',
  );
});

test('the API can move the final forecast', () => {
  // 18:30 BST: after 18:00, before 19:00.
  const now = new Date('2026-10-16T17:30:00Z');
  expect(timingLine(DEPARTURE, LONDON, now, '18:00')).toBe(
    'Alerts stop at 08:30 when you leave.',
  );
  expect(timingLine(DEPARTURE, LONDON, now)).toStartWith(
    'Plus the final forecast at 19:00',
  );
});

test('the button says what it will do', () => {
  expect(confirmLabel(0, false)).toBe('Pick at least one');
  expect(confirmLabel(0, true)).toBe('Pick at least one');
  expect(confirmLabel(2, false)).toBe('Turn on alerts');
  expect(confirmLabel(4, true)).toBe('Move alerts here');
});

test('only a device without notifications set up is asked', () => {
  const push = (status: PushStatus['status']) => ({
    enabled: status === 'ready',
    status,
    message: '',
  });
  expect(asksPermission(push('off'))).toBe(true);
  expect(asksPermission(push('setup'))).toBe(true);
  expect(asksPermission(push('ready'))).toBe(false);
  expect(asksPermission(push('blocked'))).toBe(false);
  expect(asksPermission(push('unavailable'))).toBe(false);
});
