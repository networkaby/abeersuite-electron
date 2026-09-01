"use client";

/**
 * "The replica now actually has the new rows."
 *
 * On a counter, screens are served from the local replica (`READ_MODE=local`), and both
 * the page and the sync worker subscribe to the same `app:changes` signal. They then act
 * in parallel, and the page wins: it re-reads after a 600 ms settle, while the worker has
 * to settle 750 ms, spawn `sync-once.js` and scan 113 tables before it writes anything.
 * So the screen routinely re-read the replica BEFORE the data landed in it, showed the
 * old rows, and — having no idea it had missed — sat there until the next signal, a
 * visibility return, or a manual Refresh. On a quiet counter with one isolated change,
 * that is exactly the case a person is sitting and watching.
 *
 * The worker is the only thing that knows when rows are really queryable, so it says so:
 * `sync-once.js` prints `__SYNC_APPLIED__` after committing, `syncManager.ts` forwards it
 * to every window, and this module turns that into a DOM event `useRealtimeTopics`
 * listens for. Silent when a cycle pulled nothing, so a no-op cycle wakes no screen.
 *
 * Off Electron this does nothing at all: a browser reads Supabase directly, so there is
 * no replica to be behind and nothing to wait for.
 */

/** Dispatched on `window` after the replica has committed pulled rows. */
export const SYNC_APPLIED_EVENT = "app:sync-applied";

export type SyncAppliedInfo = { rows: number; models: string[] };

let registered = false;

/**
 * Idempotent. Every `useRealtimeTopics` calls this, but only the first one registers —
 * `ipcRenderer.on` appends a listener per call, so registering per hook instance would
 * add one for every mounted screen and fire the event N times.
 */
export function ensureSyncAppliedBridge(): void {
    if (registered || typeof window === "undefined") return;
    const api = (window as { electronAPI?: { onSyncApplied?: (cb: (i: SyncAppliedInfo) => void) => void } }).electronAPI;
    if (!api?.onSyncApplied) return; // a browser, or an older shell without this channel
    registered = true;
    api.onSyncApplied((info) => {
        window.dispatchEvent(new CustomEvent<SyncAppliedInfo>(SYNC_APPLIED_EVENT, { detail: info }));
    });
}
