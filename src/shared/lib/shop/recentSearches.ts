/**
 * Recent searches, kept on the shopper's own device only — the website search
 * box and the customer app's search screen each keep their own list.
 * Storage can be blocked (private mode, a strict browser): never break on it.
 */

export const RECENT_SEARCHES_MAX = 8;

export function readRecentRaw(key: string): string {
    try {
        return localStorage.getItem(key) ?? "[]";
    } catch {
        return "[]";
    }
}

export function parseRecent(raw: string): string[] {
    try {
        const v = JSON.parse(raw);
        return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
    } catch {
        return [];
    }
}

export function writeRecent(key: string, list: string[]) {
    try {
        localStorage.setItem(key, JSON.stringify(list.slice(0, RECENT_SEARCHES_MAX)));
    } catch {
        /* storage blocked — recent searches just aren't remembered */
    }
}

/** Put `term` first, drop its older copy (any case), keep the list short. */
export function pushRecent(list: string[], term: string): string[] {
    const t = term.trim();
    if (!t) return list;
    return [t, ...list.filter((r) => r.toLowerCase() !== t.toLowerCase())].slice(0, RECENT_SEARCHES_MAX);
}
