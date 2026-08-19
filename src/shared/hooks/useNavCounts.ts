"use client";

/**
 * Sidebar badges — ONE poll for all of them, app-wide.
 *
 * Every badge in the chrome (surface counts, chat unread, the notification bell)
 * reads from a single module-level store fed by a single request to
 * /api/nav/counts. Previously each badge ran its own `setInterval`, so a tab open
 * all day made three separate rounds of database queries every minute; that was
 * the bulk of our database egress.
 *
 * The poll:
 *   • starts when the first badge mounts, stops when the last one unmounts,
 *   • ticks only while the tab is VISIBLE — a tab behind another window costs
 *     nothing — and refreshes immediately on becoming visible again, so returning
 *     to the tab never shows a stale badge,
 *   • can be forced at any moment via refreshNavCounts() — the sidebar's refresh
 *     button, which is why the interval itself can afford to be slow,
 *   • also refreshes on "nav-counts:changed" (fired by useMarkSurfaceSeen and after
 *     a work action, so your own doing updates the badges at once), on "inbox:unread"
 *     (a message arrived over the Supabase broadcast) and on "inbox:read".
 *
 * useMarkSurfaceSeen(surface) — drop this in a board component; on mount it stamps
 *      the marker (opening the list IS looking at it) and tells the badges to
 *      recount, so that surface's `new` clears immediately.
 *
 * Cross-tab: each fetched payload is mirrored into localStorage, so the moment
 * ANY tab fetches fresh counts every other open tab adopts them live over the
 * browser's "storage" event instead of running a poll of its own.
 *
 * These counts are PER USER (your work gate, your seen markers) while
 * localStorage is per-origin, so the cache is filed under the user id the server
 * reports. A tab therefore cannot read an entry until its first response says
 * who is signed in — which is why the first fetch of a tab is always a full one,
 * and why the person who signs in next on a shared counter machine can never be
 * shown the previous one's badges.
 */

import { useCallback, useEffect, useSyncExternalStore } from "react";
import axios from "axios";
import type { NavCountsPayload, SurfaceCount } from "@/shared/lib/nav/navSurfaces";
import { NAV_COUNTS_POLL_MS } from "@/shared/lib/constants/polling";
import {
    subscribeToCache,
    userScopedKey,
    writeCache,
    type CachedEntry,
} from "@/shared/lib/browser/pollCache";
import { onChangeSignal } from "@/shared/lib/realtime/appChannel";

/** Fired whenever something may have changed a count. */
export const NAV_COUNTS_CHANGED = "nav-counts:changed";

const EMPTY: SurfaceCount = { all: 0, new: 0 };
const INITIAL: NavCountsPayload = { surfaces: {}, inboxUnread: 0, notificationUnread: 0 };

type NavCountsResponse =
    | (NavCountsPayload & { computedAt: string; userId: number })
    | { unchanged: true; computedAt: string };

const CACHE_KEY = "nav-counts-cache:v1";

// ── the store ────────────────────────────────────────────────────────────────
let state: NavCountsPayload = INITIAL;
// Server time from the last successful fetch — handed back as `?since=` so the
// server can answer "unchanged" cheaply instead of recomputing. Keeping it here
// in the browser is what lets the server side stay stateless.
let lastCheckedAt: string | null = null;
// Set from the first response; until then this tab does not know whose counts
// it is allowed to read, so it neither seeds from nor listens to the cache.
let cacheKey: string | null = null;
let unsubscribeCache: (() => void) | null = null;
const listeners = new Set<() => void>();
let inFlight: Promise<void> | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

function emit() {
    for (const l of listeners) l();
}

/** Adopt what another tab just fetched, rather than fetching it again here. */
function adopt(entry: CachedEntry<NavCountsPayload>) {
    lastCheckedAt = entry.computedAt;
    state = entry.data;
    emit();
}

/** Learn which user's cache this tab may use, then seed and sync from it. */
function bindCache(userId: number) {
    const key = userScopedKey(CACHE_KEY, userId);
    if (cacheKey === key) return;
    unsubscribeCache?.();
    cacheKey = key;
    unsubscribeCache = subscribeToCache<NavCountsPayload>(key, adopt);
}

