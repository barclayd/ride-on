import type { ForecastSample } from '../weather/contracts.ts';

const HOUR = 3_600_000;

/** Only instantaneous temperatures may be interpolated. Never bridge a missing
 * reading, a coarser-than-hourly interval, or the edge of the available forecast. */
export const compileTemperature = (samples: readonly ForecastSample[]) => {
  const points = samples.map((sample) => ({
    at: Date.parse(sample.validAt),
    value: sample.time.kind === 'instant' ? sample.value : null,
  }));
  const indexAt = (at: number) => {
    let low = 0;
    let high = points.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if ((points[mid]?.at ?? Infinity) < at) low = mid + 1;
      else high = mid;
    }
    return low;
  };
  const valueAt = (at: number): number | null => {
    const index = indexAt(at);
    const right = points[index];
    if (right?.at === at) return right.value;
    const left = points[index - 1];
    if (
      left?.value == null ||
      right?.value == null ||
      right.at - left.at > HOUR ||
      right.at <= left.at
    )
      return null;
    return (
      left.value +
      ((right.value - left.value) * (at - left.at)) / (right.at - left.at)
    );
  };
  const range = (start: number, end: number) => {
    const times = [start];
    for (let i = indexAt(start); i < points.length; i++) {
      const point = points[i];
      if (!point || point.at >= end) break;
      if (point.at > start) times.push(point.at);
    }
    times.push(end);
    const values = times.map((at) => ({ at, value: valueAt(at) }));
    // Check each span as well as its ends: exact samples on either side of a
    // two-hour gap do not make the intervening ride assessable.
    if (
      values.some(
        (point, i) =>
          point.value === null ||
          (i > 0 &&
            valueAt((point.at + (values[i - 1]?.at ?? point.at)) / 2) === null),
      )
    )
      return null;
    const available = values.flatMap((point) =>
      point.value === null ? [] : [{ at: point.at, value: point.value }],
    );
    const first = available[0];
    if (!first) return null;
    return {
      minimum: available.reduce((a, b) => (b.value < a.value ? b : a), first),
      maximum: available.reduce((a, b) => (b.value > a.value ? b : a), first),
    };
  };
  return { at: valueAt, range, sampleTimes: points.map((point) => point.at) };
};
