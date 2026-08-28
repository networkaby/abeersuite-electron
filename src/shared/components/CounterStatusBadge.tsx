"use client";

import { RefreshCw, Wifi, WifiOff } from "lucide-react";
import { useCounterMode } from "@/shared/hooks/useCounterMode";

/**
 * Connection state for a counter, always visible while the app is on one.
 *
 * Green is deliberately not silent-green: it still names WHICH database is answering,
 * because that is what explains any staleness a user notices.
 *
 * The top bar has very little room, so the visible label is just two words —
 * "Local" / "Live", naming which database is answering — with red/green
 * carrying the online/offline distinction.
 */
export default function CounterStatusBadge() {
    const status = useCounterMode();

    if (!status || !status.isCounter) return null;

    const base = "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium";

    // ── RED: Supabase is unreachable ─────────────────────────────────────────
    if (status.mode === "LOCAL" || status.cloudReachable === false) {
        return (
            <span
                className={`${base} border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-700 dark:bg-rose-950 dark:text-rose-200`}
                title="No connection to the server. You can browse normally, and any offline-enabled counter actions can still be saved locally. Anything requiring server verification cannot be saved until connection returns."
                aria-label="Offline — working from this computer's local copy"
            >
                <WifiOff className="size-3.5" aria-hidden />
                Local
            </span>
        );
    }

    // ── GREEN: connected ─────────────────────────────────────────────────────
    const servingLocal = status.preference !== "live" && status.replicaReady;

    const sourceNote = status.replicaSource === "installed"
        ? " Running against the PostgreSQL already installed on this PC."
        : status.replicaSource === "embedded"
            ? " Running against this app's own embedded PostgreSQL."
            : "";

    return (
        <span
            className={`${base} border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-200`}
            title={
                servingLocal
                    ? `Connected. Pages load from this machine's own copy, which keeps itself up to date, so they open instantly and cost nothing to read. Saving goes to the server as normal.${sourceNote}`
                    : "Connected. Pages are loading from the server — this machine's local copy is still catching up and will take over on its own once it is ready."
            }
            aria-label={servingLocal ? "Online — reading from the local copy" : "Online — reading from the server"}
        >
            {servingLocal
                ? <RefreshCw className="size-3.5" aria-hidden />
                : <Wifi className="size-3.5" aria-hidden />}
            {servingLocal ? "Local" : "Live"}
        </span>
    );
}
