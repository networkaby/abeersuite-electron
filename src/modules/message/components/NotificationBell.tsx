"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bell } from "lucide-react";
import axios from "axios";
import { useRealtimeTopics } from "@/shared/hooks/useRealtimeTopics";
import Link from "next/link";
import { useCanOpenPage } from "@/shared/hooks/useCanOpenPage";
import { formatDateTime } from "@/shared/lib/format/formatDate";
import { Button } from "@/components/ui/button";
import { useNotificationUnread, NAV_COUNTS_CHANGED } from "@/shared/hooks/useNavCounts";

interface Notification {
    id: number;
    message: string;
    type: string;
    read: boolean;
    createdAt: string;
    link?: string | null;
}

export default function NotificationBell() {
    // A notice about a page the page lock (pageAccess.ts) keeps this person out of
    // opens the Inbox instead, where the message itself can be read.
    const canOpen = useCanOpenPage();
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    // The sidebar clips anything that spills out of it, so the panel is drawn on
    // document.body at the bell's screen position and kept inside the window.
    const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

    // The badge number rides the shared sidebar poll — no timer of its own. The
    // list itself (25 rows of message text) is only fetched when the panel is
    // actually opened, instead of every 30 s into a closed dropdown.
    const unread = useNotificationUnread();

    const loadNotifications = useCallback(() => {
        void (async () => {
            try {
                const res = await axios.get("/api/notifications");
                setNotifications(res.data);
            } catch {
                // silent
            }
        })();
    }, []);

    useEffect(() => {
        if (!open) return;
        loadNotifications();
    }, [open, loadNotifications]);

    // While the panel is OPEN, a notification raised elsewhere is added to the
    // list under the reader. Closed, this stays silent — the badge is the shared
    // sidebar count and needs no second fetch of 25 rows of message text.
    useRealtimeTopics(["tasks"], loadNotifications, open);

    useEffect(() => {
        const handler = (e: MouseEvent) => {
            const t = e.target as Node;
            if (ref.current?.contains(t) || panelRef.current?.contains(t)) return;
            setOpen(false);
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, []);

    useEffect(() => {
        if (!open) return;
        const place = () => {
            const r = ref.current?.getBoundingClientRect();
            if (!r) return;
            const width = 320;
            const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
            setPos({ top: r.bottom + 4, left });
        };
        place();
        window.addEventListener("resize", place);
        window.addEventListener("scroll", place, true);
        return () => {
            window.removeEventListener("resize", place);
            window.removeEventListener("scroll", place, true);
        };
    }, [open]);

    // Both mark-read paths tell the shared store to recount, so the badge drops at
    // once rather than waiting for the next poll.
    const markAllRead = async () => {
        await axios.patch("/api/notifications");
        setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
        window.dispatchEvent(new CustomEvent(NAV_COUNTS_CHANGED));
    };

    const markOneRead = async (id: number) => {
        await axios.patch(`/api/notifications/${id}`);
        setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
        window.dispatchEvent(new CustomEvent(NAV_COUNTS_CHANGED));
    };

    return (
        <div ref={ref} className="relative">
            <Button
                onClick={() => setOpen((v) => !v)}
                variant="ghost"
                size="icon-sm"
                className="relative text-muted-foreground hover:bg-muted"
            >
                <Bell size={20} />
                {unread > 0 && (
                    <span className="absolute top-0.5 right-0.5 w-4 h-4 bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
                        {unread > 9 ? "9+" : unread}
                    </span>
                )}
            </Button>

            {open && pos && createPortal(
                <div
                    ref={panelRef}
                    style={{ top: pos.top, left: pos.left }}
                    className="fixed z-[100] w-80 rounded-lg border border-border bg-card shadow"
                >
                    <div className="flex items-center justify-between border-b border-border bg-muted px-4 py-3">
                        <span className="text-sm font-semibold text-foreground">Notifications</span>
                        {unread > 0 && (
                            <Button onClick={markAllRead} variant="link" size="xs" className="h-auto p-0 text-xs">
                                Mark all read
                            </Button>
                        )}
                    </div>

                    <div className="max-h-80 overflow-y-auto divide-y divide-border">
                        {notifications.length === 0 ? (
                            <p className="text-center text-sm text-muted-foreground py-6">No notifications</p>
                        ) : (
                            notifications.map((n) => (
                                <Link
                                    key={n.id}
                                    href={n.link && canOpen(n.link) ? n.link : "/office/message/inbox"}
                                    onClick={() => { markOneRead(n.id); setOpen(false); }}
                                    className={`block px-4 py-3 hover:bg-muted transition-colors ${n.read ? "opacity-60" : ""}`}
                                >
                                    <div className="flex items-start gap-2">
                                        {!n.read && (
                                            <span className="mt-1.5 w-2 h-2 bg-primary shrink-0" />
                                        )}
                                        <div className={!n.read ? "" : "pl-4"}>
                                            <p className="text-sm text-foreground leading-snug">{n.message}</p>
                                            <p className="text-xs text-muted-foreground mt-0.5">
                                                {formatDateTime(n.createdAt)}
                                            </p>
                                        </div>
                                    </div>
                                </Link>
                            ))
                        )}
                    </div>
                </div>,
                document.body,
            )}
        </div>
    );
}
