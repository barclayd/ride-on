// Live API contracts (v0.11.0): worker/src/recommendations/input.ts, docs/api.md and docs/ride-history.md.
// Fields the extension needs but the API lacks are in docs/extension-api-brief-v2.md and -v3.md.

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
export type RecentRides = {
  mode: 'neutral' | 'prefer-variety';
  lookbackDays: number;
};
export type Preferences = {
  temperature: { comfortMinC: number; comfortMaxC: number };
  wind: { comfortableHeadwindKph: number; comfortableCrosswindKph: number };
  climbing: { preference: Climbing };
  distance: Distance | null;
  minimumStandards: MinimumStandards;
  recentRides?: RecentRides; // materialised by v0.11; absent on older responses
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
  recentRides?: { mode: RecentRides['mode'] }; // lookbackDays keeps the API default
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

// What the rider was shown for a ride (docs/extension-api-brief-v3.md §1); null until the API stores it.
export type RidePlan = {
  departureAt: string;
  finishAt: string;
  conditions: Conditions;
  pickRank: number | null;
};
// POST/GET /rides
export type Ride = {
  id: string;
  version: number;
  routeId: string;
  route: {
    id: string;
    name: string;
    version: number;
    distanceM: number;
    ascentM: number | null;
  };
  riddenOn: string;
  timeZone: string;
  recordedAt: string;
  updatedAt: string;
  plan?: RidePlan | null;
};

// POST /recommendations/next-windows (docs/extension-api-brief-v3.md §2)
export type NextWindow = {
  kind: 'tomorrow' | 'same_weekday' | 'best_this_week';
  date: string;
  window: Window | 'daylight';
  effectiveWindow: Window | null;
  best: {
    routeId: string;
    departureAt: string;
    finishAt: string;
    score: number;
    conditions: Conditions;
  };
};
export type NextWindows = {
  timeZone: string;
  windows: NextWindow[];
  weather: Recommendations['weather'];
};

export const MAX_TRACKED = 12;
