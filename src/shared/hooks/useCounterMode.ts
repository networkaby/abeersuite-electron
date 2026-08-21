"use client";

import { useEffect, useState } from "react";
import axios from "axios";

/** Mirror of `counterStatus()` in shared/lib/prisma/counterMode.ts. */
export type CounterStatus = {
    mode: "LIVE" | "LOCAL";
    preference: "live" | "shadow" | "local";
    replicaReady: boolean;
    isCounter: boolean;
};

/**
 * How often to ask. Deliberately slow: this is a status light, not a heartbeat, and
 * on a counter every poll is a request the machine could have spent on real work.
 * A cashier learns the shop is offline from the failed Save either way — the badge
 * exists so they learn it BEFORE trying, not so they learn it a second sooner.
 */
const POLL_MS = 30_000;

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
