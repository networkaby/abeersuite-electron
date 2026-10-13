"use client";

/**
 * The counter's soft lock, as the screen sees it (owner, 2026-10-13).
 *
 * Lock (the sidebar button, or the idle timer) covers the till; the login stays alive
 * underneath and the person's 4-digit PIN lifts the cover. The lock itself lives on
 * the till (`/api/counter-lock`, `localLock.ts`) so a refresh comes back covered;
 * this module is the screen's copy of it, shared by every window of the app through
 * a BroadcastChannel — one window locks, all of them cover; one unlocks, all lift.
 *
 * Off a counter `enabled` is false and nothing here does anything: the office
 * website and the phone app still sign out.
 */

export type CounterLockState = {
    /** null until the till has answered. */
    enabled: boolean | null;
    locked: boolean;
    hasPin: boolean;
    /** The last real input before the lock — what "Sign out fully" credits up to. */
    lockedAt: number | null;
};

const CHANNEL = "abeer-counter-lock";

let state: CounterLockState = { enabled: null, locked: false, hasPin: false, lockedAt: null };
const listeners = new Set<() => void>();
const unlockListeners = new Set<() => void>();
let channel: BroadcastChannel | null = null;

function set(next: Partial<CounterLockState>, broadcast = true): void {
    const wasLocked = state.locked;
    state = { ...state, ...next };
    for (const l of listeners) l();
    if (wasLocked && !state.locked) for (const l of unlockListeners) l();
    if (broadcast && wasLocked !== state.locked) {
        try { channel?.postMessage({ locked: state.locked, lockedAt: state.lockedAt }); } catch { /* one window */ }
    }
}

if (typeof window !== "undefined" && typeof BroadcastChannel !== "undefined") {
    channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = (e: MessageEvent) => {
        const msg = e.data as { locked?: unknown; lockedAt?: unknown } | null;
        if (typeof msg?.locked !== "boolean") return;
        set({ locked: msg.locked, lockedAt: typeof msg.lockedAt === "number" ? msg.lockedAt : null }, false);
    };
}

export function subscribeCounterLock(onChange: () => void): () => void {
    listeners.add(onChange);
    return () => { listeners.delete(onChange); };
}
export const getCounterLock = (): CounterLockState => state;
export const getServerCounterLock = (): CounterLockState => state;

/** Is the till covered right now? Read by the idle timer, which must count nothing
 *  typed on the lock screen as work. */
export const isCounterLocked = (): boolean => state.locked;

/** Called the moment the cover lifts — the idle timer restarts its clock from it. */
export function onCounterUnlocked(fn: () => void): () => void {
    unlockListeners.add(fn);
    return () => { unlockListeners.delete(fn); };
}

/** Ask the till whether it locks, and whether it is locked now (a refresh, a new
 *  window). Silent on failure: no answer means "signs out as before". */
export async function refreshCounterLock(): Promise<void> {
    try {
        const res = await fetch("/api/counter-lock", { cache: "no-store" });
        if (!res.ok) { set({ enabled: false }, false); return; }
        const out = await res.json() as { enabled?: boolean; locked?: boolean; hasPin?: boolean; lockedAt?: number | null };
        set({
            enabled: out.enabled === true,
            locked: out.locked === true,
            hasPin: out.hasPin === true,
            lockedAt: typeof out.lockedAt === "number" ? out.lockedAt : null,
        });
    } catch {
        set({ enabled: false }, false);
    }
}

/**
 * Cover the till. The screen covers at once — the write to the till follows — and
 * the work up to `lastInputAt` is credited first, because the gap from here on is
 * not work unless he is back within his idle limit (the attendance rule is the same
 * one a sign-out used).
 */
export async function lockCounter(lastInputAt: number): Promise<void> {
    if (state.locked) return;
    const at = lastInputAt > 0 ? lastInputAt : Date.now();
    set({ locked: true, lockedAt: at });
    void fetch("/api/hr/activity", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lastInputAt: new Date(at).toISOString() }),
    }).catch(() => undefined);
    try {
        await fetch("/api/counter-lock", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: "lock", lastInputAt: at }),
        });
    } catch { /* the cover is up; offline the till's own server still answers */ }
}

export type UnlockResult = { ok: true } | { ok: false; error: string; signedOut: boolean };

/** Try a PIN (or, for somebody with no PIN here, the password). */
export async function unlockCounter(secret: { pin: string } | { password: string }): Promise<UnlockResult> {
    try {
        const res = await fetch("/api/counter-lock", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: "unlock", ...secret }),
        });
        const out = await res.json().catch(() => ({})) as {
            ok?: boolean; signedOut?: boolean; error?: string; triesLeft?: number;
        };
        if (out.ok) {
            set({ locked: false, lockedAt: null });
            return { ok: true };
        }
        if (out.signedOut) return { ok: false, signedOut: true, error: out.error ?? "Signed out." };
        const left = typeof out.triesLeft === "number" ? ` ${out.triesLeft} ${out.triesLeft === 1 ? "try" : "tries"} left.` : "";
        return { ok: false, signedOut: false, error: (out.error ?? "Could not unlock.") + left };
    } catch {
        return { ok: false, signedOut: false, error: "Could not reach this counter's server. Try again." };
    }
}
