import type { ForecastDescriptor } from './contracts.ts';

/** Provider-neutral vocabulary; precipitation includes rain, snow and other forms. */
export const weatherDescriptors = {
  skyCondition: {
    kind: 'category',
    quantity: 'sky-condition',
    vocabulary: 'sky-condition-v1',
    basis: 'provider-weather-symbol',
  },
  totalCloudCover: {
    kind: 'scalar',
    measure: { quantity: 'total-cloud-cover', unit: 'fraction' },
    statistic: { kind: 'deterministic' },
  },
  airTemperature: {
    kind: 'scalar',
    measure: { quantity: 'air-temperature', unit: 'celsius' },
    statistic: { kind: 'deterministic' },
  },
  feelsLikeTemperature: {
    kind: 'scalar',
    measure: { quantity: 'feels-like-temperature', unit: 'celsius' },
    statistic: { kind: 'deterministic' },
  },
  windSpeed: {
    kind: 'scalar',
    measure: { quantity: 'wind-speed', unit: 'm/s' },
    statistic: { kind: 'deterministic' },
  },
  windDirection: {
    kind: 'scalar',
    measure: { quantity: 'wind-from-direction', unit: 'degrees' },
    statistic: { kind: 'deterministic' },
  },
  windGust: {
    kind: 'scalar',
    measure: { quantity: 'wind-gust', unit: 'm/s' },
    statistic: { kind: 'deterministic' },
  },
  precipitationAmount: {
    kind: 'scalar',
    measure: { quantity: 'precipitation-amount', unit: 'mm' },
    statistic: { kind: 'deterministic' },
  },
  precipitationRate: {
    kind: 'scalar',
    measure: { quantity: 'precipitation-rate', unit: 'mm/h' },
    statistic: { kind: 'deterministic' },
  },
  precipitationProbability: {
    kind: 'probability',
    event: {
      kind: 'occurrence',
      phenomenon: 'precipitation',
      definition:
        'Provider-defined precipitation occurrence; numeric threshold unspecified.',
    },
    unit: 'fraction',
  },
} as const satisfies Record<string, ForecastDescriptor>;

/** Compare meaning, independent of object property order. */
export const descriptorKey = (descriptor: ForecastDescriptor): string => {
  if (descriptor.kind === 'category')
    return JSON.stringify([
      'category',
      descriptor.quantity,
      descriptor.vocabulary,
      descriptor.basis,
    ]);
  if (descriptor.kind === 'scalar') {
    return JSON.stringify([
      'scalar',
      descriptor.measure.quantity,
      descriptor.measure.unit,
      descriptor.statistic.kind,
      descriptor.statistic.kind === 'percentile'
        ? descriptor.statistic.percentile
        : null,
    ]);
  }
  const event = descriptor.event;
  return JSON.stringify(
    event.kind === 'threshold'
      ? [
          'probability',
          descriptor.unit,
          'threshold',
          event.measure.quantity,
          event.measure.unit,
          event.comparison,
          event.threshold,
        ]
      : [
          'probability',
          descriptor.unit,
          'occurrence',
          event.phenomenon,
          event.definition,
        ],
  );
};

/** Marginal medians plus ensemble-mean wind direction, not a joint weather scenario. */
export const ensembleDescriptors = {
  skyCondition: weatherDescriptors.skyCondition,
  airTemperature: {
    ...weatherDescriptors.airTemperature,
    statistic: { kind: 'percentile', percentile: 50 },
  },
  windSpeed: {
    ...weatherDescriptors.windSpeed,
    statistic: { kind: 'percentile', percentile: 50 },
  },
  windDirection: {
    ...weatherDescriptors.windDirection,
    statistic: { kind: 'ensemble-mean' },
  },
  windGust: {
    ...weatherDescriptors.windGust,
    statistic: { kind: 'percentile', percentile: 50 },
  },
  precipitationRate: {
    ...weatherDescriptors.precipitationRate,
    statistic: { kind: 'percentile', percentile: 50 },
  },
  totalCloudCover: {
    ...weatherDescriptors.totalCloudCover,
    statistic: { kind: 'percentile', percentile: 50 },
  },
  precipitationProbability: {
    kind: 'probability',
    unit: 'fraction',
    event: {
      kind: 'threshold',
      measure: { quantity: 'precipitation-amount', unit: 'mm' },
      comparison: 'above',
      threshold: 0,
    },
  },
} as const satisfies Record<string, ForecastDescriptor>;
