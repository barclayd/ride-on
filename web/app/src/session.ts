import { createCookie } from 'remix/cookie';

// SPEC §11.2. Both are host-only, HttpOnly and never reach JavaScript.
const options = {
  httpOnly: true,
  secure: true,
  sameSite: 'Lax',
  path: '/',
} as const;
export const sessionCookie = createCookie('__Host-ro_session', {
  ...options,
  maxAge: 60 * 60 * 24 * 7,
});
export const handoffCookie = createCookie('__Host-ro_handoff', {
  ...options,
  maxAge: 600,
});

export type Handoff = { verifier: string; state: string; next: string };

export const readHandoff = async (request: Request) => {
  try {
    return JSON.parse(
      (await handoffCookie.parse(request.headers.get('Cookie'))) ?? 'null',
    ) as Handoff | null;
  } catch {
    return null;
  }
};

/** The session token; on localhost with no cookie, the seeded local session (`bun run dev:session`). */
export const readToken = async (request: Request, devToken?: string) =>
  (await sessionCookie.parse(request.headers.get('Cookie'))) ||
  (new URL(request.url).hostname === 'localhost' && devToken) ||
  null;

/** Only same-origin paths: never `//host` or `/\host`. */
export const safeNext = (next: string | null | undefined) =>
  next && /^\/(?![/\\])/.test(next) ? next : '/';

/** `/api/auth/*` is Better Auth's own path on the API; every other `/api/<rest>` is the API's `/<rest>`. */
export const apiPath = (pathname: string) =>
  pathname.startsWith('/api/auth/') ? pathname : pathname.slice('/api'.length);

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
export const random = (bytes: number) =>
  base64url(crypto.getRandomValues(new Uint8Array(bytes)));
export const challengeFor = async (verifier: string) =>
  base64url(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)),
    ),
  );

export const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

/**
 * Sends `init` to the API as `path` with the rider's bearer and IP (the API throttles by
 * `cf-connecting-ip`), and turns a refreshed `set-auth-token` into the session cookie.
 */
export const callApi = async (
  api: Fetcher,
  from: Request,
  path: string,
  token: string | null,
  init: RequestInit = {},
) => {
  const headers = new Headers(init.headers);
  const ip = from.headers.get('cf-connecting-ip');
  if (ip) headers.set('cf-connecting-ip', ip);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await api.fetch(
    new Request(new URL(path, 'https://api.ride-on.cc'), {
      ...init,
      headers,
      redirect: 'manual',
    }),
  );
  const refreshed = response.headers.get('set-auth-token');
  if (!refreshed) return response;
  const out = new Response(response.body, response);
  out.headers.delete('set-auth-token');
  out.headers.append('Set-Cookie', await sessionCookie.serialize(refreshed));
  return out;
};

/** The `/api/*` proxy: the browser's request, minus its cookies, as the rider. */
export const proxy = (api: Fetcher, request: Request, token: string | null) => {
  const url = new URL(request.url);
  const headers = new Headers(request.headers);
  // ponytail: no cookies cross to the API; passkeys (SPEC §11.2) will pass the challenge cookie through.
  headers.delete('Cookie');
  return callApi(api, request, apiPath(url.pathname) + url.search, token, {
    method: request.method,
    headers,
    body: request.body,
  });
};
