import { Temporal } from '@js-temporal/polyfill';
import { z } from 'zod';

const clockTime = z
  .string()
  .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm (00:00–23:59).');
export const ridingWindowSchema = z.union([
  z.literal('daylight'),
  z
    .strictObject({ start: clockTime, end: clockTime })
    .refine((w) => w.start < w.end, {
      message: 'Window end must be after its start on the same day.',
    }),
]);
export const planningDaysSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('preset'),
    preset: z.enum(['today', 'tomorrow', 'weekend', 'next']),
  }),
  z
    .strictObject({
      kind: z.literal('range'),
      start: z.iso.date(),
      end: z.iso.date(),
    })
    .refine(
      (d) => {
        const days = Temporal.PlainDate.from(d.start).until(
          Temporal.PlainDate.from(d.end),
        ).days;
        return days >= 0 && days < 7;
      },
      { message: 'Select one to seven consecutive calendar days.' },
    ),
  z
    .strictObject({
      kind: z.literal('dates'),
      dates: z.array(z.iso.date()).min(1).max(7),
    })
    .refine(
      (d) =>
        d.dates.every((date, i) => i === 0 || date > (d.dates[i - 1] ?? '')),
      {
        path: ['dates'],
        message: 'Dates must be strictly ascending with no duplicates.',
      },
    )
    .refine(
      (d) => {
        // ISO date-only strings are UTC: the span is independent of DST.
        // Missing/invalid dates are reported by the array/date schemas above.
        const span =
          Date.parse(d.dates.at(-1) ?? '') - Date.parse(d.dates[0] ?? '');
        return !Number.isFinite(span) || span <= 6 * 86_400_000;
      },
      {
        path: ['dates'],
        message: 'Select dates within a seven-calendar-day span.',
      },
    ),
]);
export const planningSchema = z.strictObject({
  days: planningDaysSchema,
  window: ridingWindowSchema,
});
export const defaultPlanning: z.infer<typeof planningSchema> = {
  days: { kind: 'preset', preset: 'next' },
  window: 'daylight',
};
export const localDate = (now: Date, timeZone: string) =>
  Temporal.Instant.fromEpochMilliseconds(now.getTime())
    .toZonedDateTimeISO(timeZone)
    .toPlainDate();
export const datesBetween = (start: string, end: string) => {
  const dates: string[] = [];
  for (
    let d = Temporal.PlainDate.from(start);
    d.toString() <= end;
    d = d.add({ days: 1 })
  )
    dates.push(d.toString());
  return dates;
};
/** Resolve calendar intent, never substitute another selection or infer live forecast coverage. */
export const resolvePlanningDays = (
  days: z.infer<typeof planningDaysSchema>,
  timeZone: string,
  now: Date,
) => {
  const today = localDate(now, timeZone);
  let start = today;
  let end = today;
  if (days.kind === 'range') {
    start = Temporal.PlainDate.from(days.start);
    end = Temporal.PlainDate.from(days.end);
  } else if (days.kind === 'preset' && days.preset === 'tomorrow')
    start = end = today.add({ days: 1 });
  else if (days.kind === 'preset' && days.preset === 'next')
    end = today.add({ days: 4 });
  else if (days.kind === 'preset' && days.preset === 'weekend') {
    start =
      today.dayOfWeek === 7
        ? today
        : today.add({ days: (6 - today.dayOfWeek + 7) % 7 });
    end = start.dayOfWeek === 7 ? start : start.add({ days: 1 });
  }
  const dates = (
    days.kind === 'dates'
      ? days.dates
      : datesBetween(start.toString(), end.toString())
  ).filter((date) => date >= today.toString());
  const first = dates[0],
    last = dates.at(-1);
  return {
    range:
      first && last
        ? {
            start: first,
            end: last,
            dates,
            preset: days.kind === 'preset' ? days.preset : null,
            fallback: false,
          }
        : null,
    expired: dates.length === 0,
    dates,
  };
};
