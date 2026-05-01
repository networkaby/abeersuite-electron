"use client";

import { useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import axios from "axios";
import Link from "next/link";
import { formatDateTime } from "@/lib/format-date";
import { Button } from "@/components/ui/button";

interface Notification {
    id: number;
    message: string;
    type: string;
    read: boolean;
    createdAt: string;
    link?: string | null;
}

export default function NotificationBell() {
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    const unread = notifications.filter((n) => !n.read).length;

    useEffect(() => {
        const loadNotifications = async () => {
            try {
                const res = await axios.get("/api/notifications");
                setNotifications(res.data);
            } catch {
                // silent
            }
        };

        void loadNotifications();
        const interval = setInterval(() => {
            void loadNotifications();
        }, 30_000);
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, []);

    const markAllRead = async () => {
        await axios.patch("/api/notifications");
        setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    };

    const markOneRead = async (id: number) => {
        await axios.patch(`/api/notifications/${id}`);
        setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
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

            {open && (
                <div className="absolute left-0 top-full z-50 mt-1 w-80 rounded-lg border border-border bg-card shadow">
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
                                    href={n.link ?? "/inbox"}
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
                </div>
            )}
        </div>
    );
}
