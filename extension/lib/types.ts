// API contracts: docs/api.md plus docs/extension-api-brief.md (fields marked "brief").

export type ClockWindow = { start: string; end: string };
export type Preset = 'today' | 'tomorrow' | 'weekend' | 'next';
export type PlanningDays =
  | { kind: 'preset'; preset: Preset }
  | { kind: 'range'; start: string; end: string };
export type Planning = { days: PlanningDays; window: ClockWindow };

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
};
export type Temperature = { comfortMinC: number; comfortMaxC: number };

export type Sunshine = 'dont-mind' | 'nice' | 'important';
export type Rain = 'avoid' | 'light-ok' | 'dont-mind';
export type Climbing = 'flatter' | 'neutral' | 'hillier';
export type PreferenceLevels = {
  sunshine: Sunshine | 'custom';
  rain: Rain | 'custom';
  climbing: Climbing;
  comfortableWindKph: number;
};

export type User = {
  id: string;
  version: number;
  displayName: string;
  settings: {
    timeZone: string;
    planning?: Planning; // brief §2
    preferences: {
      temperature: Temperature;
      wind: { comfortableHeadwindKph: number };
      minimumStandards: MinimumStandards;
    };
  };
  preferenceLevels?: PreferenceLevels; // brief §4
};

export type PreferencesPatch = {
  preferenceLevels?: Partial<Omit<PreferenceLevels, 'sunshine' | 'rain'>> & {
    sunshine?: Sunshine;
    rain?: Rain;
  };
  preferences?: {
    temperature?: Partial<Temperature>;
    minimumStandards?: MinimumStandards;
  };
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

export type Conditions = {
  temperatureC: { minimum: number; maximum: number };
  averageWindSpeedKph: number;
  averageHeadwindKph: number;
  averageTailwindKph: number;
  averageCrosswindKph: number;
  maximumPrecipitationProbability: number;
};
export type Departure = {
  date?: string; // brief §3
  departureAt: string;
  finishAt: string;
  score: number;
  conditions: Conditions;
  drawbacks: string[];
};
export type Verdict = {
  status: 'ride' | 'no_ride' | 'unknown';
  reason: string | null;
};
export type RankedRoute = {
  routeId: string;
  routeName: string;
  distanceKm: number;
  best: Departure | null;
  issues: string[];
  confidence?: 1 | 2 | 3; // brief §3
  verdict?: Verdict; // brief §3
};
export type DaySummary = {
  date: string;
  daylight: { sunrise: string; sunset: string } | null;
  temperatureMaxC: number | null;
  quality: number | null;
};
export type Recommendations = {
  message: string;
  rankings: RankedRoute[];
  unranked: RankedRoute[];
  range?: {
    start: string;
    end: string;
    preset: Preset | null;
    fallback: boolean;
  } | null; // brief §3
  days?: DaySummary[]; // brief §3
};

export const DEFAULT_PLANNING: Planning = {
  days: { kind: 'preset', preset: 'next' },
  window: { start: '06:00', end: '20:00' },
};
export const MAX_TRACKED = 12;
