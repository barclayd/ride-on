import { browser } from 'wxt/browser';

declare const __API_URL__: string;
export const API_URL = __API_URL__;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

// ponytail: storage.local is also readable by our content script (isolated from the page itself);
// move the token behind the background with storage.session if this ships beyond a personal install.
export const getToken = async () =>
  (await browser.storage.local.get('token')).token as string | undefined;
export const setToken = (token: string | null) =>
  token
    ? browser.storage.local.set({ token })
    : browser.storage.local.remove('token');

// Background only: content scripts and the popup never call the API directly.
export const api = async <T>(
  path: string,
  init: { method?: string; body?: unknown; auth?: boolean } = {},
): Promise<T> => {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  if (init.auth !== false) {
    const token = await getToken();
    if (token) headers.authorization = `Bearer ${token}`;
  }
  const res = await fetch(API_URL + path, {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  // Sessions refresh after a day of use; keep the newest token.
  const refreshed = res.headers.get('set-auth-token');
  if (refreshed) await setToken(refreshed);
  const json = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const error = json?.error ?? json ?? {};
    throw new ApiError(
      res.status,
      error.code ?? `HTTP_${res.status}`,
      error.message ?? res.statusText,
    );
  }
  return json as T;
};
