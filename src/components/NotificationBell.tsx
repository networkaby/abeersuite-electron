"use client";

import { useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import axios from "axios";
import Link from "next/link";
import { formatDateTime } from "@/lib/format-date";

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

    const fetchNotifications = async () => {
        try {
            const res = await axios.get("/api/notifications");
            setNotifications(res.data);
        } catch {
            // silent
        }
    };

    useEffect(() => {
        const load = () => { fetchNotifications(); };
        load();
        const interval = setInterval(load, 30_000);
        return () => clearInterval(interval);
    }, []);

    // Close dropdown when clicking outside
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) {
                setOpen(false);
            }
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
        setNotifications((prev) =>
            prev.map((n) => (n.id === id ? { ...n, read: true } : n))
        );
    };

    return (
        <div ref={ref} className="relative">
            <button
                onClick={() => setOpen((v) => !v)}
                className="relative p-2 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
            >
                <Bell size={20} />
                {unread > 0 && (
                    <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                        {unread > 9 ? "9+" : unread}
                    </span>
                )}
            </button>

            {open && (
                <div className="absolute left-0 top-full mt-2 w-80 bg-white rounded-xl shadow-xl border z-50">
                    <div className="flex items-center justify-between px-4 py-3 border-b">
                        <span className="text-sm font-semibold text-gray-700">Notifications</span>
                        {unread > 0 && (
                            <button
                                onClick={markAllRead}
                                className="text-xs text-primary hover:underline"
                            >
                                Mark all read
                            </button>
                        )}
                    </div>

                    <div className="max-h-80 overflow-y-auto divide-y">
                        {notifications.length === 0 ? (
                            <p className="text-center text-sm text-gray-400 py-6">No notifications</p>
                        ) : (
                            notifications.map((n) => (
                                <Link
                                    key={n.id}
                                    href={n.link ?? "/inbox"}
                                    onClick={() => {
                                        markOneRead(n.id);
                                        setOpen(false);
                                    }}
                                    className={`block px-4 py-3 hover:bg-gray-50 transition-colors ${n.read ? "opacity-60" : ""}`}
                                >
                                    <div className="flex items-start gap-2">
                                        {!n.read && (
                                            <span className="mt-1.5 w-2 h-2 rounded-full bg-blue-500 shrink-0" />
                                        )}
                                        <div className={!n.read ? "" : "pl-4"}>
                                            <p className="text-sm text-gray-700 leading-snug">{n.message}</p>
                                            <p className="text-xs text-gray-400 mt-0.5">
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
