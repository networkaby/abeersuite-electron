"use client";

import { useSyncExternalStore } from "react";

// ── The clock, as an outside thing React reads ──────────────────────────────
// The time is not React state — it is the machine's clock — so it is subscribed
// to rather than copied into state. Ticking every twenty seconds is plenty for a
// display that only shows minutes, and the snapshot is the minute itself so a
// tick that lands inside the same minute re-renders nothing.
function subscribeToMinute(onChange: () => void): () => void {
    const timer = setInterval(onChange, 20_000);
    return () => clearInterval(timer);
}
const currentMinute = () => Math.floor(Date.now() / 60_000);
/** The server has no idea what time it is where the user is, so it renders no clock at all. */
const noMinuteOnServer = () => null;

/** The machine's clock as a whole minute number, or null on the server. */
export function useMinute(): number | null {
    return useSyncExternalStore(subscribeToMinute, currentMinute, noMinuteOnServer);
}

/** The machine's clock to the minute (ms), or null on the server. Ticks with the greeting. */
export function useNowMinute(): number | null {
    const minute = useMinute();
    return minute === null ? null : minute * 60_000;
}
