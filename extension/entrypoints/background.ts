import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { ApiError, api, getToken, setToken } from '../lib/api';
import { SignInCancelled, signIn } from '../lib/auth';
import {
  DEFAULT_PLANNING,
  initialState,
  type JourneyGpx,
  type Message,
  readState,
  type State,
} from '../lib/state';
import {
  MAX_TRACKED,
  type PreferencesPatch,
  type Recommendations,
  type RouteSummary,
  type Selection,
  type SettingsPatch,
  type User,
  type WeatherProvider,
} from '../lib/types';
import { applyPatch, availability, localDate, searchPatch } from '../ui/format';

// Serialise read-modify-write so concurrent handlers never drop each other's changes.
let writes = Promise.resolve();
const update = (patch: (state: State) => Partial<State>) => {
  writes = writes.then(async () => {
    const state = await readState();
    await browser.storage.local.set({ state: { ...state, ...patch(state) } });
  });
  return writes;
};

const signOutLocally = async (signInError: string | null = null) => {
  await setToken(null);
  await browser.storage.local.remove('seen');
  await update(() => ({ ...initialState, signInError }));
};

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'Something went wrong.';

const isConflict = (error: unknown) =>
  error instanceof ApiError && error.status === 409;

const loadUser = async () => {
  try {
    return (await api<{ user: User }>('/users/me')).user;
  } catch (error) {
    if (!(error instanceof ApiError && error.code === 'USER_NOT_FOUND'))
      throw error;
    const me = await api<{ user: { name?: string | null } }>('/auth/me');
    return (
      await api<{ user: User }>('/users', {
        body: { displayName: me.user.name?.trim() || 'Rider' },
      })
    ).user;
  }
};

