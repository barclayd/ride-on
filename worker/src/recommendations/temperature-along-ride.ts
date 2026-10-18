import { Temporal } from '@js-temporal/polyfill';
import { climateCellAt, displayClimateSource } from '../climate/seasonal.ts';
import type { Route } from '../routes/model.ts';
import type {
  ForecastDescriptor,
  LocationForecastResult,
} from '../weather/contracts.ts';
import { descriptorKey, weatherDescriptors } from '../weather/descriptors.ts';
import { compileTemperature } from './temperature.ts';
import { compileSeries } from './weather-sampling.ts';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const tenth = (value: number) => Math.round(value * 10) / 10;
const rounded = (value: number | null) =>
  value === null ? null : tenth(value);

/** JAG/TI wind chill at rest; no rider airflow or humidity/heat-index term. */
export const windChillC = (airC: number, windKph: number) => {
  if (airC > 10 || windKph <= 4.8) return airC;
  const speed = windKph ** 0.16;
  return 13.12 + 0.6215 * airC - 11.37 * speed + 0.3965 * airC * speed;
};

/** Select exactly the scoring temperature statistic. Display data never becomes
 * a required descriptor and cannot affect source fallback or ride eligibility. */
export const compileDisplayWeather = (
  result: LocationForecastResult,
  required: readonly ForecastDescriptor[],
) => {
  const series = result.status === 'unavailable' ? [] : result.series;
  const samples = (descriptor: ForecastDescriptor | undefined) =>
    descriptor
      ? (series.find(
          (s) => descriptorKey(s.descriptor) === descriptorKey(descriptor),
        )?.samples ?? [])
      : [];
  const air = samples(
    required.find(
      (d) => d.kind === 'scalar' && d.measure.quantity === 'air-temperature',
    ),
  );
  const wind = compileSeries(
    samples(
      required.find(
        (d) => d.kind === 'scalar' && d.measure.quantity === 'wind-speed',
      ),
    ),
  );
  const derived =
    result.status !== 'unavailable' &&
    result.provenance.source.providerId === 'met-office-bpf';
  const feelsLike = derived
    ? air.map((sample) => {
        const speed = wind(Date.parse(sample.validAt));
        return {
          ...sample,
          value:
            sample.value === null || speed === null
              ? null
              : windChillC(sample.value, speed * 3.6),
        };
      })
    : samples(weatherDescriptors.feelsLikeTemperature);
  const amount = samples(weatherDescriptors.precipitationAmount).filter(
    (s) =>
      s.time.kind === 'period' &&
      s.time.aggregation === 'accumulation' &&
      Date.parse(s.time.range.end) - Date.parse(s.time.range.start) === HOUR,
  );
  return {
    air: compileTemperature(air),
    feelsLike: compileTemperature(feelsLike),
    hasFeelsLike: feelsLike.some((sample) => sample.value !== null),
    feelsLikeBasis: derived ? ('derived' as const) : ('provider' as const),
    precipitationAmount: compileSeries(amount),
  };
};
type DisplayWeather = ReturnType<typeof compileDisplayWeather>;

/** Raw calendar-month values, unlike the mid-month interpolation used by scoring. */
export const usualClimateFor = (route: Route, date: string) => {
  const month = Temporal.PlainDate.from(date).month;
  let covered = 0;
  let high = 0;
  let low = 0;
  for (const leg of route.legs) {
    const cell = climateCellAt(leg.coordinate);
    const maximum = cell?.maximumC[month - 1];
    const minimum = cell?.minimumC[month - 1];
    if (maximum === undefined || minimum === undefined) continue;
    const distance = leg.toM - leg.fromM;
    covered += distance;
    high += maximum * distance;
    low += minimum * distance;
  }
  return covered === 0
    ? null
    : {
        month,
        averageHighC: tenth(high / covered),
        averageLowC: tenth(low / covered),
        bandHalfWidthC: 2.5,
        method: 'monthly-diurnal-estimate' as const,
        coveredDistanceFraction: Math.min(1, covered / route.distanceM),
        source: displayClimateSource,
      };
};
type UsualClimate = ReturnType<typeof usualClimateFor>;

export const usualTemperatureC = (hour: number, low: number, high: number) => {
  const fraction =
    hour < 5 || hour > 21
      ? 0
      : hour <= 15
        ? (1 - Math.cos((Math.PI * (hour - 5)) / 10)) / 2
        : (1 + Math.cos((Math.PI * (hour - 15)) / 6)) / 2;
  return low + (high - low) * fraction;
};
export const usualTemperatureAt = (
  at: number,
  usual: NonNullable<UsualClimate>,
  timeZone: string,
) => {
  const local = Temporal.Instant.fromEpochMilliseconds(
    Math.trunc(at),
  ).toZonedDateTimeISO(timeZone);
  return usualTemperatureC(
    local.hour +
      local.minute / 60 +
      local.second / 3600 +
      local.millisecond / HOUR,
    usual.averageLowC,
    usual.averageHighC,
  );
};

type ValuePoint = { at: number; value: number | null };
/** Integrate piecewise-linear evidence, never bridge an unknown interval. */
export const timeWeightedMean = (
  points: readonly ValuePoint[],
): number | null => {
  let integral = 0;
  let duration = 0;
  for (let i = 1; i < points.length; i++) {
    const left = points[i - 1];
    const right = points[i];
    if (!left || !right || left.value === null || right.value === null)
      return null;
    const span = right.at - left.at;
    integral += ((left.value + right.value) / 2) * span;
    duration += span;
  }
  return duration > 0 ? integral / duration : null;
};
export type TemperaturePoint = [
  minutes: number,
  airC: number | null,
  feelsLikeC: number | null,
  usualC: number | null,
];

