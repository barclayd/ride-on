import { browser } from 'wxt/browser';
import { api, setToken } from './api';
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

// PKCE browser handoff: docs/authentication.md "Chrome extension / browser handoff".
export const signIn = async (provider: Provider) => {
  const redirectUri = browser.identity.getRedirectURL('ride-on');
  const { verifier, challenge } = await pkce();
  const state = random(24);
  const { authorizationUrl } = await api<{ authorizationUrl: string }>(
    '/auth/browser/start',
    {
      auth: false,
      body: { provider, redirectUri, codeChallenge: challenge, state },
    },
  );
  let redirect: string | undefined;
  try {
    redirect = await browser.identity.launchWebAuthFlow({
      url: authorizationUrl,
      interactive: true,
    });
  } catch {
    throw new SignInCancelled();
  }
  const params = new URL(redirect ?? 'about:blank').searchParams;
  const code = params.get('code');
  if (!code || params.get('state') !== state) throw new SignInCancelled();
  const session = await api<{ token: string; user: { name?: string } }>(
    '/auth/browser/exchange',
    { auth: false, body: { code, codeVerifier: verifier, redirectUri } },
  );
  await setToken(session.token);
  return session.user;
};