/** Concurrent callers share one request — several badges mounting together is one fetch. */
function refresh(): Promise<void> {
    if (inFlight) return inFlight;
    inFlight = axios
        .get<NavCountsResponse>("/api/nav/counts", {
            params: lastCheckedAt ? { since: lastCheckedAt } : undefined,
        })
        .then((res) => {
            const data = res.data;
            if (!data?.computedAt) return;
            lastCheckedAt = data.computedAt;
            if ("unchanged" in data) return;
            bindCache(data.userId);
            // Only the counts go into the store — `computedAt` / `userId` are
            // transport, and would otherwise ride along into every cached copy.
            state = {
                surfaces: data.surfaces,
                inboxUnread: data.inboxUnread,
                notificationUnread: data.notificationUnread,
            };
            if (cacheKey) writeCache(cacheKey, state, data.computedAt);
            emit();
        })
        .catch(() => { /* non-critical */ })
        .finally(() => { inFlight = null; });
    return inFlight;
}

const onEvent = () => { void refresh(); };

function startTimer() {
    if (timer || (typeof document !== "undefined" && document.hidden)) return;
    timer = setInterval(onEvent, NAV_COUNTS_POLL_MS);
}
function stopTimer() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
}
function onVisibility() {
    if (document.hidden) {
        stopTimer();
    } else {
        void refresh();   // catch up on what changed while we were away
        startTimer();
    }
}

/** Someone finished a ticket work / a new one arrived — badges recount instantly
 *  instead of waiting for the poll (now a distant fallback, see NAV_COUNTS_POLL_MS).
 *  Only the tab that becomes Realtime leader ever fires this — followers still
 *  get it, since a badge recount is a local read, not a live push, and every
 *  tab already recounts on its own focus/visibility. */
let unsubscribeChangeSignal: (() => void) | null = null;

/** First mounted badge wires everything up; the last one to leave tears it down. */
function subscribe(listener: () => void) {
    listeners.add(listener);
    if (listeners.size === 1) {
        window.addEventListener(NAV_COUNTS_CHANGED, onEvent);
        window.addEventListener("inbox:unread", onEvent);
        window.addEventListener("inbox:read", onEvent);
        window.addEventListener("focus", onEvent);
        document.addEventListener("visibilitychange", onVisibility);
        unsubscribeChangeSignal = onChangeSignal((sig) => {
            if (sig.topics.includes("tickets")) onEvent();
        });
        void refresh();
        startTimer();
    }
    return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
            window.removeEventListener(NAV_COUNTS_CHANGED, onEvent);
            window.removeEventListener("inbox:unread", onEvent);
            window.removeEventListener("inbox:read", onEvent);
            window.removeEventListener("focus", onEvent);
            document.removeEventListener("visibilitychange", onVisibility);
            unsubscribeChangeSignal?.();
            unsubscribeChangeSignal = null;
            stopTimer();
            unsubscribeCache?.();
            unsubscribeCache = null;
            cacheKey = null;
        }
    };
}

const getSnapshot = () => state;
const getServerSnapshot = () => INITIAL;

function useNavCountsPayload(): NavCountsPayload {
    return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

// ── public hooks ─────────────────────────────────────────────────────────────

export function useNavCounts() {
    const payload = useNavCountsPayload();
    /** Never undefined — a surface with no row yet simply reads zero. */
    return useCallback(
        (surface: string): SurfaceCount => payload.surfaces[surface] ?? EMPTY,
        [payload],
    );
}

/** Total unread chat messages, live from anywhere in the app. */
export function useInboxUnread() {
    return useNavCountsPayload().inboxUnread;
}

/** Unread count for the notification bell. */
export function useNotificationUnread() {
    return useNavCountsPayload().notificationUnread;
}

/**
 * Recount now — for a manual refresh control. Exported as a plain function (not a
 * hook) so any button anywhere can call it; every mounted badge updates together.
 */
export function refreshNavCounts() {
    void refresh();
}

export function useMarkSurfaceSeen(surface: string) {
    useEffect(() => {
        void (async () => {
            try {
                await axios.post("/api/nav/seen", { surface });
                window.dispatchEvent(new CustomEvent(NAV_COUNTS_CHANGED));
            } catch { /* non-critical */ }
        })();
    }, [surface]);
}
