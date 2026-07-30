"use client";

/**
 * useWorkInboxCounts — { all, new } for the Sidebar Work Flow badge, live from
 * anywhere in the app.
 *
 * Unlike the chat inbox there is no Supabase broadcast for work, so the live
 * mechanism is poll + refocus:
 *  - "work-inbox:changed"  fired by WorkInboxBoard after it marks the page seen
 *                          and after a work action, so your own doing updates
 *                          the badge at once
 *  - tab refocus / becoming visible
 *  - a 60 s poll — this is how another person's work reaches your sidebar
 */

import { useEffect, useState } from "react";
import axios from "axios";

export type WorkInboxCounts = { all: number; new: number };

export function useWorkInboxCounts(): WorkInboxCounts {
    const [counts, setCounts] = useState<WorkInboxCounts>({ all: 0, new: 0 });

    useEffect(() => {
        const refresh = async () => {
            try {
                const res = await axios.get<WorkInboxCounts>("/api/work-inbox/count");
                setCounts({ all: res.data.all ?? 0, new: res.data.new ?? 0 });
            } catch { /* non-critical */ }
        };

        void refresh();

        const onEvent = () => { void refresh(); };
        const onVisible = () => { if (!document.hidden) void refresh(); };

        window.addEventListener("work-inbox:changed", onEvent);
        window.addEventListener("focus", onEvent);
        document.addEventListener("visibilitychange", onVisible);
        const interval = setInterval(onEvent, 60_000);

        return () => {
            window.removeEventListener("work-inbox:changed", onEvent);
            window.removeEventListener("focus", onEvent);
            document.removeEventListener("visibilitychange", onVisible);
            clearInterval(interval);
        };
    }, []);

    return counts;
}
