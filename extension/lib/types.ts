// Live API contracts (v0.12.0): worker/src/recommendations/input.ts, docs/api.md and docs/ride-history.md.
// Fields the extension needs but the API lacks are in docs/extension-api-brief-v2.md, -v3.md and -v4.md.
import type { SurfaceInput } from './surface';

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
  maximumTemperatureC?: number;
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
  wind: {
    comfortableHeadwindKph: number;
    comfortableCrosswindKph: number;
    comfortableGustKph?: number;
    preferTailwind?: boolean; // v0.24; absent reads as false (calm), like the API
  };
  climbing: { preference: Climbing };
  distance: Distance | null;
  minimumStandards: MinimumStandards;
  recentRides?: RecentRides; // materialised by v0.11; absent on older responses
};
// Derived by the API from the saved weights; 'custom' when they match no preset (planning-api.md).
export type Levels = {
  sunshine: 'dont-mind' | 'nice' | 'important' | 'custom';
  rain: 'dont-mind' | 'light-ok' | 'avoid' | 'custom';
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
  attribution: Attribution[];
};

// API 0.34: Ride On paused on the profile, so every device follows. until is the local day it turns
// back on and resumesAt its 00:00 in the profile's zone; both null until the rider turns it back on.
export type Pause = {
  until: string | null;
  resumesAt: string | null;
  pausedAt?: string; // absent on a pause made here and not yet saved
};

export type User = {
  id: string;
  version: number;
  displayName: string;
  pause?: Pause | null; // null when on; absent before API 0.34
  // The public picker choice; null for an advanced fallback/custom policy.
  weatherProviderId: string | null;
  preferenceLevels?: Levels; // absent on users saved before 0.19
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
  preferenceLevels?: {
    [K in keyof Levels]?: Exclude<Levels[K], 'custom'>;
  };
  weatherProviderId?: string;
};

export type RouteSummary = {
  id: string;
  name: string;
  distanceM: number;
  source: { providerId: string; externalId: string } | null;
  version: number;
  updatedAt: string;
  surfaceSummary?: {
    status: 'complete' | 'partial' | 'unavailable';
    pavedM: number;
    unpavedM: number;
    nonCyclingM: number;
    unknownM: number;
    classifiedFraction: number;
    unpavedFraction: number | null;
    source: SurfaceInput['source'] | null;
    capturedAt: string | null;
  };
};
export type Selection = {
  version: number;
  routeIds: string[];
  updatedAt: string | null;
};

export type Standard =
  | 'minimumTemperatureC'
  | 'maximumTemperatureC'
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
  maximumPrecipitationRateMmH?: number;
  // docs/extension-api-brief-v9.md: the wettest hour where the rider is, in mm; absent before it ships.
  maximumPrecipitationAmountMm?: number;
  precipitationAmountBasis?: 'hourly-accumulation' | 'rate-estimate' | 'mixed';
  maximumGustKph?: number;
  gustExposure?: {
    directionBasis: 'prevailing-wind-estimate';
    maximumAdverseKph: number;
  };
  // docs/extension-api-brief-v4.md; absent before it ships and on older saved plans.
  windDistanceFractions?: {
    headwind: number;
    tailwind: number;
    crosswind: number;
  };
  windFromDegrees?: number | null; // distance-weighted mean; null when calm or variable
  precipitationSummary?: PrecipitationSummary;
  // Share of route distance under each forecast symbol; null unless sunshine is weighed and every symbol is known.
  skyConditionDistanceFractions?: Record<
    'sunny' | 'sunnyIntervals' | 'cloudy' | 'overcast' | 'obscured',
    number
  > | null;
  // docs/extension-api-brief-v6.md: the same shares plus `unknown`, kept when part of the ride isn't forecast.
  skyConditionShares?: SkyShares | null;
  distanceKm?: number;
};
// Every sky category the API sends (sunny, cloudy, overcast…), each a share of distance.
export type SkyShares = Record<string, number> &
  Partial<Record<'sunny' | 'sunnyIntervals' | 'unknown', number>>;
export type PrecipitationSummary =
  | 'dry'
  | 'possible'
  | 'drizzle'
  | 'light_showers'
  | 'showers'
  | 'heavy_showers'
  | 'light_rain'
  | 'rain'
  | 'heavy_rain'
  | 'sleet'
  | 'hail'
  | 'snow'
  | 'thunder';
export type Departure = {
  recommendationRef?: string | null;
  trackingAvailability?: 'available' | 'unavailable';
  windAssistance?: {
    usefulDistanceFraction: number;
    potentialPoints: number;
    appliedPoints: number;
  };
  forecastDetails?: ForecastDetails;
  sunshineAssessment?: {
    status: 'complete' | 'partial' | 'unavailable';
    unknownDistanceFraction: number;
  } | null;
  // Elapsed ride hours in ride order; conditions null when no route sample falls in the hour.
  rideHours?: { start: string; end: string; conditions: Conditions | null }[];
  // docs/extension-api-brief-v7.md: contiguous stretches covering the route; absent before it ships.
  windStretches?: WindStretch[];
  // docs/extension-api-brief-v9.md: air and feels like through the ride; absent before it ships.
  temperatureAlongRide?: TemperatureAlongRide;
  // docs/tailwind-opportunity.md: ordering only, never shown as a number. Null when unranked.
  tailwindOpportunity?: { priorityPoints: number } | null;
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
// [minutesFromDeparture, airC, feelsLikeC, usualC]: every 10 minutes, the finish and the extremes.
export type TemperaturePoint = [
  number,
  number | null,
  number | null,
  number | null,
];
export type TemperatureAlongRide = {
  points: TemperaturePoint[];
  feelsLikeBasis: 'provider' | 'derived' | 'mixed' | null;
  // The month's usual temperature here; null outside the climate grid (the UK for now).
  usual: {
    month: number;
    averageHighC: number;
    averageLowC: number;
    bandHalfWidthC: number;
    differenceC: number | null; // null when the air trace has a gap
    method: string;
    coveredDistanceFraction: number;
    source: { attribution: string };
  } | null;
};
export type WindEffect = 'tailwind' | 'crosswind' | 'headwind' | 'light';
export type WindStretch = {
  fromM: number;
  toM: number;
  startAt: string;
  endAt: string;
  effect: WindEffect;
  windFromDegrees: number | null;
  averageWindSpeedKph: number;
  maximumAdverseGustKph: number;
};
// docs/extension-api-brief-v7.md: up to 64 points of [latitude, longitude, metres along the route].
export type Outline = { version: 1; points: [number, number, number][] };
type ForecastStatistic =
  | { kind: 'deterministic' | 'ensemble-mean' }
  | { kind: 'percentile'; percentile: number };
export type ForecastDetails = {
  temperatureMethod: 'linear-interpolation';
  locations: {
    source: { providerId: string; productId: string; adapterVersion: string };
    sourceLocationId: string | null;
    coordinate: { latitude: number; longitude: number };
    retrievedAt: string;
    forecastRunAt: string | null;
    temperatureStatistic: ForecastStatistic | null;
    gustStatistic: ForecastStatistic | null;
    routePeriods: { start: string; end: string }[];
    temperatures: { at: string; celsius: number | null }[];
    gusts: { start: string; end: string; maximumKph: number | null }[];
  }[];
};
export type Window = { start: string; end: string };
export type RouteResult = {
  routeId: string;
  routeName: string;
  distanceKm: number;
  outline?: Outline | null;
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
  refreshAt?: string | null; // v0.17: the forecast behind these scores goes stale then; null, ask again
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
  range: { start: string; end: string; dates: string[] } | null; // null when expired or nothing forecast yet
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
