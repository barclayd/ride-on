// Live API contracts (v0.9.0): worker/src/recommendations/input.ts and docs/api.md.
// Fields the extension needs but the API lacks are in docs/extension-api-brief-v2.md.

export type Climbing = 'flatter' | 'neutral' | 'hillier';
export type Distance = { minKm: number; maxKm: number };
export type TemperatureFloor =
  | { kind: 'fixed'; valueC: number }
  | {
      kind: 'monthly';
      valuesC: Record<string, number>;
      fallbackC: number | null;
    };
export type MinimumStandards = {
  minimumTemperature?: TemperatureFloor;
  maximumGustKph?: number;
  maximumPrecipitationProbability?: number;
  maximumPrecipitationRateMmH?: number;
};
export type Preferences = {
  temperature: { comfortMinC: number; comfortMaxC: number };
  wind: { comfortableHeadwindKph: number; comfortableCrosswindKph: number };
  climbing: { preference: Climbing };
  distance: Distance | null;
  minimumStandards: MinimumStandards;
};
export type WeatherSource =
  | { mode: 'strict'; providerId: string }
  | { mode: 'ordered-fallback'; providerIds: string[] };
export type ForecastPolicy = {
  representation: 'deterministic' | 'ensemble-summary';
  freshnessBasis: 'model-run' | 'retrieval-time';
};
// Shown wherever a provider's data is (Apple requires the logo and legal link).
export type Attribution = {
  text: string;
  url: string;
  logo?: { lightUrl: string; darkUrl: string };
  notice?: string;
};
// GET /weather-providers
export type WeatherProvider = {
  id: string;
  name: string;
  configured: boolean;
  recommendedSettings: { weather: WeatherSource; forecast: ForecastPolicy };
  attribution: Attribution[];
};

export type User = {
  id: string;
  version: number;
  displayName: string;
  settings: {
    timeZone: string;
    preferences: Preferences;
    weather: WeatherSource;
    forecast?: ForecastPolicy;
  };
};

// PATCH /users/me settings and the per-request override: null removes distance or one minimum.
export type PreferencesPatch = {
  temperature?: Partial<Preferences['temperature']>;
  wind?: Partial<Preferences['wind']>;
  climbing?: { preference: Climbing };
  distance?: Distance | null;
  minimumStandards?: {
    [K in keyof MinimumStandards]?: MinimumStandards[K] | null;
  };
};
export type SettingsPatch = {
  preferences?: PreferencesPatch;
  weather?: WeatherSource;
  forecast?: ForecastPolicy;
};

export type RouteSummary = {
  id: string;
  name: string;
  distanceM: number;
  source: { providerId: string; externalId: string } | null;
  version: number;
  updatedAt: string;
};
export type Selection = {
  version: number;
  routeIds: string[];
  updatedAt: string | null;
};

export type Standard =
  | 'minimumTemperatureC'
  | 'maximumGustKph'
  | 'maximumPrecipitationProbability'
  | 'maximumPrecipitationRateMmH';
export type Failure = {
  standard: Standard;
  limit: number;
  actual: number;
  sections: { fromKm: number; toKm: number; observedAt: string }[];
};
export type Conditions = {
  temperatureC: { minimum: number; maximum: number };
  averageWindSpeedKph: number;
  averageHeadwindKph: number;
  averageTailwindKph: number;
  averageCrosswindKph: number;
  maximumPrecipitationProbability: number;
};
export type Departure = {
  departureAt: string;
  finishAt: string;
  score: number;
  standards: {
    status: 'meets' | 'below' | 'unknown' | 'not_configured';
    failures: Failure[];
  };
  conditions: Conditions;
};
export type Window = { start: string; end: string };
export type RouteResult = {
  routeId: string;
  routeName: string;
  distanceKm: number;
  distanceFit: {
    status: 'within_range' | 'below_range' | 'above_range';
    deviationKm: number;
  } | null;
  estimatedDurationMinutes: number;
  daylight: Window | null;
  effectiveWindow: Window | null;
  status: 'assessed' | 'unassessable' | 'no_feasible_departure';
  departuresUnknown: number;
  departuresStandardsUnknown: number;
  best: Departure | null;
  issues: string[];
  warnings: string[];
};
export type StandardsStatus =
  | 'not_configured'
  | 'match_found'
  | 'unknown'
  | 'none_meet'
  | 'no_feasible_departure';
export type Recommendations = {
  date: string;
  recommendedRouteId: string | null;
  minimumStandardsStatus: StandardsStatus;
  rankings: RouteResult[];
  unranked: RouteResult[];
  weather: {
    locations: {
      provenance?: { retrievedAt: string; attribution?: Attribution[] } | null;
    }[];
  };
};

export const MAX_TRACKED = 12;
