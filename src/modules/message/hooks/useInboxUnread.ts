"use client";

/**
 * useInboxUnread — total unread chat messages, live from anywhere in the app.
 *
 * Refresh triggers:
 *  - "inbox:unread"  fired by GlobalInboxListener the moment a message arrives
 *                    over the Supabase broadcast (this is what makes the badge
 *                    appear without a page refresh)
 *  - "inbox:read"    fired by InboxModule after a room is marked read, so the
 *                    badge drops at once. Separate event name on purpose —
 *                    InboxModule itself listens to "inbox:unread".
 *  - tab refocus / becoming visible
 *  - a 60 s safety poll, in case the socket was dropped
 */

import { useEffect, useState } from "react";
import axios from "axios";

export function useInboxUnread() {
    const [total, setTotal] = useState(0);

    useEffect(() => {
        const refresh = async () => {
            try {
                const res = await axios.get<{ total: number }>("/api/inbox/unread");
                setTotal(res.data.total ?? 0);
            } catch { /* non-critical */ }
        };

        void refresh();

        const onEvent = () => { void refresh(); };
        const onVisible = () => { if (!document.hidden) void refresh(); };

        window.addEventListener("inbox:unread", onEvent);
        window.addEventListener("inbox:read", onEvent);
        window.addEventListener("focus", onEvent);
        document.addEventListener("visibilitychange", onVisible);
        const interval = setInterval(onEvent, 60_000);

        return () => {
            window.removeEventListener("inbox:unread", onEvent);
            window.removeEventListener("inbox:read", onEvent);
            window.removeEventListener("focus", onEvent);
            document.removeEventListener("visibilitychange", onVisible);
            clearInterval(interval);
        };
    }, []);

    return total;
}
