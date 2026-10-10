import { browser } from 'wxt/browser';
import type {
  Climbing,
  PreferencesPatch,
  Recommendations,
  RouteSummary,
  Selection,
  User,
  WeatherProvider,
} from './types';

export type Tab = 'rides' | 'when' | 'prefs';
export type Provider = 'google' | 'apple';

export type Preset = 'today' | 'tomorrow' | 'weekend' | 'next';
// Presets stay relative to today; picked days are absolute and can expire.
export type Days =
  | { kind: 'preset'; preset: Preset }
  | { kind: 'range'; start: string; end: string };
export type Planning = {
  days: Days;
  time: { mode: 'daylight' | 'custom'; start: string; end: string };
};
export const DEFAULT_PLANNING: Planning = {
  days: { kind: 'preset', preset: 'next' },
  time: { mode: 'daylight', start: '08:00', end: '14:00' },
};

// Distance and climbing for this search only, as typed; null follows the profile.
export type Search = {
  climbing: Climbing;
  mode: 'none' | 'range';
  from: string;
  to: string;
};

// ponytail: the API can't store these yet (docs/extension-api-brief-v2.md), so they live in this browser.
export type LocalPrefs = {
  sunshine: "Don't mind" | 'Nice to have' | 'Important';
  rain: "Don't mind" | 'Prefer dry' | 'Strongly prefer dry';
  favourTailwinds: boolean;
  // Last values of each limit, so switching one off and on again loses nothing.
  floorMode: 'fixed' | 'monthly';
  floorFixedC: number;
  floorMonthsC: number[];
  rainPct: number;
  gustKph: number;
};
export const DEFAULT_LOCAL: LocalPrefs = {
  sunshine: 'Nice to have',
  rain: 'Prefer dry',
  favourTailwinds: true,
  floorMode: 'fixed',
  floorFixedC: 3,
  floorMonthsC: [0, 0, 2, 4, 6, 8, 10, 10, 7, 5, 2, 0],
  rainPct: 50,
  gustKph: 45,
};

// One shared view state. The background owns writes; popup and page render it.
export type State = {
  auth: 'signed-out' | 'signing-in' | 'signed-in';
  signingInWith: Provider | null;
  signInError: string | null;
  user: User | null;
  selection: Selection | null;
  routes: Record<string, RouteSummary>; // cycle-travel imports by API route ID
  providers: WeatherProvider[];
  planning: Planning;
  defaultPlanning: Planning | null;
  search: Search | null;
  unit: 'km' | 'mi';
  local: LocalPrefs;
  days: Record<string, Recommendations>; // one response per date
  recsKey: string | null; // what `days` was fetched for
  recsAt: string | null;
  loading: boolean;
  error: string | null;
  syncing: boolean;
  syncedAt: string | null;
  syncError: string | null;
  popupTab: Tab | null; // set when the page asks the popup to open on a tab
};

export const initialState: State = {
  auth: 'signed-out',
  signingInWith: null,
  signInError: null,
  user: null,
  selection: null,
  routes: {},
  providers: [],
  planning: DEFAULT_PLANNING,
  defaultPlanning: null,
  search: null,
  unit: 'km',
  local: DEFAULT_LOCAL,
  days: {},
  recsKey: null,
  recsAt: null,
  loading: false,
  error: null,
  syncing: false,
  syncedAt: null,
  syncError: null,
  popupTab: null,
};

const withDefaults = (state: Partial<State> | undefined): State => ({
  ...initialState,
  ...state,
  local: { ...DEFAULT_LOCAL, ...state?.local },
});

export const readState = async (): Promise<State> =>
  withDefaults(
    (await browser.storage.local.get('state')).state as Partial<State>,
  );

export const onStateChange = (listener: (state: State) => void) => {
  const handle = (changes: Record<string, { newValue?: unknown }>) => {
    if (changes.state) listener(withDefaults(changes.state.newValue as State));
  };
  browser.storage.local.onChanged.addListener(handle);
  return () => browser.storage.local.onChanged.removeListener(handle);
};

export type Message =
  | { type: 'signIn'; provider: Provider }
  | { type: 'signOut' }
  | { type: 'refresh' }
  | { type: 'setPlanning'; planning: Planning }
  | { type: 'saveDefaultPlanning' }
  | { type: 'setSearch'; search: Search | null }
  | { type: 'saveUsual'; search: Search }
  | { type: 'setUnit'; unit: 'km' | 'mi' }
  | { type: 'setLocal'; local: Partial<LocalPrefs> }
  | { type: 'savePreferences'; preferences: PreferencesPatch }
  | { type: 'setWeather'; providerId: string }
  | { type: 'import'; journey: JourneyGpx; track: boolean }
  | { type: 'untrack'; routeId: string }
  | { type: 'openPopup'; tab: Tab }
  | { type: 'setTab'; tab: Tab | null };

export type JourneyGpx = {
  externalId: string;
  name: string;
  gpx: string;
  updatedAt: number; // cycle.travel's updated_at, to spot edits
};

export const send = (message: Message): Promise<{ error?: string }> =>
  browser.runtime.sendMessage(message);
