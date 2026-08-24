"use client";

import { CloudOff, RefreshCw } from "lucide-react";
import { useCounterMode } from "@/shared/hooks/useCounterMode";

/**
 * "You are offline and cannot save" — shown before the cashier finds out by losing
 * a sale, which is the only alternative.
 *
 * Renders NOTHING in the healthy case. A permanent green "online" light is the kind
 * of chrome people stop seeing within a day, which is exactly when it stops working
 * as a warning. This only appears when something is actually worth knowing, so its
 * presence alone carries the message.
 */
export default function CounterStatusBadge() {
    const status = useCounterMode();

    // Not a counter (every laptop, and all of Vercel), or nothing to say yet.
    if (!status || !status.isCounter) return null;

    if (status.mode === "LOCAL") {
        return (
            <span
                className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"
                title="Supabase is unreachable. You can browse and print, but nothing can be saved until the connection returns."
            >
                <CloudOff className="size-3.5" aria-hidden />
                Offline — read only
            </span>
        );
    }

    // Serving local reads while online: correct, but worth surfacing because any
    // staleness a user notices is explained by it.
    if (status.preference !== "live" && status.replicaReady) {
        const sourceNote = status.replicaSource === "installed"
            ? " Running against the PostgreSQL already installed on this PC."
            : status.replicaSource === "embedded"
                ? " Running against this app's own embedded PostgreSQL."
                : "";
        return (
            <span
                className="inline-flex items-center gap-1.5 rounded-md border border-sky-300 bg-sky-50 px-2 py-1 text-xs font-medium text-sky-900 dark:border-sky-700 dark:bg-sky-950 dark:text-sky-200"
                title={`Reading from this machine's local copy, which syncs continuously. Saving works normally.${sourceNote}`}
            >
                <RefreshCw className="size-3.5" aria-hidden />
                Local copy
            </span>
        );
    }

    return null;
}
