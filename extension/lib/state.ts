import { browser } from 'wxt/browser';
import type {
  Planning,
  PreferencesPatch,
  Recommendations,
  RouteSummary,
  Selection,
  User,
} from './types';

export type Tab = 'when' | 'rides' | 'prefs';
export type Provider = 'google' | 'apple';

// One shared view state. The background owns writes; popup and page render it.
export type State = {
  auth: 'signed-out' | 'signing-in' | 'signed-in';
  signingInWith: Provider | null;
  signInError: string | null;
  user: User | null;
  selection: Selection | null;
  routes: Record<string, RouteSummary>; // cycle-travel imports by API route ID
  recs: Recommendations | null;
  recsAt: string | null;
  loading: boolean;
  error: string | null;
  popupTab: Tab | null; // set when the page asks the popup to open on a tab
};

export const initialState: State = {
  auth: 'signed-out',
  signingInWith: null,
  signInError: null,
  user: null,
  selection: null,
  routes: {},
  recs: null,
  recsAt: null,
  loading: false,
  error: null,
  popupTab: null,
};

export const readState = async (): Promise<State> => {
  const { state } = await browser.storage.local.get('state');
  return { ...initialState, ...(state as Partial<State> | undefined) };
};

export const onStateChange = (listener: (state: State) => void) => {
  const handle = (changes: Record<string, { newValue?: unknown }>) => {
    if (changes.state)
      listener({ ...initialState, ...(changes.state.newValue as State) });
  };
  browser.storage.local.onChanged.addListener(handle);
  return () => browser.storage.local.onChanged.removeListener(handle);
};

export type Message =
  | { type: 'signIn'; provider: Provider }
  | { type: 'signOut' }
  | { type: 'refresh' }
  | { type: 'setPlanning'; planning: Planning }
  | { type: 'savePreferences'; patch: PreferencesPatch }
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
