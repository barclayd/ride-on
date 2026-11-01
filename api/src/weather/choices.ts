import type { WeatherSourcePolicy } from './contracts.ts';

/** User-facing providers are separate from technical forecast products. A choice
 * resolves to one compatible source/statistic/freshness preset, never a mix of
 * whichever product happens to return the most favourable weather. */
export const weatherProviderIds = ['apple-weather', 'met-office'] as const;
export type WeatherProviderId = (typeof weatherProviderIds)[number];
export const weatherProviderChoices = {
  'apple-weather': {
    name: 'Apple Weather',
    sourceIds: ['apple-weather'],
    settings: {
      weather: { mode: 'strict', providerId: 'apple-weather' },
      forecast: {
        representation: 'deterministic',
        freshnessBasis: 'retrieval-time',
      },
    },
  },
  'met-office': {
    name: 'Met Office',
    sourceIds: ['met-office', 'met-office-bpf'],
    settings: {
      weather: { mode: 'strict', providerId: 'met-office-bpf' },
      forecast: {
        representation: 'ensemble-summary',
        freshnessBasis: 'retrieval-time',
      },
    },
  },
} as const;

/** A provider choice that runs out of quota hands the whole comparison to this one. */
export const quotaFallbackProviderId: WeatherProviderId = 'apple-weather';

export const weatherProviderForSource = (sourceId: string | undefined) => {
  const id = weatherProviderIds.find((id) =>
    (weatherProviderChoices[id].sourceIds as readonly string[]).includes(
      sourceId ?? '',
    ),
  );
  return id ? { id, name: weatherProviderChoices[id].name } : null;
};
/** An advanced multi-provider policy is not falsely presented as one selection. */
export const weatherProviderIdForPolicy = (policy: WeatherSourcePolicy) =>
  policy.mode === 'strict'
    ? (weatherProviderForSource(policy.providerId)?.id ?? null)
    : null;
