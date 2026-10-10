import type { Settings } from '../recommendations/input.ts';
import type { Env } from '../types.ts';
import {
  appleWeatherAttribution,
  createAppleWeather,
  parseAppleWeatherConfig,
} from './apple-weather.ts';
import type { ForecastCache } from './cache.ts';
import type { ForecastProvider, Provenance } from './contracts.ts';
import { createMetOfficeBpf } from './met-office-bpf.ts';
import { createMetOfficeGlobalSpot } from './met-office-global-spot.ts';

type Registration = {
  id: string;
  name: string;
  forecastHorizonHours: number;
  attribution: Provenance['attribution'];
  recommendedSettings: Pick<Settings, 'weather' | 'forecast'>;
  configured: (env: Env) => boolean;
  create: (env: Env, cache: ForecastCache, now: () => Date) => ForecastProvider;
};
/** Product presets keep provider and statistic selection together for every client. */
const registrations: readonly Registration[] = [
  {
    id: 'apple-weather',
    name: 'Apple Weather',
    forecastHorizonHours: 240,
    attribution: [appleWeatherAttribution],
    recommendedSettings: {
      weather: { mode: 'strict', providerId: 'apple-weather' },
      forecast: {
        representation: 'deterministic',
        freshnessBasis: 'retrieval-time',
      },
    },
    configured: (env) =>
      parseAppleWeatherConfig(env.APPLE_WEATHER_CONFIG_JSON) !== null,
    create: (env, _cache, now) =>
      createAppleWeather({ config: env.APPLE_WEATHER_CONFIG_JSON, now }),
  },
  {
    id: 'met-office',
    name: 'Met Office Global Spot',
    forecastHorizonHours: 48,
    attribution: [
      {
        text: 'Powered by Met Office data',
        url: 'https://www.metoffice.gov.uk/',
      },
    ],
    recommendedSettings: {
      weather: { mode: 'strict', providerId: 'met-office' },
      forecast: {
        representation: 'deterministic',
        freshnessBasis: 'model-run',
      },
    },
    configured: (env) => Boolean(env.MET_OFFICE_API_KEY?.trim()),
    create: (env, _cache, now) =>
      createMetOfficeGlobalSpot({ apiKey: env.MET_OFFICE_API_KEY ?? '', now }),
  },
  {
    id: 'met-office-bpf',
    name: 'Met Office Blended Probabilistic',
    forecastHorizonHours: 120,
    attribution: [
      {
        text: 'Powered by Met Office data',
        url: 'https://www.metoffice.gov.uk/',
      },
    ],
    recommendedSettings: {
      weather: { mode: 'strict', providerId: 'met-office-bpf' },
      forecast: {
        representation: 'ensemble-summary',
        freshnessBasis: 'retrieval-time',
      },
    },
    configured: (env) => Boolean(env.MET_OFFICE_BPF_API_KEY?.trim()),
    create: (env, cache, now) =>
      createMetOfficeBpf({
        apiKey: env.MET_OFFICE_BPF_API_KEY ?? '',
        now,
        cache,
      }),
  },
];
export const describeWeatherProviders = (env: Env) =>
  registrations.map((r) => ({
    id: r.id,
    name: r.name,
    forecastHorizonHours: r.forecastHorizonHours,
    configured: r.configured(env),
    recommendedSettings: r.recommendedSettings,
    attribution: r.attribution,
  }));
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
