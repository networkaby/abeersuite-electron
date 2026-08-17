"use client";

/**
 * A tiny key/value cache on IndexedDB, for payloads too big for localStorage.
 *
 * Use `pollCache` (localStorage) for small things — it is synchronous, so a
 * component can seed its first render straight from it. Reach for this instead
 * when the payload is genuinely large: localStorage caps out around 5MB and
 * throws once you cross it, which the product catalogue (several thousand
 * enriched rows) would do.
 *
 * Deliberately one value per key rather than a row-per-record store: callers
 * here hold the whole collection in memory anyway to filter it, so a per-row
 * schema would buy nothing and cost real complexity.
 *
 * Every operation is best-effort — private mode, a blocked upgrade or a corrupt
 * database all resolve to "no cache", which just means the caller fetches in
 * full, exactly as it would have without any of this.
 */

const DB_NAME = "abeer-cache";
const DB_VERSION = 1;
const STORE = "kv";

function openDb(): Promise<IDBDatabase | null> {
    return new Promise((resolve) => {
        if (typeof indexedDB === "undefined") return resolve(null);
        let req: IDBOpenDBRequest;
        try {
            req = indexedDB.open(DB_NAME, DB_VERSION);
        } catch {
            return resolve(null);
        }
        req.onupgradeneeded = () => {
            if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
    });
}

async function withStore<T>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => IDBRequest,
): Promise<T | null> {
    const db = await openDb();
    if (!db) return null;
    return new Promise<T | null>((resolve) => {
        try {
            const tx = db.transaction(STORE, mode);
            const req = run(tx.objectStore(STORE));
            req.onsuccess = () => resolve(req.result as T);
            req.onerror = () => resolve(null);
            tx.onabort = () => resolve(null);
            tx.oncomplete = () => db.close();
        } catch {
            resolve(null);
        }
    });
}

export function idbGet<T>(key: string): Promise<T | null> {
    return withStore<T>("readonly", (s) => s.get(key));
}

export function idbSet<T>(key: string, value: T): Promise<unknown> {
    return withStore("readwrite", (s) => s.put(value, key));
}

export function idbDelete(key: string): Promise<unknown> {
    return withStore("readwrite", (s) => s.delete(key));
}
