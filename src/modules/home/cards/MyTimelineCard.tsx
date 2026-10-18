"use client";

import { useEffect, useState } from "react";
import DutyTimeline from "@/modules/hr/timeline/DutyTimeline";
import type { MyDay } from "@/shared/lib/hr/myDay";

/** Re-read with the app's own heartbeat, so Now and the stretches keep up. */
const REFRESH_MS = 5 * 60 * 1000;

/**
 * Today's duty timeline at the top of the office dashboard (owner, 2026-10-16) —
 * the sign-in screen's 24h ruler, for the signed-in person only.
 *
 * `/api/hr/my-day` answers `tracked: false` off a counter (nothing is measured
 * there), and then this draws nothing, like the sign-in screen. Silent on any
 * failure: a missing band must never break the dashboard.
 */
export default function MyTimelineCard() {
    const [day, setDay] = useState<MyDay | null>(null);

    useEffect(() => {
        let alive = true;
        const load = async () => {
            try {
                const res = await fetch("/api/hr/my-day");
                if (!res.ok) return;
                const out = await res.json() as MyDay;
                if (alive) setDay(out?.tracked ? out : null);
            } catch { /* no band */ }
        };
        void load();
        const timer = setInterval(load, REFRESH_MS);
        return () => { alive = false; clearInterval(timer); };
    }, []);

    return day ? <DutyTimeline day={day} inline /> : null;
}
