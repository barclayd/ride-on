import { browser } from 'wxt/browser';
import type {
  Attribution,
  Climbing,
  Conditions,
  NextWindows,
  PreferencesPatch,
  Recommendations,
  Ride,
  RideSummary,
  RouteSummary,
  Selection,
  User,
  WeatherProvider,
} from './types';

export type Tab = 'rides' | 'when' | 'prefs' | 'history';
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
  rain: "Don't mind" | 'Prefer dry';
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
  floorMode: 'fixed',
  floorFixedC: 3,
  floorMonthsC: [0, 0, 2, 4, 6, 8, 10, 10, 7, 5, 2, 0],
  rainPct: 50,
  gustKph: 45,
};

// A ranked ride as shown: rank 1 is the top pick.
export type Pick = {
  routeId: string;
  date: string; // the departure's local day
  departureAt: string;
  finishAt: string;
  conditions: Conditions;
  rank: number;
};
// The window the rider last saw, kept to notice when it has ended.
export type Shown = {
  dates: [string, string];
  time: Planning['time'];
  endsAt: string; // UTC instant the last day's window ends
  picks: Pick[];
  meta: PlanMeta;
};
// The response the picks came from, sent with a logged ride's plan.
export type PlanMeta = {
  generatedAt: string;
  algorithmVersion: string;
  attribution: Attribution[];
};
// "Did you ride …?" for an ended window, until answered.
export type Checkin = {
  date: string; // the top pick's day, which the ride is logged on
  picks: Pick[];
  meta: PlanMeta;
  status: 'ask' | 'done' | 'conflict'; // conflict: the route changed since the plan
  routeId: string | null; // the route being logged, or logged once done
  rideId: string | null;
  key: string | null; // Idempotency-Key for routeId, kept so a retry can't log twice
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
  recs: Recommendations | null; // across the planned days, plus a 7-day preview for the strip
  recsAt: string | null;
  loading: boolean;
  error: string | null;
  syncing: boolean;
  syncedAt: string | null;
  syncError: string | null;
  popupTab: Tab | null; // set when the page asks the popup to open on a tab
  shown: Shown | null;
  expired: Shown | null; // set once the shown window ends, until new dates are picked
  checkin: Checkin | null;
  next: NextWindows | null; // suggestions while expired
  rides: Ride[]; // newest first
  ridesCursor: string | null;
  summaries: Record<string, RideSummary>; // by route ID, for ride tags
  pendingDeletes: { id: string; at: number }[]; // removed in History, sent after the undo window
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
  recs: null,
  recsAt: null,
  loading: false,
  error: null,
  syncing: false,
  syncedAt: null,
  syncError: null,
  popupTab: null,
  shown: null,
  expired: null,
  checkin: null,
  next: null,
  rides: [],
  ridesCursor: null,
  summaries: {},
  pendingDeletes: [],
};

const withDefaults = (state: Partial<State> | undefined): State => {
  const local = { ...DEFAULT_LOCAL, ...state?.local };
  // ponytail: 'Strongly prefer dry' was dropped; older saves show as 'Prefer dry'. Delete once no such install remains.
  if (local.rain !== "Don't mind") local.rain = 'Prefer dry';
  return { ...initialState, ...state, local };
};

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
  | { type: 'signInRedirect'; url: string }
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
  | { type: 'setTab'; tab: Tab | null }
  | { type: 'checkin'; answer: 'yes'; routeId: string }
  | { type: 'checkin'; answer: 'no' | 'undo' | 'updated' }
  | { type: 'deleteRide'; id: string }
  | { type: 'undoDelete'; id: string }
  | { type: 'moreRides' };

export type JourneyGpx = {
  externalId: string;
  name: string;
  gpx: string;
  updatedAt: number; // cycle.travel's updated_at, to spot edits
};

export const send = (message: Message): Promise<{ error?: string }> =>
  browser.runtime.sendMessage(message);
