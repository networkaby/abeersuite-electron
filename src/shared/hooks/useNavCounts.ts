"use client";

/**
 * Sidebar count badges — one poll for all of them.
 *
 * useNavCounts()  — { [surface]: { all, new } } for the Sidebar, refreshed on:
 *      • "nav-counts:changed"  fired by useMarkSurfaceSeen and after a work action,
 *                             so your own doing updates the badges at once
 *      • tab refocus / becoming visible
 *      • a 60 s poll — this is how another person's work reaches your sidebar
 *
 * useMarkSurfaceSeen(surface) — drop this in a board component; on mount it stamps
 *      the marker (opening the list IS looking at it) and tells the badges to
 *      recount, so that surface's `new` clears immediately.
 */

import { useEffect, useState } from "react";
import axios from "axios";
import type { NavCounts, SurfaceCount } from "@/shared/lib/nav/navSurfaces";

/** Fired whenever something may have changed a count. */
export const NAV_COUNTS_CHANGED = "nav-counts:changed";

const EMPTY: SurfaceCount = { all: 0, new: 0 };

export function useNavCounts() {
    const [counts, setCounts] = useState<NavCounts>({});

    useEffect(() => {
        const refresh = async () => {
            try {
                const res = await axios.get<NavCounts>("/api/nav/counts");
                setCounts(res.data ?? {});
            } catch { /* non-critical */ }
        };

        void refresh();

        const onEvent = () => { void refresh(); };
        const onVisible = () => { if (!document.hidden) void refresh(); };

        window.addEventListener(NAV_COUNTS_CHANGED, onEvent);
        window.addEventListener("focus", onEvent);
        document.addEventListener("visibilitychange", onVisible);
        const interval = setInterval(onEvent, 60_000);

        return () => {
            window.removeEventListener(NAV_COUNTS_CHANGED, onEvent);
            window.removeEventListener("focus", onEvent);
            document.removeEventListener("visibilitychange", onVisible);
            clearInterval(interval);
        };
    }, []);

    /** Never undefined — a surface with no row yet simply reads zero. */
    return (surface: string): SurfaceCount => counts[surface] ?? EMPTY;
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
