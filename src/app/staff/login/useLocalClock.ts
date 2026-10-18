"use client";

import { useMinute } from "@/modules/hr/timeline/useNowMinute";
import { loginGreeting } from "@/shared/lib/constants/loginShowcase";

/** The greeting and the clock line, both from the user's own machine. The sign-in card. */
export function useLocalClock(): { greet: string; clock: string } {
    const minute = useMinute();
    if (minute === null) return { greet: "Welcome", clock: "" };

    const now = new Date(minute * 60_000);
    return {
        greet: loginGreeting(now.getHours()),
        clock: now.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })
            + " · " + now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }),
    };
}


export { useNowMinute } from "@/modules/hr/timeline/useNowMinute";
/** Re-exported for the login screen; the rule lives in hhmm.ts. */
export { shopMinuteOf as shopMinute } from "@/shared/lib/hr/hhmm";
