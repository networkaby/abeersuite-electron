"use client";

import { useEffect, useState } from "react";
import { nextOpeningText } from "@/shared/lib/hr/nextOpeningText";
import type { NextOfficeDay } from "@/shared/lib/hr/seasonalHours";
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
    const [line, setLine] = useState("");

    useEffect(() => {
        let alive = true;
        (async () => {
            try {
                const res = await fetch("/api/office-hours/next");
                if (!res.ok) return;
                const out = await res.json() as {
                    today?: { iso: string; closed: boolean; startHhMm: string; holidayName: string | null };
                    next?: NextOfficeDay;
                };
                if (!alive || !out.today || !out.next) return;

                // Open today: the useful fact is tonight's closing, not next week's
                // opening — he is about to start a shift, not plan one. The next
                // working day is only news when today is not one.
                if (!out.today.closed) return;

                const why = out.today.holidayName ? `Closed today for ${out.today.holidayName}.` : "Closed today.";
                setLine(`${why} ${nextOpeningText(out.next, out.today.iso).opens}`);
            } catch {
                /* no line, never a blocked sign-in */
            }
        })();
        return () => { alive = false; };
    }, []);

    if (!line) return null;
    return <p className={styles.nextopen}>{line}</p>;
}
