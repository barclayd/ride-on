import type { ForecastSample } from '../weather/contracts.ts';

const HOUR = 3_600_000;

/** Compile timestamps once; all departure comparisons reuse these lookups. */
export const compileSeries = (samples: readonly ForecastSample[]) => {
  const indexed = samples.map((sample) => ({
    validAt: Date.parse(sample.validAt),
    value: sample.value,
    period:
      sample.time.kind === 'period' &&
      (sample.time.aggregation !== 'mean' ||
        Date.parse(sample.time.range.end) -
          Date.parse(sample.time.range.start) >=
          HOUR)
        ? {
            start: Date.parse(sample.time.range.start),
            end: Date.parse(sample.time.range.end),
          }
        : null,
  }));
  return (at: number): number | null => {
    let low = 0;
    let high = indexed.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if ((indexed[mid]?.validAt ?? Infinity) < at) low = mid + 1;
      else high = mid;
    }
    let nearest: (typeof indexed)[number] | undefined;
    for (
      let index = Math.max(0, low - 1);
      index < Math.min(indexed.length, low + 2);
      index++
    ) {
      const sample = indexed[index];
      if (!sample) continue;
      if (sample.period) {
        if (sample.period.start <= at && at < sample.period.end)
          return sample.value;
      } else if (
        !nearest ||
        Math.abs(sample.validAt - at) < Math.abs(nearest.validAt - at)
      )
        nearest = sample;
    }
    return nearest && Math.abs(nearest.validAt - at) <= HOUR / 2
      ? nearest.value
      : null;
  };
};
/** Native period bounds for events, maxima and full-hour means; nearest validity for instants / short wind means. */
export const sampleAt = (
  samples: readonly ForecastSample[],
  at: number,
): number | null => compileSeries(samples)(at);
