import { Temporal } from '@js-temporal/polyfill';

/** Refresh on demand, measured from retrieval; calendar days use the rider's zone. */
export const forecastRefreshSeconds = (
  dates: readonly string[],
  now: Date,
  timeZone: string,
) => {
  const today = Temporal.Instant.fromEpochMilliseconds(now.getTime())
    .toZonedDateTimeISO(timeZone)
    .toPlainDate();
  const daysAway = Math.min(
    ...dates.map((date) => today.until(Temporal.PlainDate.from(date)).days),
  );
  return (daysAway <= 0 ? 3 : daysAway === 1 ? 6 : 12) * 3600;
};
