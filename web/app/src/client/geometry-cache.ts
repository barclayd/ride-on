import type { Line } from '../geometry.ts';

// Library geometry in IndexedDB by `routeId@version` (SPEC §12.4), which never changes for a version.
// Callers treat any failure (a private window, blocked storage) as a cache miss.

const open = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('ride-on', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('lines');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const write = async (fill: (store: IDBObjectStore) => void) => {
  const db = await open();
  try {
    const transaction = db.transaction('lines', 'readwrite');
    fill(transaction.objectStore('lines'));
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = transaction.onabort = () =>
        reject(transaction.error);
    });
  } finally {
    db.close();
  }
};

/** The cached lines for `keys`. Every other key goes, so old versions and deleted routes don't pile up. */
export const cachedLines = async (keys: readonly string[]) => {
  const wanted = new Set(keys);
  const lines = new Map<string, Line>();
  await write((store) => {
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      if (typeof cursor.key === 'string' && wanted.has(cursor.key))
        lines.set(cursor.key, cursor.value);
      else cursor.delete();
      cursor.continue();
    };
  });
  return lines;
};

export const saveLines = (lines: ReadonlyMap<string, Line>) =>
  write((store) => {
    for (const [key, line] of lines) store.put(line, key);
  });
