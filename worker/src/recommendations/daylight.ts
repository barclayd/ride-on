import { Temporal } from '@js-temporal/polyfill';
import { getTimes } from 'suncalc';
import type { Route } from '../routes/model.ts';
import type { RecommendationInput } from './input.ts';

export const daylightWindow = (
  route: Route,
  date: string,
  timeZone: string,
) => {
  const day = Temporal.PlainDate.from(date);
  const noon = day.toZonedDateTime({ timeZone, plainTime: '12:00' });
  let start = day.toZonedDateTime(timeZone).epochMilliseconds;
  let end = day.add({ days: 1 }).toZonedDateTime(timeZone).epochMilliseconds;
  // A conservative common daylight window avoids any sampled section being dark.
  for (const { coordinate } of route.weatherLocations) {
    const sun = getTimes(
      new Date(noon.epochMilliseconds),
      coordinate.latitude,
      coordinate.longitude,
      0,
      noon.offsetNanoseconds / 3_600_000_000_000,
    );
    if (sun.alwaysDown) return null;
    if (sun.alwaysUp) continue;
    if (!sun.sunrise || !sun.sunset) return null;
    start = Math.max(start, sun.sunrise.getTime());
    end = Math.min(end, sun.sunset.getTime());
  }
  return start < end ? { start, end } : null;
};

export const planDepartures = (
  route: Route,
  input: RecommendationInput,
  nowMs: number,
) => {
  const daylight = daylightWindow(route, input.date, input.timeZone);
  const durationMs =
    (route.distanceM / (input.riding.averageSpeedKph / 3.6)) * 1000;
  const dayStart = Temporal.PlainDate.from(input.date).toZonedDateTime(
    input.timeZone,
  ).epochMilliseconds;
  const window = input.riding.window;
  const toInstant = (time: string) =>
    Temporal.PlainDateTime.from(`${input.date}T${time}`).toZonedDateTime(
      input.timeZone,
      { disambiguation: 'reject' },
    ).epochMilliseconds;
  const requested =
    window === 'daylight'
      ? null
      : { start: toInstant(window.start), end: toInstant(window.end) };
  const start = Math.max(
    daylight?.start ?? Infinity,
    requested?.start ?? -Infinity,
    nowMs,
  );
  const end = Math.min(daylight?.end ?? -Infinity, requested?.end ?? Infinity);
  const effectiveWindow = start < end ? { start, end } : null;
  if (!effectiveWindow)
    return {
      daylight,
      effectiveWindow,
      durationMs,
      departures: [] as number[],
    };
  const step = input.riding.departureStepMinutes * 60_000;
  // Anchor explicit windows at their requested start, including e.g. 09:10.
  const anchor = requested?.start ?? dayStart;
  const first = anchor + Math.ceil((start - anchor) / step) * step;
  const departures: number[] = [];
  for (let departure = first; departure + durationMs <= end; departure += step)
    departures.push(departure);
  return { daylight, effectiveWindow, durationMs, departures };
};