/** Materialize only returned departures. Work is bounded by route sections and
 * hourly knots, not all searched slots or every second of a ride. */
export const temperatureAlongRideFor = (
  route: Route,
  departure: number,
  finish: number,
  weather: ReadonlyMap<string, DisplayWeather>,
  usual: UsualClimate,
  timeZone: string,
) => {
  const duration = finish - departure;
  const sections = route.legs.map((leg) => ({
    start: departure + (duration * leg.fromM) / route.distanceM,
    end: departure + (duration * leg.toM) / route.distanceM,
    weather: weather.get(leg.weatherLocationId),
  }));
  const hasFeelsLike = sections.some(
    (section) => section.weather?.hasFeelsLike,
  );
  type Section = (typeof sections)[number];
  type Reading = {
    at: number;
    air: number | null;
    feels: number | null;
    basis: DisplayWeather['feelsLikeBasis'] | null;
  };
  const reading = (section: Section | undefined, at: number): Reading => ({
    at,
    air: section?.weather?.air.at(at) ?? null,
    feels: section?.weather?.feelsLike.at(at) ?? null,
    basis: section?.weather?.feelsLikeBasis ?? null,
  });
  const readings = new Map<number, Reading>();
  const put = (point: Reading) => readings.set(point.at, point);
  const at = (time: number) =>
    reading(
      time === finish
        ? sections.at(-1)
        : sections.find((s) => s.start <= time && time < s.end),
      time,
    );
  const regular: ValuePoint[] = [];
  for (let time = departure; time < finish; time += 10 * MINUTE) {
    put(at(time));
    regular.push({
      at: time,
      value: usual ? usualTemperatureAt(time, usual, timeZone) : null,
    });
  }
  put(at(finish));
  regular.push({
    at: finish,
    value: usual ? usualTemperatureAt(finish, usual, timeZone) : null,
  });
  const extrema: Partial<
    Record<'airMin' | 'airMax' | 'feelsMin' | 'feelsMax', Reading>
  > = {};
  const bases = new Set<DisplayWeather['feelsLikeBasis']>();
  // One break per contiguous gap, regardless of how many route legs it spans.
  const missingMask = (point: Reading) =>
    Number(point.air === null) +
    2 * Number(point.feels === null && hasFeelsLike);
  let previous: Reading | undefined;
  let airIntegral = 0;
  let airComplete = true;
  for (const section of sections) {
    const times = [
      ...new Set(
        [
          section.start,
          section.end,
          ...(section.weather?.air.sampleTimes ?? []),
          ...(section.weather?.feelsLike.sampleTimes ?? []),
        ].filter((time) => time >= section.start && time <= section.end),
      ),
    ].sort((a, b) => a - b);
    // Exact samples on both ends of a long/missing bracket do not cover its interior.
    for (let i = times.length - 1; i > 0; i--) {
      const middle = ((times[i - 1] ?? 0) + (times[i] ?? 0)) / 2;
      const value = reading(section, middle);
      if (value.air === null || value.feels === null)
        times.splice(i, 0, middle);
    }
    const evidence = times.map((time) => reading(section, time));
    const mean = timeWeightedMean(
      evidence.map((p) => ({ at: p.at, value: p.air })),
    );
    if (mean === null) airComplete = false;
    else airIntegral += mean * (section.end - section.start);
    for (const value of evidence) {
      // Keep the outgoing section's left limit distinct from the entering section
      // at a discontinuity. The at-most-1ms offset is only a chart timestamp.
      const point =
        value.at === section.end && section.end < finish
          ? {
              ...value,
              at: value.at - Math.min(1, (section.end - section.start) / 2),
            }
          : value;
      if (point.feels !== null && point.basis) bases.add(point.basis);
      for (const [field, min, max] of [
        ['air', 'airMin', 'airMax'],
        ['feels', 'feelsMin', 'feelsMax'],
      ] as const) {
        const v = point[field];
        if (v === null) continue;
        if (v < (extrema[min]?.[field] ?? Infinity)) extrema[min] = point;
        if (v > (extrema[max]?.[field] ?? -Infinity)) extrema[max] = point;
      }
      const mask = missingMask(point);
      const before = previous ? missingMask(previous) : 0;
      if (mask !== before) {
        if (previous && mask !== 0) put(previous);
        put(point);
      }
      previous = point;
    }
  }
  for (const point of Object.values(extrema)) put(point);
  const usualMean = usual ? timeWeightedMean(regular) : null;
  return {
    points: [...readings.values()]
      .sort((a, b) => a.at - b.at)
      .map(
        (point): TemperaturePoint => [
          (point.at - departure) / MINUTE,
          rounded(point.air),
          rounded(point.feels),
          usual ? tenth(usualTemperatureAt(point.at, usual, timeZone)) : null,
        ],
      ),
    feelsLikeBasis:
      bases.size === 0
        ? null
        : bases.size === 1
          ? ([...bases][0] ?? null)
          : ('mixed' as const),
    usual: usual
      ? {
          ...usual,
          differenceC:
            airComplete && usualMean !== null && duration > 0
              ? tenth(airIntegral / duration - usualMean)
              : null,
        }
      : null,
  };
};
