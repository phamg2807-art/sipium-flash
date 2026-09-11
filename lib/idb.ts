'use client';

/**
 * Local persistence. Decks, drafts and the review outbox live here so nothing
 * is lost on refresh, a crash, or a failed network request.
 *
 * Falls back to localStorage (and finally memory) if IndexedDB is unavailable.
 */

const DB_NAME = 'sipium-flash';
const DB_VERSION = 1;
export const STORES = ['decks', 'drafts', 'outbox', 'meta'] as const;
export type StoreName = (typeof STORES)[number];

const memory = new Map<string, Map<string, unknown>>();
for (const store of STORES) memory.set(store, new Map());

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        for (const store of STORES) {
          if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function lsKey(store: StoreName, key: string) {
  return `sipium.${store}.${key}`;
}

function lsFallback<T>(store: StoreName, key: string): T | undefined {
  if (typeof localStorage === 'undefined') return memory.get(store)?.get(key) as T | undefined;
  const raw = localStorage.getItem(lsKey(store, key));
  if (raw === null) return memory.get(store)?.get(key) as T | undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

export async function idbGet<T>(store: StoreName, key: string): Promise<T | undefined> {
  const db = await openDb();
  if (!db) return lsFallback<T>(store, key);
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(store, 'readonly');
      const request = tx.objectStore(store).get(key);
      request.onsuccess = () => resolve(request.result as T | undefined);
      request.onerror = () => resolve(lsFallback<T>(store, key));
    } catch {
      resolve(lsFallback<T>(store, key));
    }
  });
}

export async function idbPut<T>(store: StoreName, key: string, value: T): Promise<void> {
  memory.get(store)?.set(key, value);
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(lsKey(store, key), JSON.stringify(value));
    } catch {
      /* storage full — in-memory copy still keeps the session alive */
    }
  }
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function idbDelete(store: StoreName, key: string): Promise<void> {
  memory.get(store)?.delete(key);
  if (typeof localStorage !== 'undefined') localStorage.removeItem(lsKey(store, key));
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function idbAll<T>(store: StoreName): Promise<{ key: string; value: T }[]> {
  const db = await openDb();
  if (!db) {
    const fromMemory = memory.get(store);
    if (fromMemory && fromMemory.size > 0) {
      return [...fromMemory.entries()].map(([key, value]) => ({ key, value: value as T }));
    }
    if (typeof localStorage !== 'undefined') {
      const out: { key: string; value: T }[] = [];
      const prefix = `sipium.${store}.`;
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith(prefix)) continue;
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        try {
          out.push({ key: key.slice(prefix.length), value: JSON.parse(raw) as T });
        } catch {
          /* skip corrupt entry */
        }
      }
      return out;
    }
    return [];
  }
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(store, 'readonly');
      const request = tx.objectStore(store).openCursor();
      const out: { key: string; value: T }[] = [];
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          out.push({ key: String(cursor.key), value: cursor.value as T });
          cursor.continue();
        } else {
          resolve(out);
        }
      };
      request.onerror = () => resolve(out);
    } catch {
      resolve([]);
    }
  });
}

export async function idbClear(store: StoreName): Promise<void> {
  memory.get(store)?.clear();
  if (typeof localStorage !== 'undefined') {
    const prefix = `sipium.${store}.`;
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith(prefix)) keys.push(key);
    }
    keys.forEach((key) => localStorage.removeItem(key));
  }
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}
