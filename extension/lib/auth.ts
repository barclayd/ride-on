import { browser } from 'wxt/browser';
import { API_URL, api, getSecret, setSecret, setToken } from './api';
import type { Provider } from './state';

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
const random = (bytes: number) =>
  base64url(crypto.getRandomValues(new Uint8Array(bytes)));

export const pkce = async () => {
  const verifier = random(48); // 64 URL-safe characters
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier),
  );
  return { verifier, challenge: base64url(new Uint8Array(digest)) };
};

export class SignInCancelled extends Error {}

// Safari has no identity API, so its sign-in runs in a tab that ends on this API page, where
// the auth content script hands the URL to the background (finishSignIn). Register it in
// AUTH_CONFIG_JSON.clientRedirects.
export const SAFARI_REDIRECT = `${API_URL}/auth/browser/done`;
// The background can unload while the rider signs in, so the flow waits in IndexedDB.
type Pending = { verifier: string; state: string; tabId?: number; at: number };
const FLOW_MS = 600_000; // the API's flow lifetime

const start = async (provider: Provider, redirectUri: string) => {
  const { verifier, challenge } = await pkce();
  const state = random(24);
  const { authorizationUrl } = await api<{ authorizationUrl: string }>(
    '/auth/browser/start',
    {
      auth: false,
      body: { provider, redirectUri, codeChallenge: challenge, state },
    },
  );
  return { verifier, state, authorizationUrl };
};

const exchange = async (
  redirect: string,
  flow: { verifier: string; state: string },
  redirectUri: string,
) => {
  const params = new URL(redirect).searchParams;
  const code = params.get('code');
  if (!code || params.get('state') !== flow.state) throw new SignInCancelled();
  const session = await api<{ token: string }>('/auth/browser/exchange', {
    auth: false,
    body: { code, codeVerifier: flow.verifier, redirectUri },
  });
  await setToken(session.token);
};

// PKCE browser handoff: docs/authentication.md "Chrome extension / browser handoff".
// Resolves true once signed in, or false when Safari's tab will finish it later.
export const signIn = async (provider: Provider) => {
  if (import.meta.env.SAFARI) {
    const { authorizationUrl, ...flow } = await start(
      provider,
      SAFARI_REDIRECT,
    );
    await setSecret('pending', { ...flow, at: Date.now() } satisfies Pending);
    const tab = await browser.tabs.create({ url: authorizationUrl });
    await setSecret('pending', { ...flow, tabId: tab.id, at: Date.now() });
    return false;
  }
  const redirectUri = browser.identity.getRedirectURL('ride-on');
  const { authorizationUrl, ...flow } = await start(provider, redirectUri);
  let redirect: string | undefined;
  try {
    redirect = await browser.identity.launchWebAuthFlow({
      url: authorizationUrl,
      interactive: true,
    });
  } catch {
    throw new SignInCancelled();
  }
  await exchange(redirect ?? 'about:blank', flow, redirectUri);
  return true;
};

export const pendingSignIn = async () => {
  const pending = await getSecret<Pending>('pending');
  return pending && Date.now() - pending.at < FLOW_MS ? pending : undefined;
};

export const cancelSignIn = () => setSecret('pending', null);

// Safari: the sign-in tab reached SAFARI_REDIRECT. The flow is used once, whatever happens.
export const finishSignIn = async (url: string) => {
  const pending = await pendingSignIn();
  await cancelSignIn();
  if (pending?.tabId) browser.tabs.remove(pending.tabId).catch(() => {});
  if (!pending || !url.startsWith(`${SAFARI_REDIRECT}?`))
    throw new SignInCancelled();
  await exchange(url, pending, SAFARI_REDIRECT);
  return true;
};
