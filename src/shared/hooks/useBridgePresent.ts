"use client";

import { useEffect, useState } from "react";
import { isBridgeAvailable } from "@/shared/lib/bridge";

/**
 * Is this browser running on a counter machine (i.e. is the bridge installed)?
 *
 * `null` while the probe is still out — callers must treat that as "don't know
 * yet" and NOT as "no". Reading local cache on a null would leak the books onto a
 * machine that turns out not to be a counter; purging on a null would throw away a
 * real counter's copy every time the page loads.
 */
export function useBridgePresent(): boolean | null {
    const [present, setPresent] = useState<boolean | null>(null);

    useEffect(() => {
        let cancelled = false;
        void isBridgeAvailable().then((v) => { if (!cancelled) setPresent(v); });
        return () => { cancelled = true; };
    }, []);

    return present;
}
