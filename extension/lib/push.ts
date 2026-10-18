/// <reference lib="webworker" />
import { browser } from 'wxt/browser';
import { API_URL, ApiError, api, getSecret, getToken, setSecret } from './api';
import { readState } from './state';

declare const self: ServiceWorkerGlobalScope;

export type PushStatus = {
  enabled: boolean;
  status: 'off' | 'ready' | 'setup' | 'blocked' | 'unavailable';
  message: string;
};
export const PUSH_OFF: PushStatus = {
  enabled: false,
  status: 'off',
  message: 'Notifications are off on this device.',
};
type Registration = {
  id: string;
  owner: string;
  enabled: boolean;
  publicKey?: string;
};
type NativeStatus = {
  installationId: string;
  enabled: boolean;
  status: PushStatus['status'];
  message: string;
  error?: string;
  signOut?: boolean; // the Ride On app signed this session out
};
/** The Ride On app signed out; the extension follows. */
export class SignedOutInApp extends Error {}
const native = async (message: object): Promise<NativeStatus> => {
  const result = await browser.runtime.sendNativeMessage(
    'com.danbarclay.rideon',
    message,
  );
  if (!result || result.error)
    throw new Error(
      result?.error ?? 'Open the Ride On app to finish notification setup.',
    );
  return result;
};
const keyBytes = (key: string) =>
  Uint8Array.from(atob(key.replaceAll('-', '+').replaceAll('_', '/')), (c) =>
    c.charCodeAt(0),
  );
export const notificationURL = (id: string) =>
  `${API_URL}/notifications/open#ride=${encodeURIComponent(id)}`;

// The app's sidebar shows the email; fetched once for each account.
const accountEmail = async (owner: string) => {
  const saved = await getSecret<{ owner: string; email: string | null }>(
    'account-email',
  );
  if (saved?.owner === owner) return saved.email;
  const me = await api<{ user: { email?: string | null } }>('/auth/me');
  const email = me.user.email ?? null;
  await setSecret('account-email', { owner, email });
  return email;
};

// Safari: the Ride On app owns notifications. Checking in shares the account with it; 'on' opens
// the app, which asks macOS and registers this device, and 'off' stops this device's alerts.
const checkIn = async (notifications?: 'on' | 'off'): Promise<PushStatus> => {
  const state = await readState();
  const token = await getToken();
  if (!state.user || !token) return PUSH_OFF;
  const result = await native({
    type: 'account',
    owner: state.user.id,
    token,
    email: await accountEmail(state.user.id).catch(() => null),
    apiURL: API_URL,
    ...(notifications && { notifications }),
  });
  if (result.signOut) throw new SignedOutInApp();
  return {
    enabled: result.enabled,
    status: result.status,
    message: result.message,
  };
};

