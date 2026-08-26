"use client";

import { RefreshCw, Wifi, WifiOff } from "lucide-react";
import { useCounterMode } from "@/shared/hooks/useCounterMode";

/**
 * Connection state for a counter, always visible while the app is on one.
 *
 * ── Why this is now a permanent light ────────────────────────────────────────
 * It used to render NOTHING in the healthy case, on the reasoning that a permanent
 * green light is chrome people stop seeing within a day. That reasoning holds for a
 * pure warning — but it stopped matching what a cashier now needs to know.
 *
 * Since offline writes landed, "offline" no longer means one thing. Some documents can
 * still be saved (the ones enabled in Settings → Offline Policies, which queue locally
 * and push on reconnect) and others cannot. A cashier deciding whether to start a sale
 * needs the connection state BEFORE they start, and an indicator that is absent most of
 * the time cannot answer "is it working right now?" — absence reads the same as "I
 * haven't loaded yet". Owner asked for green/red, and that is the right call here.
 *
 * Green is deliberately not silent-green: it still names WHICH database is answering,
 * because that is what explains any staleness a user notices.
 */
export default function CounterStatusBadge() {
    const status = useCounterMode();

    // Not a counter (every laptop, and all of Vercel), or nothing to say yet. Rendering
    // nothing here matters: on a non-counter there is no meaningful state to report, and
    // a grey "unknown" pill on every office page would be pure noise.
    if (!status || !status.isCounter) return null;

    const base = "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium";

    // ── RED: Supabase is unreachable ─────────────────────────────────────────
    // `mode === "LOCAL"` is set by reportLiveDown() in counterMode.ts after a live read
    // actually fails — it is measured, not guessed from navigator.onLine, which reports
    // the LAN and says nothing about whether Supabase is reachable.
    if (status.mode === "LOCAL") {
        return (
            <span
                className={`${base} border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-700 dark:bg-rose-950 dark:text-rose-200`}
                title="No connection to the server. You can browse normally, and the counter sales enabled in Settings → Offline Policies can still be saved — they queue on this PC and upload by themselves when the connection returns. Anything not on that list cannot be saved until then."
                aria-label="Offline — working from this computer's local copy"
            >
                <WifiOff className="size-3.5" aria-hidden />
                Offline
            </span>
        );
    }

    // ── GREEN: connected ─────────────────────────────────────────────────────
    // Two shades of the same good state, distinguished by which database is serving
    // reads — worth naming, because it is the explanation for any staleness.
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
            {servingLocal ? "Local copy" : "Online"}
        </span>
    );
}
