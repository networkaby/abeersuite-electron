"use client";

import { useSyncExternalStore } from "react";
import { loginGreeting } from "@/shared/lib/constants/loginShowcase";
import { BUSINESS_TIME_ZONE } from "@/shared/lib/constants/business";

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

/** The machine's clock to the minute (ms), or null on the server. Ticks with the greeting. */
export function useNowMinute(): number | null {
    const minute = useSyncExternalStore(subscribeToMinute, currentMinute, noMinuteOnServer);
    return minute === null ? null : minute * 60_000;
}

/** The greeting and the clock line, both from the user's own machine. Sign-in card and lock cover. */
export function useLocalClock(): { greet: string; clock: string } {
    const minute = useSyncExternalStore(subscribeToMinute, currentMinute, noMinuteOnServer);
    if (minute === null) return { greet: "Welcome", clock: "" };

    const now = new Date(minute * 60_000);
    return {
        greet: loginGreeting(now.getHours()),
        clock: now.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })
            + " · " + now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }),
    };
}

/** An instant → minutes past midnight on the shop's clock (duty hours are shop time). */
export function shopMinute(ms: number): number {
    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: BUSINESS_TIME_ZONE, hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(new Date(ms));
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
    return (get("hour") % 24) * 60 + get("minute");
}
