import type { Env } from '../types.ts';
import {
  appleWeatherAttribution,
  createAppleWeather,
  parseAppleWeatherConfig,
} from './apple-weather.ts';
import type { ForecastCache } from './cache.ts';
import { weatherProviderChoices, weatherProviderIds } from './choices.ts';
import type { ForecastProvider, Provenance } from './contracts.ts';
import { createMetOfficeBpf } from './met-office-bpf.ts';
import { createMetOfficeGlobalSpot } from './met-office-global-spot.ts';

type Registration = {
  id: string;
  forecastHorizonHours: number;
  attribution: Provenance['attribution'];
  configured: (env: Env) => boolean;
  create: (env: Env, cache: ForecastCache, now: () => Date) => ForecastProvider;
};
/** Internal product registrations retain their stable source/cache identities. */
const registrations: readonly Registration[] = [
  {
    id: 'apple-weather',
    forecastHorizonHours: 240,
    attribution: [appleWeatherAttribution],
    configured: (env) =>
      parseAppleWeatherConfig(env.APPLE_WEATHER_CONFIG_JSON) !== null,
    create: (env, _cache, now) =>
      createAppleWeather({ config: env.APPLE_WEATHER_CONFIG_JSON, now }),
  },
  {
    id: 'met-office',
    forecastHorizonHours: 48,
    attribution: [
      {
        text: 'Powered by Met Office data',
        url: 'https://www.metoffice.gov.uk/',
      },
    ],
    configured: (env) => Boolean(env.MET_OFFICE_API_KEY?.trim()),
    create: (env, _cache, now) =>
      createMetOfficeGlobalSpot({ apiKey: env.MET_OFFICE_API_KEY ?? '', now }),
  },
  {
    id: 'met-office-bpf',
    forecastHorizonHours: 120,
    attribution: [
      {
        text: 'Powered by Met Office data',
        url: 'https://www.metoffice.gov.uk/',
      },
    ],
    configured: (env) => Boolean(env.MET_OFFICE_BPF_API_KEY?.trim()),
    create: (env, cache, now) =>
      createMetOfficeBpf({
        apiKey: env.MET_OFFICE_BPF_API_KEY ?? '',
        now,
        cache,
      }),
  },
];
/** The discovery endpoint is a user choice catalogue, not an adapter inventory. */
export const describeWeatherProviders = (env: Env) =>
  weatherProviderIds.map((id) => {
    const choice = weatherProviderChoices[id];
    const product = registrations.find(
      (r) => r.id === choice.settings.weather.providerId,
    );
    if (!product) throw new Error('Weather choice has no registered product.');
    return {
      id,
      name: choice.name,
      forecastHorizonHours: product.forecastHorizonHours,
      configured: product.configured(env),
      // Retain paired presets for existing clients; new clients need only the choice ID.
      recommendedSettings: choice.settings,
      attribution: product.attribution,
    };
  });
export const createWeatherProviders = (
  env: Env,
  cache: ForecastCache,
  now: () => Date,
): Readonly<Record<string, ForecastProvider>> =>
  Object.fromEntries(
    registrations.map((r) => [r.id, r.create(env, cache, now)]),
  );

/** Advertised product capability, not a claim about available evidence. */
export const forecastHorizonHours = (providerId: string) =>
  registrations.find((r) => r.id === providerId)?.forecastHorizonHours;
