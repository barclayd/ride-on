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

// The token lives in the extension's own IndexedDB, not storage.local: it persists the same, but
// content scripts get the page's IndexedDB, so only the background (the API caller) can read it.
const auth = (
  mode: IDBTransactionMode,
  op: (store: IDBObjectStore) => IDBRequest,
) =>
  new Promise<unknown>((resolve, reject) => {
    const open = indexedDB.open('ride-on');
    open.onupgradeneeded = () => open.result.createObjectStore('auth');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const request = op(
        open.result.transaction('auth', mode).objectStore('auth'),
      );
      open.result.close(); // closes once the transaction finishes
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    };
  });
export const getToken = async () =>
  (await auth('readonly', (store) => store.get('token'))) as string | undefined;
export const setToken = (token: string | null) =>
  auth('readwrite', (store) =>
    token ? store.put(token, 'token') : store.delete('token'),
  );

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
