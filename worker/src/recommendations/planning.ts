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
  } else if (days.preset === 'tomorrow') start = end = today.add({ days: 1 });
  else if (days.preset === 'next') end = today.add({ days: 4 });
  else if (days.preset === 'weekend') {
    start =
      today.dayOfWeek === 7
        ? today
        : today.add({ days: (6 - today.dayOfWeek + 7) % 7 });
    end = start.dayOfWeek === 7 ? start : start.add({ days: 1 });
  }
  const expired = Temporal.PlainDate.compare(end, today) < 0;
  if (Temporal.PlainDate.compare(start, today) < 0) start = today;
  return {
    range: expired
      ? null
      : {
          start: start.toString(),
          end: end.toString(),
          preset: days.kind === 'preset' ? days.preset : null,
          fallback: false,
        },
    expired,
    dates: expired ? [] : datesBetween(start.toString(), end.toString()),
  };
};