export const pushStatus = async (): Promise<PushStatus> => {
  if (import.meta.env.SAFARI) return checkIn();
  const saved = await getSecret<Registration>('push-registration');
  if (!saved?.enabled) return PUSH_OFF;
  if ((await browser.notifications.getPermissionLevel()) !== 'granted')
    return {
      enabled: false,
      status: 'blocked',
      message: 'Notifications are blocked in your browser or system settings.',
    };
  const config = await api<{
    automaticChecks: boolean;
    webPush: { publicKey: string | null; configured: boolean };
  }>('/push-devices/config');
  const subscription = await self.registration.pushManager.getSubscription();
  const registered = await api<{ devices: { id: string }[] }>('/push-devices');
  if (
    !subscription ||
    !registered.devices.some((d) => d.id === saved.id) ||
    config.webPush.publicKey !== saved.publicKey
  )
    return {
      enabled: false,
      status: 'setup',
      message: 'Enable notifications again to reconnect this browser.',
    };
  if (!config.webPush.configured || !config.automaticChecks)
    return {
      enabled: false,
      status: 'unavailable',
      message: 'Notification delivery is temporarily unavailable.',
    };
  return {
    enabled: true,
    status: 'ready',
    message: 'Notifications are enabled on this device.',
  };
};
const enable = async (): Promise<PushStatus> => {
  const state = await readState();
  if (!state.user || !(await getToken()))
    throw new Error('Sign in before enabling notifications.');
  if (import.meta.env.SAFARI) return checkIn('on');
  if ((await browser.notifications.getPermissionLevel()) !== 'granted')
    throw new Error(
      'Notifications are blocked in your browser or system settings.',
    );
  const config = await api<{
    automaticChecks: boolean;
    webPush: { publicKey: string | null; configured: boolean };
  }>('/push-devices/config');
  if (
    !config.automaticChecks ||
    !config.webPush.publicKey ||
    !config.webPush.configured
  )
    throw new Error(
      'Notification delivery is not available yet. Your ride can still be tracked.',
    );
  let saved = await getSecret<Registration>('push-registration');
  if (saved && saved.owner !== state.user.id) {
    await disable();
    saved = undefined;
  }
  let subscription = await self.registration.pushManager.getSubscription();
  if (subscription && saved?.publicKey !== config.webPush.publicKey) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ??= await self.registration.pushManager.subscribe({
    // Chrome 121+ allows silent handling of expired, duplicate or stopped-ride pushes.
    userVisibleOnly: false,
    applicationServerKey: keyBytes(config.webPush.publicKey),
  });
  const registration = {
    id: saved?.id ?? crypto.randomUUID(),
    owner: state.user.id,
    enabled: false,
    publicKey: config.webPush.publicKey,
  };
  await setSecret('push-registration', registration);
  const result = await api<{ deliveryConfigured: boolean }>(
    `/push-devices/${registration.id}`,
    {
      method: 'PUT',
      body: {
        transport: 'web_push',
        platform: 'chrome',
        subscription: subscription.toJSON(),
      },
    },
  );
  await setSecret('push-registration', {
    ...registration,
    enabled: result.deliveryConfigured,
  });
  return pushStatus();
};
const disable = async () => {
  if (import.meta.env.SAFARI) {
    // Signed out: the app stops this device's alerts and forgets the account.
    await setSecret('push-registration', null); // ponytail: from builds before the app owned it
    await setSecret('account-email', null);
    await native({ type: 'account' }).catch(() => {});
    return PUSH_OFF;
  }
  const saved = await getSecret<Registration>('push-registration');
  // Disable local presentation first, even if offline. Retain the ID until server cleanup succeeds.
  if (saved) await setSecret('push-registration', { ...saved, enabled: false });
  await self.registration.pushManager
    .getSubscription()
    .then((subscription) => subscription?.unsubscribe())
    .catch(() => {});
  const visible = (await browser.notifications?.getAll()) ?? {};
  await Promise.all(
    Object.keys(visible)
      .filter((id) => id.startsWith('ride-on:'))
      .map((id) => browser.notifications.clear(id)),
  );
  if (saved) await api(`/push-devices/${saved.id}`, { method: 'DELETE' });
  await setSecret('push-registration', null);
  return PUSH_OFF;
};

let changes: Promise<void> = Promise.resolve();
const change = <T>(action: () => Promise<T>) => {
  const result = changes.then(action);
  changes = result.then(
    () => {},
    () => {},
  );
  return result;
};
export const enablePush = () => change(enable);
/** Signing out. Safari's app forgets the account too. */
export const disablePush = () => change(disable);
/** Preferences' Turn off: Safari keeps the account shared with the app. */
export const turnOffPush = () =>
  change(() => (import.meta.env.SAFARI ? checkIn('off') : disable()));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type PushPayload = {
  installationId: string;
  expiresAt: string;
  trackedRideId: string;
  notificationId: string;
  aps: { alert: { title: string; body: string } };
};
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;
export const validPayload = (value: unknown): value is PushPayload => {
  if (!record(value) || !record(value.aps) || !record(value.aps.alert))
    return false;
  return (
    ['installationId', 'expiresAt', 'trackedRideId', 'notificationId'].every(
      (key) => typeof value[key] === 'string',
    ) &&
    typeof value.aps.alert.title === 'string' &&
    typeof value.aps.alert.body === 'string'
  );
};

