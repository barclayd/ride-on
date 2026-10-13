import type { Route } from '../routes/model.ts';
import type {
  ForecastDescriptor,
  LocationForecastResult,
} from '../weather/contracts.ts';
import { descriptorKey } from '../weather/descriptors.ts';

/** A bounded explanation of one ride, using its selected descriptors and the
 * existing snapshots. No new requests and no whole forecast-horizon export. */
export const forecastDetailsFor = (
  route: Route,
  ride: { departureAt: string; finishAt: string },
  forecasts: ReadonlyMap<string, LocationForecastResult>,
  required: readonly ForecastDescriptor[],
) => {
  const start = Date.parse(ride.departureAt);
  const duration = Date.parse(ride.finishAt) - start;
  type Forecast = Exclude<LocationForecastResult, { status: 'unavailable' }>;
  const sites = new Map<
    string,
    { forecast: Forecast; visits: { start: number; end: number }[] }
  >();
  for (const leg of route.legs) {
    const forecast = forecasts.get(leg.weatherLocationId);
    if (!forecast || forecast.status === 'unavailable') continue;
    const key = JSON.stringify([
      forecast.provenance.source,
      forecast.location.coordinate,
      forecast.location.sourceLocationId,
      forecast.provenance.retrievedAt,
    ]);
    const site = sites.get(key) ?? { forecast, visits: [] };
    const visit = {
      start: start + (duration * leg.fromM) / route.distanceM,
      end: start + (duration * leg.toM) / route.distanceM,
    };
    const previous = site.visits.at(-1);
    if (previous?.end === visit.start) previous.end = visit.end;
    else site.visits.push(visit);
    sites.set(key, site);
  }
  const requiredKeys = new Set(required.map(descriptorKey));
  return {
    temperatureMethod: 'linear-interpolation' as const,
    locations: [...sites.values()].map(({ forecast, visits }) => {
      const series = (quantity: 'air-temperature' | 'wind-gust') =>
        forecast.series.find(
          (s) =>
            s.descriptor.kind === 'scalar' &&
            s.descriptor.measure.quantity === quantity &&
            requiredKeys.has(descriptorKey(s.descriptor)),
        );
      const temperature = series('air-temperature');
      const gust = series('wind-gust');
      const statistic = (descriptor: ForecastDescriptor | undefined) =>
        descriptor?.kind === 'scalar' ? descriptor.statistic : null;
      return {
        source: forecast.provenance.source,
        sourceLocationId: forecast.location.sourceLocationId,
        coordinate: forecast.location.coordinate,
        retrievedAt: forecast.provenance.retrievedAt,
        forecastRunAt: forecast.provenance.forecastRunAt ?? null,
        temperatureStatistic: statistic(temperature?.descriptor),
        gustStatistic: statistic(gust?.descriptor),
        routePeriods: visits.map((v) => ({
          start: new Date(v.start).toISOString(),
          end: new Date(v.end).toISOString(),
        })),
        temperatures: (temperature?.samples ?? [])
          .filter((sample, index, samples) => {
            if (sample.time.kind !== 'instant') return false;
            const at = Date.parse(sample.validAt);
            const before = Date.parse(
              samples[index - 1]?.validAt ?? sample.validAt,
            );
            const after = Date.parse(
              samples[index + 1]?.validAt ?? sample.validAt,
            );
            return visits.some(
              (v) =>
                (at >= v.start && at <= v.end) ||
                (at < v.start && after > v.start) ||
                (at > v.end && before < v.end),
            );
          })
          .map((sample) => ({ at: sample.validAt, celsius: sample.value })),
        gusts: (gust?.samples ?? []).flatMap((sample) => {
          if (
            sample.time.kind !== 'period' ||
            sample.time.aggregation !== 'maximum'
          )
            return [];
          const period = sample.time.range;
          if (
            !visits.some(
              (v) =>
                Date.parse(period.start) < v.end &&
                Date.parse(period.end) > v.start,
            )
          )
            return [];
          return [
            {
              ...period,
              maximumKph:
                sample.value === null
                  ? null
                  : Math.round(sample.value * 360) / 100,
            },
          ];
        }),
      };
    }),
  };
};
