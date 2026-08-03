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
 */

import { useCallback, useEffect, useSyncExternalStore } from "react";
import axios from "axios";
import type { NavCountsPayload, SurfaceCount } from "@/shared/lib/nav/navSurfaces";
import { NAV_COUNTS_POLL_MS } from "@/shared/lib/constants/polling";

/** Fired whenever something may have changed a count. */
export const NAV_COUNTS_CHANGED = "nav-counts:changed";

const EMPTY: SurfaceCount = { all: 0, new: 0 };
const INITIAL: NavCountsPayload = { surfaces: {}, inboxUnread: 0, notificationUnread: 0 };

// ── the store ────────────────────────────────────────────────────────────────
let state: NavCountsPayload = INITIAL;
const listeners = new Set<() => void>();
let inFlight: Promise<void> | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

function emit() {
    for (const l of listeners) l();
}

/** Concurrent callers share one request — several badges mounting together is one fetch. */
function refresh(): Promise<void> {
    if (inFlight) return inFlight;
    inFlight = axios
        .get<NavCountsPayload>("/api/nav/counts")
        .then((res) => {
            state = res.data ?? INITIAL;
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

/** First mounted badge wires everything up; the last one to leave tears it down. */
function subscribe(listener: () => void) {
    listeners.add(listener);
    if (listeners.size === 1) {
        window.addEventListener(NAV_COUNTS_CHANGED, onEvent);
        window.addEventListener("inbox:unread", onEvent);
        window.addEventListener("inbox:read", onEvent);
        window.addEventListener("focus", onEvent);
        document.addEventListener("visibilitychange", onVisibility);
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
            stopTimer();
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
