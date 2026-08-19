"use client";

/**
 * Tab leadership — exactly one same-origin tab holds it at a time.
 *
 * Every browser tab runs its own JS process with its own `supabase` client, so
 * by default every tab opens its OWN WebSocket to Realtime. Gating that
 * connection on `document.hidden` (an earlier attempt here) turned out not to
 * help: chat's room subscriptions ([GlobalInboxListener](../../../modules/message/components/GlobalInboxListener.tsx))
 * are deliberately always-on so a message still notifies you on a backgrounded
 * tab, and that alone means every open tab — hidden or not — already holds a
 * live connection. Three tabs is three heartbeats no matter what the ledger
 * channel does on its own.
 *
 * The actual fix is one connection per COMPUTER, not per tab: exactly one tab
 * subscribes to anything live; every other tab reads the same signals for
 * free over the `localStorage` mirror (`appChannel.ts` / `pollCache.ts`) that
 * already exists for this. Nothing a person sees changes — background sound,
 * notifications and badge counts keep working in every tab — only which tab
 * is paying for the socket does.
 *
 * The Web Locks API is the right primitive for "exactly one of these tabs
 * does X": `navigator.locks.request` hands a named lock to one caller across
 * every same-origin tab/worker, queues the rest, and — the part that matters
 * here — releases it automatically the moment the holding tab closes or
 * crashes, so the next tab takes over with no heartbeat, no stale-lock
 * detection, and no split-brain window to get wrong by hand.
 */

const LOCK_NAME = "realtime-leader";

let electionStarted = false;
let leader = false;
const onLeaderCallbacks: Array<() => void> = [];

function startElection() {
    if (electionStarted) return;
    electionStarted = true;

    // No Locks API (very old browser): fall back to "every tab leads", which
    // is exactly today's behaviour — safe, just not deduplicated.
    if (typeof navigator === "undefined" || !("locks" in navigator)) {
        leader = true;
        for (const fn of onLeaderCallbacks) fn();
        return;
    }

    void navigator.locks.request(LOCK_NAME, () => {
        leader = true;
        for (const fn of onLeaderCallbacks) fn();
        // Resolving releases the lock; nothing here ever does, so this tab
        // holds leadership until it closes and the browser reclaims it for
        // whichever tab is next in the queue.
        return new Promise<void>(() => {});
    });
}

/** True once THIS tab has won leadership. False for every other open tab. */
export function isTabLeader(): boolean {
    return leader;
}

/**
 * Run `fn` the moment this tab becomes leader — immediately if it already is
 * one, otherwise when the current leader tab eventually closes. A tab that
 * never wins simply never runs `fn`, which is the point: it stays a follower,
 * reading everything the leader publishes over the localStorage mirror.
 */
export function onBecomeLeader(fn: () => void): void {
    startElection();
    if (leader) fn();
    else onLeaderCallbacks.push(fn);
}