const loadRoutes = async () => {
  const routes: Record<string, RouteSummary> = {};
  let cursor: string | null = null;
  do {
    const page: { routes: RouteSummary[]; nextCursor: string | null } =
      await api(
        `/routes?sourceProviderId=cycle-travel&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      );
    for (const route of page.routes) routes[route.id] = route;
    cursor = page.nextCursor;
  } while (cursor);
  return routes;
};

const loadSelection = async () =>
  (await api<{ selection: Selection }>('/route-selection')).selection;

const withPreferences = (user: User, patch: PreferencesPatch | null): User =>
  patch
    ? {
        ...user,
        settings: {
          ...user.settings,
          preferences: applyPatch(user.settings.preferences, patch),
        },
      }
    : user;

// Edits not yet sent; the profile in storage shows them before the PATCH lands.
let pendingPatch: PreferencesPatch | null = null;

const patchUser = async (settings: SettingsPatch) => {
  const send = (expectedVersion: number) =>
    api<{ user: User }>('/users/me', {
      method: 'PATCH',
      body: { expectedVersion, settings },
    });
  const { user } = await readState();
  let fresh: { user: User };
  try {
    fresh = await send(user?.version ?? 1);
  } catch (error) {
    if (!isConflict(error)) throw error;
    // ponytail: last write wins; the Preferences tab always sends the full set it owns.
    fresh = await send((await api<{ user: User }>('/users/me')).user.version);
  }
  await update(() => ({
    user: withPreferences(fresh.user, pendingPatch),
    syncedAt: new Date().toISOString(),
  }));
};

// One request per forecast day; the selected days are merged in the view (ui/format.ts).
let recommendation = 0;
const recommend = async (force = false) => {
  const id = ++recommendation;
  const state = await readState();
  const { user, selection } = state;
  if (!user || !selection?.routeIds.length)
    return update(() => ({ days: {}, recsKey: null, loading: false }));
  const { time } = state.planning;
  const window =
    time.mode === 'daylight'
      ? 'daylight'
      : { start: time.start, end: time.end };
  const preferences = state.search
    ? searchPatch(state.search, state.unit)
    : undefined;
  const key = JSON.stringify([
    selection.routeIds,
    window,
    preferences,
    user.version,
  ]);
  const today = localDate(new Date(), user.settings.timeZone);
  const kept =
    force || key !== state.recsKey
      ? {}
      : Object.fromEntries(
          Object.entries(state.days).filter(([date]) => date >= today),
        );
  const dates = availability(
    new Date(),
    user.settings.timeZone,
    user.settings.weather,
  )
    .filter((day) => day.kind !== 'none' && !kept[day.date])
    .map((day) => day.date);
  if (!dates.length)
    return update(() => ({ days: kept, recsKey: key, loading: false }));
  await update(() => ({ loading: true }));
  const settled = await Promise.allSettled(
    dates.map((date) =>
      api<Recommendations>('/recommendations', {
        body: {
          routeIds: selection.routeIds,
          date,
          riding: { window },
          ...(preferences && { preferences }),
        },
      }),
    ),
  );
  if (id !== recommendation) return;
  const fetched = settled.flatMap((r) =>
    r.status === 'fulfilled' ? [r.value] : [],
  );
  const failed = settled.find((r) => r.status === 'rejected')?.reason;
  if (!fetched.length) {
    // Keep the last results on screen; the error chip says what failed.
    await update(() => ({ loading: false, error: errorMessage(failed) }));
    throw failed;
  }
  await update(() => ({
    days: {
      ...kept,
      ...Object.fromEntries(fetched.map((recs) => [recs.date, recs])),
    },
    recsKey: key,
    recsAt: new Date().toISOString(),
    loading: false,
    error: failed ? errorMessage(failed) : null,
  }));
};

// Optional: without it the picker shows only the saved source.
const loadProviders = () =>
  api<{ providers: WeatherProvider[] }>('/weather-providers')
    .then((r) => r.providers)
    .catch(() => []);

const refresh = async () => {
  if (!(await getToken())) {
    // Only a lost token signs out; keep a sign-in error or an in-flight sign-in on screen.
    if ((await readState()).auth === 'signed-in') await signOutLocally();
    return;
  }
  const [user, selection, routes, providers] = await Promise.all([
    loadUser(),
    loadSelection(),
    loadRoutes(),
    loadProviders(),
  ]);
  await update((state) => ({
    auth: 'signed-in',
    // An unsent edit outranks the stored profile until its PATCH lands.
    user: withPreferences(user, pendingPatch),
    selection,
    routes,
    providers,
    error: null,
    syncedAt: pendingPatch ? state.syncedAt : new Date().toISOString(),
  }));
  await recommend(true);
};

let syncTimer: ReturnType<typeof setTimeout> | undefined;
const flush = async () => {
  const preferences = pendingPatch;
  if (!preferences) return;
  pendingPatch = null;
  try {
    await patchUser({ preferences });
  } catch (error) {
    // Newer edits made while this PATCH was in flight win.
    pendingPatch = {
      ...preferences,
      ...(pendingPatch as PreferencesPatch | null),
    };
    if (error instanceof ApiError && error.status === 401)
      return signOutLocally();
    return update(() => ({ syncing: false, syncError: errorMessage(error) }));
  }
  await update(() => ({ syncing: pendingPatch !== null }));
  await recommend().catch(() => {}); // recommend records its own error
};

const savePreferences = async (patch: PreferencesPatch) => {
  // Shallow merge is enough: each sender includes every field of the sections it touches.
  pendingPatch = { ...pendingPatch, ...patch };
  await update((state) => ({
    syncing: true,
    syncError: null,
    user: state.user && withPreferences(state.user, patch),
  }));
  clearTimeout(syncTimer);
  // ponytail: in-memory debounce; the worker lives 30s past the last event, ample for 900ms.
  syncTimer = setTimeout(flush, 900);
};

const putSelection = async (change: (routeIds: string[]) => string[]) => {
  const send = (selection: Selection) =>
    api<{ selection: Selection }>('/route-selection', {
      method: 'PUT',
      body: {
        expectedVersion: selection.version,
        routeIds: change(selection.routeIds),
      },
    });
  const { selection } = await readState();
  let result: { selection: Selection };
  try {
    result = await send(selection ?? (await loadSelection()));
  } catch (error) {
    if (!isConflict(error)) throw error;
    result = await send(await loadSelection());
  }
  await update(() => ({ selection: result.selection }));
};

const seen = async () =>
  ((await browser.storage.local.get('seen')).seen ?? {}) as Record<
    string,
    number
  >;

const importJourney = async (journey: JourneyGpx) => {
  const findRoute = (routes: Record<string, RouteSummary>) =>
    Object.values(routes).find(
      (route) => route.source?.externalId === journey.externalId,
    );
  const known = findRoute((await readState()).routes);
  if (known && (await seen())[journey.externalId] === journey.updatedAt)
    return known;
  const send = (existing?: RouteSummary) =>
    api<{ route: RouteSummary }>('/route-imports', {
      body: {
        source: { providerId: 'cycle-travel', externalId: journey.externalId },
        gpx: journey.gpx,
        name: journey.name,
        expectedVersion: existing?.version,
      },
    });
  let route: RouteSummary;
  try {
    route = (await send(known)).route;
  } catch (error) {
    // Edited on cycle.travel, or imported elsewhere since this browser last looked.
    if (!isConflict(error)) throw error;
    const routes = await loadRoutes();
    await update(() => ({ routes }));
    route = (await send(findRoute(routes))).route;
  }
  await browser.storage.local.set({
    seen: { ...(await seen()), [journey.externalId]: journey.updatedAt },
  });
  await update((state) => ({ routes: { ...state.routes, [route.id]: route } }));
  return route;
};

const handle = async (message: Message) => {
  switch (message.type) {
    case 'signIn':
      await update(() => ({
        auth: 'signing-in',
        signingInWith: message.provider,
        signInError: null,
      }));
      try {
        await signIn(message.provider);
      } catch (error) {
        return update(() => ({
          auth: 'signed-out',
          signingInWith: null,
          signInError:
            error instanceof SignInCancelled
              ? 'Sign-in was cancelled. Try again.'
              : 'Sign-in failed. Try again.',
        }));
      }
      await update(() => ({ auth: 'signed-in', signingInWith: null }));
      return refresh();
    case 'signOut':
      await api('/api/auth/sign-out', { body: {} }).catch(() => {});
      return signOutLocally();
    case 'refresh':
      return refresh();
    case 'setPlanning':
      await update(() => ({ planning: message.planning }));
      return recommend();
    case 'saveDefaultPlanning':
      return update((state) => ({ defaultPlanning: state.planning }));
    case 'setSearch':
      await update(() => ({ search: message.search }));
      return recommend();
    case 'saveUsual': {
      const { unit } = await readState();
      await update(() => ({ search: null }));
      return savePreferences(searchPatch(message.search, unit));
    }
    case 'setUnit':
      return update(() => ({ unit: message.unit }));
    case 'setLocal':
      return update((state) => ({
        local: { ...state.local, ...message.local },
      }));
    case 'savePreferences':
      return savePreferences(message.preferences);
    case 'setWeather': {
      const provider = (await readState()).providers.find(
        (p) => p.id === message.providerId,
      );
      if (!provider) return;
      await update(() => ({ syncing: true, syncError: null }));
      try {
        // ponytail: always saved to the profile; a for-this-search choice waits on the brief.
        await patchUser(provider.recommendedSettings);
      } catch (error) {
        return update(() => ({
          syncing: false,
          syncError: errorMessage(error),
        }));
      }
      await update(() => ({ syncing: pendingPatch !== null }));
      return recommend();
    }
    case 'import': {
      const route = await importJourney(message.journey);
      if (!message.track) return;
      await putSelection((ids) =>
        ids.includes(route.id) || ids.length >= MAX_TRACKED
          ? ids
          : [...ids, route.id],
      );
      return recommend();
    }
    case 'untrack':
      await putSelection((ids) => ids.filter((id) => id !== message.routeId));
      return recommend();
    case 'openPopup':
      await update(() => ({ popupTab: message.tab }));
      // Chrome 127+; without a focused window it throws and the page keeps its state.
      return browser.action.openPopup().catch(() => {});
    case 'setTab':
      return update(() => ({ popupTab: message.tab }));
  }
};

export default defineBackground(() => {
  // A worker restart abandons any sign-in window or unsent edit; don't leave either spinning.
  update((state) => ({
    syncing: false,
    ...(state.auth === 'signing-in' && {
      auth: 'signed-out',
      signingInWith: null,
    }),
  }));
  // ponytail: builds up to 0.1.0 kept the token in storage.local; drop it (costs one sign-in).
  // Delete once no such install remains.
  browser.runtime.onInstalled.addListener(() =>
    browser.storage.local.remove('token'),
  );
  // ponytail: a browser restart starts from the saved default window and the usual
  // preferences, until the API can store planning (docs/extension-api-brief-v2.md).
  browser.runtime.onStartup.addListener(() =>
    update((state) => ({
      planning: state.defaultPlanning ?? DEFAULT_PLANNING,
      search: null,
    })),
  );
  browser.runtime.onMessage.addListener(
    (message: Message, _sender, sendResponse) => {
      handle(message).then(
        () => sendResponse({}),
        async (error) => {
          if (error instanceof ApiError && error.status === 401)
            await signOutLocally();
          sendResponse({ error: errorMessage(error) });
        },
      );
      return true;
    },
  );
});
