import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { ApiError, api, getToken, setSecret, setToken } from '../lib/api';
import {
  cancelSignIn,
  finishSignIn,
  pendingSignIn,
  SignInCancelled,
  signIn,
} from '../lib/auth';
import {
  disablePush,
  enablePush,
  installPushHandlers,
  pushStatus,
  SignedOutInApp,
} from '../lib/push';
import {
  DEFAULT_PLANNING,
  initialState,
  type JourneyGpx,
  type Message,
  type Pause,
  type Planning,
  readState,
  type State,
} from '../lib/state';
import { surfaceSeenKey } from '../lib/surface';
import {
  loadTracker,
  saveTrackedRide,
  saveTriggers,
  type Tracker,
} from '../lib/tracking';
import {
  type AlertTriggers,
  MAX_TRACKED,
  type NextWindows,
  type PreferencesPatch,
  type Recommendations,
  type Ride,
  type RidePlan,
  type RideSummary,
  type RouteSummary,
  type Selection,
  type SettingsPatch,
  type User,
  type WeatherProvider,
} from '../lib/types';
import {
  activePause,
  applyPatch,
  DEFAULT_LEVELS,
  ended,
  instant,
  logged,
  newest,
  pinDeparture,
  planFor,
  searchPatch,
  shownOf,
  zoneOf,
} from '../ui/format';

// Serialise read-modify-write so concurrent handlers never drop each other's changes.
let writes = Promise.resolve();
const update = (patch: (state: State) => Partial<State>) => {
  const write = writes.then(async () => {
    const state = await readState();
    await browser.storage.local.set({
      state: { ...state, ...patch(state) },
      stamp: crypto.randomUUID(), // what Safari's Journeys pages poll (useView)
    });
  });
  // One failed write mustn't skip every later one (loading would never clear).
  writes = write.catch(() => {});
  return write;
};

const signOutLocally = async (signInError: string | null = null) => {
  await disablePush().catch(() => {});
  await setSecret('track-action', null);
  await setToken(null);
  await browser.storage.local.remove('seen');
  await update(() => ({ ...initialState, signInError }));
};