export const installPushHandlers = () => {
  if (import.meta.env.SAFARI) return;
  self.addEventListener('push', (event) => {
    event.waitUntil(
      (async () => {
        const saved = await getSecret<Registration>('push-registration');
        const state = await readState();
        if (
          !saved?.enabled ||
          state.auth !== 'signed-in' ||
          saved.owner !== state.user?.id
        )
          return;
        let payload: unknown;
        try {
          payload = event.data?.json();
          if (typeof payload === 'string') payload = JSON.parse(payload);
        } catch {
          return;
        }
        if (!validPayload(payload)) return;
        if (
          payload.installationId !== saved.id ||
          !Number.isFinite(Date.parse(payload.expiresAt)) ||
          Date.parse(payload.expiresAt) <= Date.now()
        )
          return;
        const ride = payload.trackedRideId;
        if (
          typeof ride !== 'string' ||
          !UUID.test(ride) ||
          typeof payload.notificationId !== 'string'
        )
          return;
        if (
          typeof payload.aps?.alert?.title !== 'string' ||
          typeof payload.aps?.alert?.body !== 'string'
        )
          return;
        const seen = (await getSecret<string[]>('push-seen')) ?? [];
        if (seen.includes(payload.notificationId)) return;
        // Confirm lifecycle without requesting weather; a stopped plan or account pause is silent.
        try {
          const [current, account] = await Promise.all([
            api<{ ride: { state: string; departureAt: string } }>(
              `/tracked-rides/${ride}`,
            ),
            api<{ user: { pause?: { resumesAt: string | null } | null } }>(
              '/users/me',
            ),
          ]);
          const paused = account.user.pause;
          if (
            current.ride.state !== 'active' ||
            Date.parse(current.ride.departureAt) <= Date.now() ||
            (paused &&
              (!paused.resumesAt || Date.parse(paused.resumesAt) > Date.now()))
          )
            return;
        } catch (error) {
          if (
            error instanceof ApiError &&
            [401, 403, 404].includes(error.status)
          )
            return;
          if (
            state.pause &&
            (!state.pause.resumesAt ||
              Date.parse(state.pause.resumesAt) > Date.now())
          )
            return;
          // An authenticated, unexpired push remains useful during a temporary API outage.
        }
        const stillEnabled = await getSecret<Registration>('push-registration');
        if (
          !stillEnabled?.enabled ||
          stillEnabled.id !== saved.id ||
          stillEnabled.owner !== saved.owner
        )
          return;
        await browser.notifications.create(`ride-on:${ride}`, {
          type: 'basic',
          iconUrl: browser.runtime.getURL('/ride-on-icon.png'),
          title: payload.aps.alert.title,
          message: payload.aps.alert.body,
        });
        await setSecret(
          'push-seen',
          [...seen, payload.notificationId].slice(-100),
        );
      })().catch(() => {}),
    );
  });
  browser.notifications.onClicked.addListener((id) => {
    if (!id.startsWith('ride-on:')) return;
    const ride = id.slice(8);
    if (!UUID.test(ride)) return;
    void browser.tabs.create({ url: notificationURL(ride) });
  });
  self.addEventListener('pushsubscriptionchange', (event) => {
    (event as ExtendableEvent).waitUntil(
      (async () => {
        const saved = await getSecret<Registration>('push-registration');
        const state = await readState();
        if (saved?.enabled && saved.owner === state.user?.id)
          await enablePush();
      })().catch(() => {}),
    );
  });
};
