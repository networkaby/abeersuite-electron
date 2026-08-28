"use client";

import { useEffect, useState } from "react";
import axios from "axios";

/** Mirror of the JSON shape returned by /api/sync/status. */
export type OutboxStatus = {
    isCounter: boolean;
    /** Captured writes not yet pushed, excluding dead-lettered ones. */
    pending: number;
    /** DEAD-LETTERED writes: given up on, and the one state needing a human. */
    failed: number;
    /** Pending writes that have failed at least once and are backing off. */
    retrying: number;
    lastSyncedAt: string | null;
};

/** Same cadence as useCounterMode — see that hook for the reasoning. */
const POLL_MS = 10_000;

/**
 * This PC's pending offline writes, for the shell badge. Returns `null` until
 * the first answer arrives; keeps the last known value on a failed poll
 * rather than flashing "unknown".
 */
export function useOutboxStatus(): OutboxStatus | null {
    const [status, setStatus] = useState<OutboxStatus | null>(null);

    useEffect(() => {
        let cancelled = false;

        const read = async () => {
            try {
                const { data } = await axios.get<OutboxStatus>("/api/sync/status");
                if (!cancelled) setStatus(data);
            } catch {
                // Leave the last known status in place.
            }
        };

        void read();
        const timer = setInterval(() => void read(), POLL_MS);
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
