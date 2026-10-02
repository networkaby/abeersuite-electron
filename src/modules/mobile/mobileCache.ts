"use client";

import { readCache, userScopedKey, writeCache } from "@/shared/lib/browser/pollCache";

/** How many saved answers (searches + party bill lists) one person keeps on a phone. */
const MAX_ENTRIES = 30;

const PREFIX = "m:";

/** The phone app's localStorage key — always scoped to the signed-in person. */
export function mobileKey(name: string, userId: string | number): string {
    return userScopedKey(`${PREFIX}${name}`, userId);
}

export function readMobileCache<T>(key: string): T | null {
    return readCache<T>(key)?.data ?? null;
}

/**
 * Save an answer, then drop this person's oldest ones past `MAX_ENTRIES`.
 *
 * Every search typed is its own key ("a4", "a4 p", "a4 paper"), so without the cap
 * the phone's storage would only ever grow.
 */
export function writeMobileCache<T>(key: string, data: T, userId: string | number): void {
    writeCache(key, data, new Date().toISOString());
    try {
        const suffix = userScopedKey("", userId);
        const mine: { key: string; at: string }[] = [];
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (!k?.startsWith(PREFIX) || !k.endsWith(suffix)) continue;
            mine.push({ key: k, at: readCache<unknown>(k)?.computedAt ?? "" });
        }
        if (mine.length <= MAX_ENTRIES) return;
        mine.sort((a, b) => a.at.localeCompare(b.at));
        for (const old of mine.slice(0, mine.length - MAX_ENTRIES)) localStorage.removeItem(old.key);
    } catch { /* private mode / blocked storage — nothing saved, nothing to trim */ }
}
