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
export function ensureSyncAppliedBridge(): boolean {
    if (typeof window === "undefined") return false;
    if (registered) return true;
    const api = (window as { electronAPI?: { onSyncApplied?: (cb: (i: SyncAppliedInfo) => void) => void } }).electronAPI;
    if (!api?.onSyncApplied) return false; // a browser, or an older shell without this channel
    registered = true;
    api.onSyncApplied((info) => {
        window.dispatchEvent(new CustomEvent<SyncAppliedInfo>(SYNC_APPLIED_EVENT, { detail: info }));
    });
    return true;
}

/**
 * Subscribe to the replica's own "the rows are in" event, and to NOTHING else.
 *
 * This is the purely local source. It never touches the Supabase channel, because
 * that message does not mean "the data is here" — it means "sync engine, come and
 * pull", and it arrives while the replica is still behind. Acting on it is what
 * made a screen read the OLD rows and then sit there. What arrives here is the
 * worker reporting AFTER its commit, so a read that follows it can only see the
 * new rows.
 *
 * `models` narrows the wake-up to the tables a screen actually reads — the worker
 * already names them (`sync-once.js`, `changedModels`, and they are the Prisma
 * model names in `syncRegistry.generated.ts`). Leave it out to wake on every cycle
 * that moved anything, which is the SAFE default: a screen that lists too few
 * models goes quietly stale, and that silent staleness is the exact fault this
 * whole path exists to cure. Narrow only where the extra reads are shown to hurt.
 *
 * Raw and unscheduled on purpose. Debouncing and the hidden-window rules live in
 * `createSettledReader`, so a caller that wants both this and the Supabase channel
 * shares one timer and one visibility listener rather than running two of each.
 *
 * Off Electron this is a no-op: a browser reads the source directly, so there is
 * no replica to be behind and nothing to wait for.
 */
export function onReplicaUpdate(
    fn: (info: SyncAppliedInfo | undefined) => void,
    models?: readonly string[],
): () => void {
    if (!ensureSyncAppliedBridge()) return () => {};

    const wanted = models && models.length > 0 ? new Set(models) : null;

    const handler = (e: Event) => {
        const info = (e as CustomEvent<SyncAppliedInfo>).detail;
        // No filter asked for, or an older shell that sent no model list: treat it
        // as "something changed". Dropping a wake-up we cannot classify would put
        // the screen back to being stale with no way to tell.
        if (wanted && Array.isArray(info?.models) && !info.models.some((m) => wanted.has(m))) return;
        fn(info);
    };

    window.addEventListener(SYNC_APPLIED_EVENT, handler);
    return () => window.removeEventListener(SYNC_APPLIED_EVENT, handler);
}