// Resolves false while Safari's sign-in tab is still open; its redirect calls this again.
const signedIn = async (signing: Promise<boolean>) => {
  try {
    if (!(await signing)) return;
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

const windowOf = (time: Planning['time']) =>
  time.mode === 'daylight'
    ? ('daylight' as const)
    : { start: time.start, end: time.end };

// An extension update leaves open Journeys pages running the old copy, which no longer hears
// state changes, and neither browser injects the new one. Inject it wherever no copy answers;
// WXT then retires the old copy and its UI.
const revive = async () => {
  const tabs = await browser.tabs.query({
    url: 'https://cycle.travel/user/journeys*',
  });
  for (const { id } of tabs) {
    if (id === undefined) continue;
    const [check] = await browser.scripting
      .executeScript({
        target: { tabId: id },
        func: () =>
          (globalThis as { rideOnAlive?: () => boolean }).rideOnAlive?.() ===
          true,
      })
      .catch(() => []);
    if (!check?.result)
      await browser.scripting
        .executeScript({
          target: { tabId: id },
          files: ['/content-scripts/journeys.js'],
        })
        .catch(() => {});
  }
};

// One request across the planned days; previewDays fills the day strip. The key adds what the
// API reads besides the body: the saved profile and ride history.
const recRequest = (state: State) => {
  const { user, selection, planning } = state;
  if (!user || !selection?.routeIds.length) return null;
  const preferences = state.search
    ? searchPatch(state.search, state.unit)
    : undefined;
  // The API's "next" preset starts today; Next 5 days starts tomorrow, which is its next-five-days.
  const days =
    planning.days.kind === 'preset' && planning.days.preset === 'next'
      ? { kind: 'preset' as const, preset: 'next-five-days' as const }
      : planning.days;
  const body = {
    routeIds: selection.routeIds,
    days,
    previewDays: 7,
    riding: { window: windowOf(planning.time) },
    ...(preferences && { preferences }),
  };
  return {
    body,
    // Refresh persisted rankings that lack score changes.
    key: JSON.stringify([
      'comfort-v0.17',
      'api-0.36',
      body,
      user.id,
      user.version,
      state.rides[0]?.id,
      // Rankings keep the tracked departure (brief v13), so they follow the plan.
      ...(state.tracker.fixed
        ? [state.alertRouteId && state.tracker.ride?.id]
        : []),
    ]),
  };
};

// The scores on screen still hold: same request, and the API's forecast hasn't gone stale.
const current = (state: State) =>
  !!state.recsKey &&
  state.recsKey === recRequest(state)?.key &&
  Date.now() < Date.parse(state.recs?.weather.refreshAt ?? '');

const paused = async () => !!activePause((await readState()).pause, new Date());

let recommendation = 0;
const recommend = async () => {
  const id = ++recommendation;
  // Paused: no forecasts or scores until it turns back on.
  if (await paused()) return update(() => ({ loading: false }));
  const request = recRequest(await readState());
  if (!request)
    return update(() => ({ recs: null, loading: false, shown: null }));
  await update(() => ({ loading: true }));
  try {
    const recs = await api<Recommendations>('/recommendations', {
      body: request.body,
    });
    if (id !== recommendation) return;
    await show({
      recs,
      recsAt: new Date().toISOString(),
      recsKey: request.key,
      loading: false,
      error: null,
    });
  } catch (error) {
    if (id !== recommendation) return;
    // Keep the last results on screen; the error chip says what failed.
    await update(() => ({ loading: false, error: errorMessage(error) }));
    throw error;
  }
};

// Remember the window on screen for the check-in. One picked after it ended
// (08:00–14:00 at 15:20) goes straight to what's next, with no question.
const show = async (patch: Partial<State>) => {
  await update((state) => {
    const next = { ...state, ...patch };
    return { ...next, shown: shownOf(next, new Date()) };
  });
  const { shown } = await readState();
  if (shown && ended(shown, new Date())) return expire(false);
};

// While the shown window has ended: the next windows worth riding, in one call.
const suggest = async () => {
  const id = ++recommendation;
  if (await paused()) return update(() => ({ loading: false }));
  const { user, selection, expired, search, unit } = await readState();
  if (!user || !expired || !selection?.routeIds.length)
    return update(() => ({ next: null, loading: false }));
  const preferences = search ? searchPatch(search, unit) : undefined;
  await update(() => ({ loading: true }));
  try {
    const next = await api<NextWindows>('/recommendations/next-windows', {
      body: {
        routeIds: selection.routeIds,
        after: { date: expired.dates.at(-1), window: windowOf(expired.time) },
        ...(preferences && { preferences }),
      },
    });
    if (id !== recommendation) return;
    await update(() => ({
      next,
      loading: false,
      error: null,
      recsAt: new Date().toISOString(),
    }));
  } catch (error) {
    if (id !== recommendation) return;
    await update(() => ({ loading: false, error: errorMessage(error) }));
    throw error;
  }
};

const rank = async () =>
  (await readState()).expired ? suggest() : recommend();

// The window on screen has ended: ask about it (unless one of its picks was logged that day) and suggest what's next.
const expire = async (ask: boolean) => {
  await update((state) => {
    if (!state.shown) return {};
    const { picks, meta } = state.shown;
    // The ride with alerts is the one asked about (handoff v5), on its own day.
    const alert = picks.find((p) => p.routeId === state.alertRouteId);
    const date = (alert ?? picks[0])?.date;
    return {
      expired: state.shown,
      shown: null,
      next: null,
      checkin:
        ask && date && !logged(date, picks, state.rides)
          ? {
              date,
              picks,
              meta,
              status: 'ask',
              routeId: null,
              rideId: null,
              key: null,
              alert: alert?.routeId ?? null,
            }
          : state.checkin,
    };
  });
  return suggest();
};

const loadRides = (cursor: string | null = null) =>
  api<{ rides: Ride[]; nextCursor: string | null }>(
    `/rides?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
  );

// ponytail: the first 100 known routes (the API's limit); page when someone has more.
const loadSummaries = async () => {
  const routeIds = Object.keys((await readState()).routes).slice(0, 100);
  const { summaries } = routeIds.length
    ? await api<{ summaries: RideSummary[] }>('/rides/summaries', {
        body: { routeIds },
      })
    : { summaries: [] };
  await update(() => ({
    summaries: Object.fromEntries(summaries.map((s) => [s.routeId, s])),
  }));
};

// A retry with the same key replays the first POST, so it can't log twice.
const logRide = async (
  body: Pick<Ride, 'routeId' | 'riddenOn' | 'timeZone'> & {
    expectedRouteVersion: number;
    plan?: RidePlan;
  },
  key: string,
) => {
  const { ride } = await api<{ ride: Ride }>('/rides', {
    headers: { 'Idempotency-Key': key },
    body,
  });
  await update((state) => ({
    rides: [ride, ...state.rides.filter((r) => r.id !== ride.id)].sort(newest),
  }));
  return ride;
};

const deleteRide = async (id: string) => {
  await api(`/rides/${id}`, { method: 'DELETE' }).catch((error) => {
    if (!(error instanceof ApiError && error.status === 404)) throw error;
  });
  await update((state) => ({
    rides: state.rides.filter((ride) => ride.id !== id),
  }));
};

// Rides removed in History are sent once the undo window passes, or on the next wake
// if the panel closed first. A failed one stays pending and is retried then.
const UNDO_MS = 8000;
const commitDeletes = async (all = false) => {
  const due = (await readState()).pendingDeletes.filter(
    (d) => all || Date.now() - d.at >= UNDO_MS,
  );
  const settled = await Promise.allSettled(due.map((d) => deleteRide(d.id)));
  const done = due
    .filter((_, i) => settled[i].status === 'fulfilled')
    .map((d) => d.id);
  if (!done.length) return 0;
  await update((state) => ({
    pendingDeletes: state.pendingDeletes.filter((d) => !done.includes(d.id)),
    checkin:
      state.checkin?.rideId && done.includes(state.checkin.rideId)
        ? null
        : state.checkin,
  }));
  return done.length;
};

// Optional: without it the picker shows only the saved source.
const loadProviders = () =>
  api<{ providers: WeatherProvider[] }>('/weather-providers')
    .then((r) => r.providers)
    .catch(() => []);

// Opening the panel or page reuses current scores; the refresh button forces a new ranking.
const refresh = async (force = false) => {
  if (!(await getToken())) {
    // Only a lost token signs out; keep a sign-in error or an in-flight sign-in on screen.
    if ((await readState()).auth === 'signed-in') await signOutLocally();
    return;
  }
  await commitDeletes().catch(() => {});
  await pauseWrite; // read after a pause in flight, not before it lands
  const was = (await readState()).pause;
  const [user, selection, routes, providers, rides] = await Promise.all([
    loadUser(),
    loadSelection(),
    loadRoutes(),
    loadProviders(),
    // History only adds tags and the check-in; the panel works without it.
    loadRides().catch(() => null),
  ]);
  await update((state) => ({
    auth: 'signed-in',
    // An unsent edit outranks the stored profile until its PATCH lands.
    user: withPreferences(user, pendingPatch),
    pause: activePause(user.pause ?? null, new Date()),
    selection,
    routes,
    providers,
    error: null,
    syncedAt: pendingPatch ? state.syncedAt : new Date().toISOString(),
    ...(rides && { rides: rides.rides, ridesCursor: rides.nextCursor }),
    // A confirmation lasts until the panel next opens; a question until answered or a pick has a ride that day.
    checkin:
      state.checkin &&
      state.checkin.status !== 'done' &&
      !logged(
        state.checkin.date,
        state.checkin.picks,
        rides?.rides ?? state.rides,
      )
        ? state.checkin
        : null,
  }));
  const tags = loadSummaries().catch(() => {}); // tags only; the panel works without them
  // Rankings keep the tracked departure (brief v13): a plan changed on another device ranks again.
  const fixed = (await readState()).tracker.fixed;
  if (fixed) await syncTracking();
  const state = await readState();
  const { shown, expired, pause } = state;
  await armResume();
  // Paused: nothing to rank or ask about. Back on (its date, or another device), fresh scores.
  if (pause) recommendation++;
  else if (was) await resume();
  else if (!expired && shown && ended(shown, new Date())) await expire(true);
  else if (force || expired || !current(state)) await rank();
  await tags;
  if (!fixed) await syncTracking();
  await updatePushStatus();
};

// The pause is on the profile (API 0.34), so the rider's other devices follow. It shows here at
// once; the API's answer replaces it, and a failed write puts the last one back.
let pauseWrites = 0;
let pauseWrite: Promise<unknown> = Promise.resolve();
const savePause = (
  before: Pause | null,
  write: () => Promise<{ user: User }>,
) => {
  const id = ++pauseWrites;
  const run = pauseWrite.then(async () => {
    if (!(await getToken())) return;
    try {
      const { user } = await write();
      // A newer choice is already on screen and on its way.
      if (id === pauseWrites)
        await update(() => ({
          pause: activePause(user.pause ?? null, new Date()),
        }));
    } catch (error) {
      if (id === pauseWrites) {
        if (before) recommendation++; // back to paused: a ranking in flight is dropped
        await update(() => ({ pause: before }));
      }
      throw error; // the switch or link says it wasn't saved
    } finally {
      await armResume();
    }
  });
  pauseWrite = run.catch(() => {});
  return run;
};

// Daily, and when it's due back: the rider may have paused or turned it back on elsewhere.
const syncPause = async () => {
  if (!(await getToken())) return;
  await pauseWrite;
  const { user } = await api<{ user: User }>('/users/me');
  const was = (await readState()).pause;
  const pause = activePause(user.pause ?? null, new Date());
  if (pause) {
    recommendation++;
    await update(() => ({ pause, loading: false }));
    return armResume();
  }
  if (was) return resume();
};

const SYNC = 'sync';
const RESUME = 'resume';
const armResume = async () => {
  const { pause } = await readState();
  if (pause?.resumesAt)
    await browser.alarms.create(RESUME, { when: Date.parse(pause.resumesAt) });
  else await browser.alarms.clear(RESUME);
};

// Fresh scores straight away; a window that ended while paused goes to what's next, without asking about it.
const resume = async () => {
  await update(() => ({ pause: null }));
  await armResume();
  const { shown, expired } = await readState();
  if (!expired && shown && ended(shown, new Date())) return expire(false);
  return rank();
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
  await rank().catch(() => {}); // rank records its own error
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

// One selection write at a time, so an Undo can't reach the API before the removal it undoes.
let writing: Promise<unknown> = Promise.resolve();
const putSelection = (change: (routeIds: string[]) => string[]) => {
  const next = writing.then(() => writeSelection(change));
  writing = next.catch(() => {});
  return next;
};

const writeSelection = async (change: (routeIds: string[]) => string[]) => {
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

// Edit mode removes a tile straight away (21a), so the list and its alerts change on screen first;
// if the API refuses, its selection comes back, and so do the alerts.
const select = async (
  change: (routeIds: string[]) => string[],
  alertRouteId: string | null,
) => {
  const was = (await readState()).alertRouteId;
  await update((state) => ({
    selection: state.selection && {
      ...state.selection,
      routeIds: change(state.selection.routeIds),
    },
    alertRouteId,
  }));
  try {
    await putSelection(change);
  } catch (error) {
    const selection = await loadSelection().catch(() => null);
    await update(() => ({
      ...(selection && { selection }),
      alertRouteId: was,
    }));
    throw error;
  }
  return rank();
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
  if (
    known &&
    (await seen())[surfaceSeenKey(journey.externalId)] === journey.updatedAt
  )
    return known;
  const send = (existing?: RouteSummary) =>
    api<{ route: RouteSummary }>('/route-imports', {
      body: {
        source: { providerId: 'cycle-travel', externalId: journey.externalId },
        gpx: journey.gpx,
        surface: journey.surface,
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
    seen: {
      ...(await seen()),
      [surfaceSeenKey(journey.externalId)]: journey.updatedAt,
    },
  });
  await update((state) => ({ routes: { ...state.routes, [route.id]: route } }));
  return route;
};

// The plan as saved, with its switches remembered for its ride (shown in Chrome, Safari and Journeys).
const tracked =
  (tracker: Tracker, triggers?: AlertTriggers) =>
  (state: State): Partial<State> => {
    const ride = tracker.ride;
    const saved = ride?.alerts?.triggers ?? triggers;
    return {
      tracker,
      alertRouteId: ride && !ride.refresh.closed ? ride.routeId : null,
      ...(ride &&
        saved && { triggers: { ...state.triggers, [ride.routeId]: saved } }),
    };
  };

const syncTracking = async () => {
  const owner = (await readState()).user?.id;
  try {
    const tracker = await loadTracker();
    // Choices made on another device come with it.
    await update((state) =>
      state.user?.id !== owner ? {} : tracked(tracker)(state),
    );
  } catch (error) {
    await update((state) => ({
      tracker:
        state.user?.id !== owner
          ? state.tracker
          : { ...state.tracker, error: errorMessage(error) },
    }));
  }
};
const updatePushStatus = async () => {
  const owner = (await readState()).user?.id;
  try {
    const push = await pushStatus();
    await update((state) => (state.user?.id === owner ? { push } : {}));
  } catch (error) {
    if (error instanceof SignedOutInApp) return signOutLocally();
    await update(() => ({
      push: {
        enabled: false,
        status: 'unavailable',
        message: 'Could not check notification setup. Try again.',
      },
    }));
  }
};

const handle = async (message: Message) => {
  switch (message.type) {
    case 'signIn':
      await update(() => ({
        auth: 'signing-in',
        signingInWith: message.provider,
        signInError: null,
      }));
      return signedIn(signIn(message.provider));
    case 'signInRedirect':
      return signedIn(finishSignIn(message.url));
    case 'signOut':
      await disablePush();
      // Removals still in their undo window belong to this account; send them first.
      await commitDeletes(true).catch(() => {});
      await api('/api/auth/sign-out', { body: {} }).catch(() => {});
      return signOutLocally();
    case 'refresh':
      return refresh(message.force);
    case 'setPlanning':
      await update(() => ({
        planning: message.planning,
        expired: null,
        next: null,
      }));
      return recommend();
    case 'saveDefaultPlanning':
      return update((state) => ({ defaultPlanning: state.planning }));
    case 'setSearch':
      await update(() => ({ search: message.search }));
      return rank();
    case 'saveUsual': {
      const { unit } = await readState();
      await update(() => ({ search: null }));
      return savePreferences(searchPatch(message.search, unit));
    }
    case 'setUnit':
      return update(() => ({ unit: message.unit }));
    case 'setUnits':
      return update((state) => ({
        units: { ...state.units, ...message.units },
      }));
    case 'setLocal':
      return update((state) => ({
        local: { ...state.local, ...message.local },
      }));
    case 'savePreferences':
      return savePreferences(message.preferences);
    case 'setWeather':
    case 'setLevels': {
      await update((state) => ({
        syncing: true,
        syncError: null,
        // Levels show at once; patchUser replaces them with the API's.
        ...(message.type === 'setLevels' &&
          state.user && {
            user: {
              ...state.user,
              preferenceLevels: {
                ...(state.user.preferenceLevels ?? DEFAULT_LEVELS),
                ...message.levels,
              },
            },
          }),
      }));
      try {
        // ponytail: always saved to the profile; a for-this-search choice waits on the brief.
        await patchUser(
          message.type === 'setWeather'
            ? { weatherProviderId: message.providerId }
            : { preferenceLevels: message.levels },
        );
      } catch (error) {
        return update(() => ({
          syncing: false,
          syncError: errorMessage(error),
        }));
      }
      await update(() => ({ syncing: pendingPatch !== null }));
      return rank();
    }
    case 'import': {
      const route = await importJourney(message.journey);
      if (!message.track) return;
      await putSelection((ids) =>
        ids.includes(route.id) || ids.length >= MAX_TRACKED
          ? ids
          : [...ids, route.id],
      );
      return rank();
    }
    case 'untrack': {
      const { alertRouteId } = await readState();
      return select(
        (ids) => ids.filter((id) => id !== message.routeId),
        alertRouteId,
      );
    }
    case 'track': {
      const { routeId, index } = message;
      const { alertRouteId } = await readState();
      return select(
        (ids) =>
          ids.includes(routeId) || ids.length >= MAX_TRACKED
            ? ids
            : [...ids.slice(0, index), routeId, ...ids.slice(index)],
        message.alert ? routeId : alertRouteId,
      );
    }
    case 'setAlert': {
      if (message.routeId) {
        if (!message.recommendationRef)
          throw new Error('Refresh this ride before tracking it.');
        const { routeId, triggers, departure } = message;
        try {
          const tracker = await saveTrackedRide(
            message.recommendationRef,
            message.expectedTrackingVersion,
            message.replaceTrackedRideId,
            triggers && (await readState()).tracker.triggers ? triggers : null,
          );
          // The API keeps an active plan's choices when the same departure is tracked again.
          const moved = tracker.fixed && departure && tracker.ride;
          await update((state) => {
            const next = { ...state, ...tracked(tracker, triggers)(state) };
            // Alerts moved to another time show there at once; the rankings follow below.
            if (!moved || !state.recs) return next;
            next.recs = pinDeparture(state.recs, routeId, departure, moved.id);
            return { ...next, shown: state.shown && shownOf(next, new Date()) };
          });
          if (moved) rank().catch(() => {});
          return;
        } catch (error) {
          await syncTracking();
          throw error;
        }
      }
      if (message.replaceTrackedRideId)
        await api(`/tracked-rides/${message.replaceTrackedRideId}`, {
          method: 'DELETE',
        });
      return syncTracking();
    }
    // Change alerts (handoff v11, 30c): new switches on the same plan and departure.
    case 'setTriggers':
      try {
        const tracker = await saveTriggers(
          message.trackedRideId,
          message.expectedTrackingVersion,
          message.triggers,
        );
        return update(tracked(tracker, message.triggers));
      } catch (error) {
        await syncTracking();
        throw error;
      }
    case 'enablePush': {
      const push = await enablePush();
      return update(() => ({ push }));
    }
    case 'disablePush': {
      const push = await disablePush();
      return update(() => ({ push }));
    }
    case 'pushStatus':
      return updatePushStatus();
    // Back on at 00:00 local on until; the rider's days, times and alerts stay as they are.
    case 'pause': {
      const { until } = message;
      const { pause: before } = await readState();
      recommendation++; // a ranking in flight is dropped
      await update((state) => ({
        pause: {
          until,
          resumesAt: until && instant(until, '00:00', zoneOf(state.user)),
        },
        loading: false,
      }));
      await armResume();
      return savePause(before, () =>
        api('/users/me/pause', { method: 'PUT', body: { until } }),
      );
    }
    case 'resume': {
      const { pause: before } = await readState();
      await Promise.all([
        resume(),
        savePause(before, () => api('/users/me/pause', { method: 'DELETE' })),
      ]);
      return;
    }
    case 'openPopup':
      await update(() => ({ popupTab: message.tab }));
      // Chrome 127+, Safari 16+; without a focused window it throws and the page keeps its state.
      return browser.action.openPopup?.().catch(() => {});
    case 'setTab':
      return update(() => ({ popupTab: message.tab }));
    case 'checkin': {
      const { checkin, user, routes } = await readState();
      if (!checkin || !user) return;
      // Answered, the ride's alerts have done their job.
      const alertRouteId = (state: State) =>
        state.alertRouteId === checkin.alert ? null : state.alertRouteId;
      if (message.answer === 'no')
        return update((state) => ({
          checkin: null,
          alertRouteId: alertRouteId(state),
        }));
      if (message.answer === 'undo') {
        if (checkin.rideId) await deleteRide(checkin.rideId);
        await update(() => ({
          checkin: {
            ...checkin,
            status: 'ask',
            routeId: null,
            rideId: null,
            key: null,
          },
        }));
      } else {
        // 'updated': the route changed since the plan, so log it as it is now, without the plan.
        const routeId =
          message.answer === 'yes' ? message.routeId : checkin.routeId;
        if (!routeId) return;
        let version = routes[routeId]?.version ?? 1;
        let plan = planFor(checkin, routeId);
        if (message.answer === 'updated') {
          const { route } = await api<{ route: RouteSummary }>(
            `/routes/${routeId}`,
          );
          await update((state) => ({
            routes: { ...state.routes, [route.id]: route },
          }));
          version = route.version;
          plan = null;
        }
        // Kept until answered, so a retry after a lost response replays rather than logs twice.
        const key =
          checkin.key && checkin.routeId === routeId
            ? checkin.key
            : crypto.randomUUID();
        await update(() => ({ checkin: { ...checkin, routeId, key } }));
        try {
          const ride = await logRide(
            {
              routeId,
              expectedRouteVersion: version,
              riddenOn: checkin.date,
              timeZone: user.settings.timeZone,
              ...(plan && { plan }),
            },
            key,
          );
          await update((state) => ({
            checkin: {
              ...checkin,
              status: 'done',
              routeId,
              rideId: ride.id,
              key: null,
            },
            alertRouteId: alertRouteId(state),
          }));
        } catch (error) {
          if (
            !(
              error instanceof ApiError &&
              error.code === 'ROUTE_VERSION_CONFLICT'
            )
          )
            throw error;
          // Never upgraded silently: the rider chooses to log the updated route.
          await update(() => ({
            checkin: { ...checkin, status: 'conflict', routeId, key: null },
          }));
        }
      }
      await loadSummaries().catch(() => {});
      return rank();
    }
    case 'deleteRide':
      await update((state) => ({
        pendingDeletes: [
          ...state.pendingDeletes.filter((d) => d.id !== message.id),
          { id: message.id, at: Date.now() },
        ],
      }));
      // ponytail: in-memory timer; a worker that dies first commits on its next wake instead.
      setTimeout(async () => {
        if (await commitDeletes().catch(() => 0))
          await Promise.all([loadSummaries(), rank()]).catch(() => {});
      }, UNDO_MS + 100);
      return;
    case 'undoDelete':
      return update((state) => ({
        pendingDeletes: state.pendingDeletes.filter((d) => d.id !== message.id),
      }));
    case 'moreRides': {
      const { ridesCursor } = await readState();
      if (!ridesCursor) return;
      const page = await loadRides(ridesCursor);
      return update((state) => ({
        rides: [...state.rides, ...page.rides],
        ridesCursor: page.nextCursor,
      }));
    }
  }
};

export default defineBackground(() => {
  installPushHandlers();
  // A worker restart abandons Chrome's sign-in window, any unsent edit and any request in
  // flight (Safari stops its worker mid-fetch); don't leave them spinning or the panel dimmed.
  // Safari's sign-in tab outlives it, so that stays until it finishes or expires.
  (import.meta.env.SAFARI ? pendingSignIn() : Promise.resolve(undefined)).then(
    (pending) =>
      update((state) => ({
        syncing: false,
        loading: false,
        ...(state.auth === 'signing-in' &&
          !pending && { auth: 'signed-out', signingInWith: null }),
      })),
  );
  // Closing Safari's sign-in tab cancels it, as closing Chrome's window does.
  if (import.meta.env.SAFARI)
    browser.tabs.onRemoved.addListener(async (tabId) => {
      if ((await pendingSignIn())?.tabId !== tabId) return;
      await cancelSignIn();
      await update(() => ({
        auth: 'signed-out',
        signingInWith: null,
        signInError: 'Sign-in was cancelled. Try again.',
      }));
    });
  // ponytail: builds up to 0.1.0 kept the token in storage.local; drop it (costs one sign-in).
  // Delete once no such install remains.
  commitDeletes().catch(() => {});
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
  revive().catch(() => {});
  // Safari: the Ride On app's Sign Out reaches a running extension at once. Otherwise the
  // extension finds out on its next check-in (updatePushStatus) or API call (a 401).
  if (import.meta.env.SAFARI)
    try {
      browser.runtime
        .connectNative('com.danbarclay.rideon')
        .onMessage.addListener(
          async (message: { name?: string; userInfo?: { owner?: string } }) => {
            const { user } = await readState();
            if (
              message.name === 'signOut' &&
              user &&
              message.userInfo?.owner === user.id
            )
              await signOutLocally();
          },
        );
    } catch {}
  // Alarms may not outlive a browser restart or an update, so each wake sets it again.
  armResume().catch(() => {});
  // Made once: setting it again on every wake would restart its day.
  browser.alarms
    .get(SYNC)
    .then((alarm) => {
      if (!alarm)
        return browser.alarms.create(SYNC, {
          delayInMinutes: 24 * 60,
          periodInMinutes: 24 * 60,
        });
    })
    .catch(() => {});
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === RESUME) refresh().catch(() => {});
    if (alarm.name === SYNC) syncPause().catch(() => {});
  });
  browser.runtime.onMessage.addListener(
    (message: Message, sender, sendResponse) => {
      if (
        ['enablePush', 'disablePush'].includes(message.type) &&
        (import.meta.env.SAFARI ||
          sender.url !== browser.runtime.getURL('/popup.html'))
      ) {
        sendResponse({
          error: import.meta.env.SAFARI
            ? 'Turn on notifications in the Ride On app.'
            : 'Manage notifications in Ride On Preferences.',
        });
        return false;
      }
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
