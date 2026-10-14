"use client";

import { useEffect, useState } from "react";
import { formatHhMmFriendly } from "@/shared/lib/format/formatDate";
import { parseHhMm } from "@/shared/lib/hr/hhmm";
import { nextOpeningText } from "@/shared/lib/hr/nextOpeningText";
import type { NextOfficeDay } from "@/shared/lib/hr/seasonalHours";
import { shopMinute, useNowMinute } from "./useLocalClock";
import styles from "./login.module.css";

/**
 * "Closed tomorrow for Durga Puja. Opens Saturday 26 September, 10:55 AM."
 *
 * The shop-wide answer, under the clock, for everyone who did NOT just sign out of
 * a counter — the man arriving in the morning, the one whose session died
 * overnight, anyone standing at a till that is simply locked. The person who DID
 * just sign out gets a better, personal version of this in `DutyCard`, worked out
 * behind the auth from his own weekly off.
 *
 * Silent on every failure. A sign-in screen that cannot reach the server still has
 * one job, and it is not this one — an error here must never be a reason somebody
 * cannot log in, so the line simply does not appear.
 */
export default function NextOpening() {
    const [line, setLine] = useState<{ today: string; rest: string; hours?: { start: string; end: string } } | null>(null);
    const nowMs = useNowMinute();

    useEffect(() => {
        let alive = true;
        (async () => {
            try {
                const res = await fetch("/api/office-hours/next");
                if (!res.ok) return;
                const out = await res.json() as {
                    today?: { iso: string; closed: boolean; startHhMm: string; endHhMm: string | null; holidayName: string | null };
                    next?: NextOfficeDay;
                };
                if (!alive || !out.today || !out.next) return;

                // Open today: tonight's closing first, then the next opening with any
                // closure on the way — "Closes today at 8:30 PM. Closed tomorrow for
                // Bihu. Opens Friday, 10:55 AM." (owner, 2026-10-13: the lock screen
                // must say both).
                // Today's sentence is the highlighted one (owner, 2026-10-13). It
                // follows the clock (owner, 2026-10-14): before opening it says when
                // the shop opens, after closing that it has closed — see below.
                if (!out.today.closed) {
                    setLine({
                        today: out.today.endHhMm ? `Closes today at ${formatHhMmFriendly(out.today.endHhMm)}.` : "",
                        rest: nextOpeningText(out.next, out.today.iso).full,
                        ...(out.today.endHhMm ? { hours: { start: out.today.startHhMm, end: out.today.endHhMm } } : {}),
                    });
                    return;
                }

                setLine({
                    today: out.today.holidayName ? `Closed today for ${out.today.holidayName}.` : "Closed today.",
                    rest: nextOpeningText(out.next, out.today.iso).opens,
                });
            } catch {
                /* no line, never a blocked sign-in */
            }
        })();
        return () => { alive = false; };
    }, []);

    if (!line) return null;
    let today = line.today;
    if (line.hours && nowMs !== null) {
        const now = shopMinute(nowMs);
        const open = parseHhMm(line.hours.start), close = parseHhMm(line.hours.end);
        if (open !== null && now < open) today = `Opens today at ${formatHhMmFriendly(line.hours.start)}.`;
        else if (close !== null && now >= close) today = "Closed for today.";
    }
    return (
        <p className={styles.nextopen}>
            {/* The next opening steps aside when the till card already says the next
                duty (`.nexthero`, login.module.css) — never the same fact twice. */}
            {today && <strong>{today}</strong>} <span className={styles.nextrest}>{line.rest}</span>
        </p>
    );
}
