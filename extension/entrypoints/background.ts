import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { ApiError, api, getToken, setToken } from '../lib/api';
import { SignInCancelled, signIn } from '../lib/auth';
import {
  initialState,
  type JourneyGpx,
  type Message,
  readState,
  type State,
} from '../lib/state';
import {
  DEFAULT_PLANNING,
  MAX_TRACKED,
  type Planning,
  type PreferencesPatch,
  type Recommendations,
  type RouteSummary,
  type Selection,
  type User,
} from '../lib/types';

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
    return await api<User>('/users/me');
  } catch (error) {
    if (!(error instanceof ApiError && error.code === 'USER_NOT_FOUND'))
      throw error;
    const me = await api<{ user: { name?: string | null } }>('/auth/me');
    return api<User>('/users', {
      body: { displayName: me.user.name?.trim() || 'Rider' },
    });
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

// The profile in storage carries the rider's latest planning pick, even while a PATCH is in flight.
const keepLocalPlanning = (fresh: User, state: State): User => ({
  ...fresh,
  settings: {
    ...fresh.settings,
    planning: state.user?.settings.planning ?? fresh.settings.planning,
  },
});

const patchUser = async (settings: Record<string, unknown>) => {
  const send = (expectedVersion: number) =>
    api<User>('/users/me', {
      method: 'PATCH',
      body: { expectedVersion, settings },
    });
  const { user } = await readState();
  let fresh: User;
  try {
    fresh = await send(user?.version ?? 1);
  } catch (error) {
    if (!isConflict(error)) throw error;
    fresh = await send((await api<User>('/users/me')).version);
  }
  await update((state) => ({ user: keepLocalPlanning(fresh, state) }));
};

let recommendation = 0;
const recommend = async () => {
  const id = ++recommendation;
  const { user, selection } = await readState();
  if (!user || !selection?.routeIds.length)
    return update(() => ({ recs: null, loading: false }));
  const planning = user.settings.planning ?? DEFAULT_PLANNING;
  await update(() => ({ loading: true }));
  try {
    const recs = await api<Recommendations>('/recommendations', {
      body: {
        routeIds: selection.routeIds,
        days: planning.days,
        riding: { window: planning.window },
      },
    });
    if (id === recommendation)
      await update(() => ({
        recs,
        recsAt: new Date().toISOString(),
        loading: false,
        error: null,
      }));
  } catch (error) {
    // Keep the last results on screen; the error chip says what failed.
    if (id === recommendation)
      await update(() => ({ loading: false, error: errorMessage(error) }));
    throw error;
  }
};

const refresh = async () => {
  if (!(await getToken())) {
    // Only a lost token signs out; keep a sign-in error or an in-flight sign-in on screen.
    if ((await readState()).auth === 'signed-in') await signOutLocally();
    return;
  }
  const [user, selection, routes] = await Promise.all([
    loadUser(),
    loadSelection(),
    loadRoutes(),
  ]);
  await update((state) => ({
    auth: 'signed-in',
    user: keepLocalPlanning(user, state),
    selection,
    routes,
    error: null,
  }));
  await recommend();
};

let planningTimer: ReturnType<typeof setTimeout> | undefined;
const setPlanning = async (planning: Planning) => {
  await update((state) =>
    state.user
      ? {
          user: {
            ...state.user,
            settings: { ...state.user.settings, planning },
          },
        }
      : {},
  );
  clearTimeout(planningTimer);
  // ponytail: in-memory debounce; the worker lives 30s past the last event, ample for 600ms.
  planningTimer = setTimeout(
    () =>
      patchUser({ planning }).catch((error) =>
        update(() => ({ error: errorMessage(error) })),
      ),
    600,
  );
  await recommend();
};

const savePreferences = async (patch: PreferencesPatch) => {
  await patchUser(patch);
  await recommend();
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
      return setPlanning(message.planning);
    case 'savePreferences':
      return savePreferences(message.patch);
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
  // A worker restart abandons any sign-in window; don't leave the popup spinning.
  update((state) =>
    state.auth === 'signing-in'
      ? { auth: 'signed-out', signingInWith: null }
      : {},
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
