"use client";

import { useEffect, useState } from "react";
import axios from "axios";

/** Mirror of `counterStatus()` in shared/lib/prisma/counterMode.ts. */
export type CounterStatus = {
    mode: "LIVE" | "LOCAL";
    /** READ_MODE — where reads are served from. */
    preference: "live" | "shadow" | "local";
    /** WRITE_MODE — where writes land. */
    writePreference: "live" | "local";
    replicaReady: boolean;
    isCounter: boolean;
    replicaSource: "installed" | "embedded" | null;
    /**
     * Whether the last outbox flush reached Supabase.
     *
     * Under WRITE_MODE=local nothing on the request path touches Supabase, so this —
     * not `mode` — is what says whether the counter's work is leaving the machine.
     */
    cloudReachable: boolean;
    lastFlushAt: string | null;
};

/**
 * How often to ask.
 *
 * This was 30s, justified on the grounds that "a cashier learns the shop is offline from
 * the failed Save either way". That justification no longer holds, twice over: offline
 * writes now mean some saves SUCCEED while offline, so a failed save is no longer the
 * reliable teacher it was; and the badge is now a permanent green/red light rather than
 * a warning that only appears when something is wrong. A permanent light that can be
 * half a minute stale is worse than no light, because people believe it.
 *
 * 10s is still not a heartbeat. The endpoint answers from process memory plus, at most,
 * one small query against the LOCAL database per 30s TTL (`refreshReplicaReadiness`) —
 * it never touches Supabase, so a faster poll costs no egress, which is the thing this
 * whole project exists to protect.
 */
const POLL_MS = 10_000;

/**
 * Where this machine is reading from, for the shell badge.
 *
 * Returns `null` until the first answer arrives, and keeps returning a non-counter
 * status on ordinary machines so callers can render nothing. Never throws and never
 * toasts on failure: if this endpoint is unreachable the user already has bigger
 * problems, and a status widget that raises its own errors is pure noise.
 */
export function useCounterMode(): CounterStatus | null {
    const [status, setStatus] = useState<CounterStatus | null>(null);

    useEffect(() => {
        let cancelled = false;

        const read = async () => {
            try {
                const { data } = await axios.get<CounterStatus>("/api/counter/status");
                if (!cancelled) setStatus(data);
            } catch {
                // Leave the last known status in place rather than flashing "unknown".
            }
        };

        void read();
        const timer = setInterval(() => void read(), POLL_MS);
        // Coming back to the tab is the moment the answer matters most, and the
        // moment it is most likely to be stale.
        const onVisible = () => {
            if (document.visibilityState === "visible") void read();
        };
        document.addEventListener("visibilitychange", onVisible);

        return () => {
            cancelled = true;
            clearInterval(timer);
            document.removeEventListener("visibilitychange", onVisible);
        };
    }, []);

    return status;
}
