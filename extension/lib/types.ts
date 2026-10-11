// Live API contracts (v0.12.0): worker/src/recommendations/input.ts, docs/api.md and docs/ride-history.md.
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
// ponytail: only the fields the extension reads; plans pass the API's full conditions through untouched.
export type Conditions = {
  temperatureC: { minimum: number; maximum: number };
  averageWindSpeedKph: number;
  averageHeadwindKph: number;
  averageTailwindKph: number;
  averageCrosswindKph: number;
  maximumPrecipitationProbability: number;
};
export type Departure = {
  date: string;
  departureAt: string;
  finishAt: string;
  score: number;
  standards: {
    status: 'meets' | 'below' | 'unknown' | 'not_configured';
    failures: Failure[];
  };
  conditions: Conditions;
  recentRides?: {
    status: 'disabled' | 'no_recent_history' | 'assessed' | 'unavailable';
    penaltyPoints: number;
  };
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
  verdict: {
    status: 'meets' | 'below_minimums' | 'doesnt_fit' | 'incomplete';
    code: string;
  };
};
export type StandardsStatus =
  | 'not_configured'
  | 'match_found'
  | 'unknown'
  | 'none_meet'
  | 'no_feasible_departure';
export type Weather = {
  retrieval: { latestAt: string | null };
  attribution: Attribution[];
};
// One forecast day, selected or preview.
export type DaySummary = {
  date: string;
  availability: 'full' | 'partial' | 'none';
  availabilityReason: string;
  until: string | null; // UTC; partial days covered up to here
  daylight: { sunrise: string; sunset: string } | null;
  temperatureMaxC: number | null;
  quality: number | null;
  selected: boolean;
};
export type RecommendationKind = 'best_pick' | 'best_available';
// POST /recommendations with `days`: one ranking across the selected dates.
export type Recommendations = {
  generatedAt: string;
  algorithmVersion: string;
  timeZone: string;
  minimumStandardsStatus: StandardsStatus;
  recommendation: { routeId: string; kind: RecommendationKind } | null;
  rankings: RouteResult[];
  unranked: RouteResult[];
  range: { start: string; end: string } | null; // null when expired or nothing forecast yet
  expired: boolean;
  days: DaySummary[];
  weather: Weather;
};

// What the rider was shown for a ride; checked strictly by POST /rides.
export type RidePlan = {
  schemaVersion: 1;
  departureAt: string;
  finishAt: string;
  conditions: Conditions;
  pickRank: number | null;
  generatedAt: string;
  algorithmVersion: string;
  weather: { attribution: Attribution[] };
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
// POST /rides/summaries
export type RideSummary = {
  routeId: string;
  rideCount: number;
  lastRiddenOn: string | null;
};

// POST /recommendations/next-windows
export type NextWindow = {
  kind: 'tomorrow' | 'same_weekday' | 'best_next_days';
  date: string;
  window: Window | 'daylight';
  effectiveWindow: Window | null;
  recommendationKind: RecommendationKind;
  warnings: string[];
  best: Departure & { routeId: string; routeName: string };
};
export type NextWindows = {
  generatedAt: string;
  algorithmVersion: string;
  timeZone: string;
  windows: NextWindow[];
  recommendedKind: NextWindow['kind'] | null;
  weather: Weather;
};

export const MAX_TRACKED = 12;
