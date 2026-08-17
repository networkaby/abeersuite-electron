"use client";

/**
 * The browser half of the poll-and-skip pattern.
 *
 * Polling surfaces (finance top bar, sidebar badges) keep their last successful
 * response here and hand its `computedAt` back to the server as `?since=`. The
 * server then answers a cheap `{ unchanged: true }` instead of recomputing, so a
 * quiet tab costs almost nothing. The server stays stateless — the browser is
 * what remembers — which matters on serverless, where a process-memory cache
 * would not survive between invocations anyway.
 *
 * localStorage (not sessionStorage / in-memory) on purpose: it is shared by every
 * tab of the origin, so a second tab seeds instantly, and a write in one tab
 * raises the native `storage` event in the others — `subscribeToCache` below —
 * letting them adopt fresh data rather than each running its own poll.
 *
 * SCOPE THE KEY TO THE USER for anything user-specific. localStorage is
 * per-origin, not per-login: on a shared counter machine the next person to sign
 * in reads whatever the last one left. Org-wide figures (a cash balance is the
 * same number whoever looks) can use a plain key; anything that depends on who
 * is asking must pass `userId` — see `userScopedKey`.
 *
 * Every operation is best-effort: private mode, a full quota or a half-written
 * entry all degrade to "no cache", which just means a normal full fetch.
 */

export type CachedEntry<T> = { data: T; computedAt: string };

/** Key for data that differs per user. Never cache such data on a bare key. */
export function userScopedKey(key: string, userId: number | string): string {
    return `${key}:u${userId}`;
}

export function readCache<T>(key: string): CachedEntry<T> | null {
    if (typeof window === "undefined") return null;
    try {
        const raw = window.localStorage.getItem(key);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as CachedEntry<T>;
        return parsed && typeof parsed.computedAt === "string" ? parsed : null;
    } catch {
        return null;
    }
}

export function writeCache<T>(key: string, data: T, computedAt: string): void {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.setItem(key, JSON.stringify({ data, computedAt }));
    } catch { /* quota / private mode — this tab just keeps polling normally */ }
}

/**
 * Run `onChange` when another tab writes `key`. Returns the unsubscribe function.
 * Note the browser only fires `storage` in OTHER tabs, never the writer, so this
 * cannot loop back on itself.
 */
export function subscribeToCache<T>(
    key: string,
    onChange: (entry: CachedEntry<T>) => void,
): () => void {
    const handler = (e: StorageEvent) => {
        if (e.key !== key || !e.newValue) return;
        try {
            const parsed = JSON.parse(e.newValue) as CachedEntry<T>;
            if (parsed && typeof parsed.computedAt === "string") onChange(parsed);
        } catch { /* malformed — ignore; this tab's own next poll recovers */ }
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
}
