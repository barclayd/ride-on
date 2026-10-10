import type {
  ForecastDescriptor,
  ForecastSample,
  LocationForecastResult,
  Provenance,
} from './contracts.ts';
import { descriptorKey } from './descriptors.ts';

type Interval = { start: number; end: number };
export const intersectIntervals = (
  a: readonly Interval[],
  b: readonly Interval[],
): Interval[] => {
  const result: Interval[] = [];
  let i = 0,
    j = 0;
  while (i < a.length && j < b.length) {
    const x = a[i],
      y = b[j];
    if (!x || !y) break;
    const start = Math.max(x.start, y.start),
      end = Math.min(x.end, y.end);
    if (start < end) result.push({ start, end });
    if (x.end < y.end) i++;
    else j++;
  }
  return result;
};
const sampleIntervals = (samples: readonly ForecastSample[]) => {
  const intervals = samples
    .filter((s) => s.value !== null)
    .map((s) =>
      s.time.kind === 'period' &&
      (s.time.aggregation !== 'mean' ||
        Date.parse(s.time.range.end) - Date.parse(s.time.range.start) >=
          3_600_000)
        ? {
            start: Date.parse(s.time.range.start),
            end: Date.parse(s.time.range.end),
          }
        : {
            start: Date.parse(s.validAt) - 1_800_000,
            end: Date.parse(s.validAt) + 1_800_000,
          },
    )
    .sort((a, b) => a.start - b.start);
  const merged: Interval[] = [];
  for (const interval of intervals) {
    const last = merged.at(-1);
    if (last && interval.start <= last.end)
      last.end = Math.max(last.end, interval.end);
    else merged.push({ ...interval });
  }
  return merged;
};
export const forecastIntervals = (
  result: LocationForecastResult | undefined,
  required: readonly ForecastDescriptor[],
) => {
  if (
    !result ||
    result.status === 'unavailable' ||
    result.issues.some((i) =>
      [
        'stale-data',
        'invalid-response',
        'outside-coverage',
        'insufficient-resolution',
      ].includes(i.code),
    )
  )
    return [];
  let intervals: Interval[] = [{ start: -Infinity, end: Infinity }];
  for (const descriptor of required) {
    const series = result.series.find(
      (s) => descriptorKey(s.descriptor) === descriptorKey(descriptor),
    );
    intervals = intersectIntervals(
      intervals,
      sampleIntervals(series?.samples ?? []),
    );
  }
  return intervals;
};
export const summarizeProvenance = (
  results: readonly LocationForecastResult[],
) => {
  const provenance = results.flatMap((r) =>
    r.status === 'unavailable' ? [] : [r.provenance],
  );
  const times = provenance
    .map((p) => p.retrievedAt)
    .sort((a, b) => Date.parse(a) - Date.parse(b));
  const attributions = new Map<string, Provenance['attribution'][number]>();
  for (const p of provenance)
    for (const a of p.attribution)
      attributions.set(
        JSON.stringify([
          a.text,
          a.url,
          a.logo?.lightUrl,
          a.logo?.darkUrl,
          a.notice,
        ]),
        a,
      );
  return {
    retrieval: { oldestAt: times[0] ?? null, latestAt: times.at(-1) ?? null },
    attribution: [...attributions.values()],
  };
};
