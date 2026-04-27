"use client";

/**
 * GlobalInboxListener — always mounted in the protected layout.
 *
 * Subscribes to every accessible chat room via Supabase Broadcast so the user
 * gets sound + browser notification even when they are on a completely different
 * page (tickets, customers, etc.).
 *
 * Coordination events (window CustomEvents):
 *  - "inbox:active-room"  { detail: { roomId: string|null } }
 *      InboxModule fires this so we can skip the room it is already displaying
 *      (InboxModule handles that room itself — no double-notification).
 *  - "inbox:unread"
 *      We fire this so Sidebar re-fetches and updates its unread badge.
 */

import { useEffect, useRef } from "react";
import axios from "axios";
import { supabase } from "@/lib/supabase-client";

type Room = { id: string };

type IncomingMessage = {
    id: number;
    body: string;
    messageType: "SYSTEM" | "USER";
    senderUser: { id: number; name: string } | null;
};

function playSound() {
    try {
        const ctx  = new AudioContext();
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = "sine";
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.12);
        gain.gain.setValueAtTime(0.12, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.45);
    } catch { /* unsupported */ }
}

export default function GlobalInboxListener({ currentUserId }: { currentUserId?: number }) {
    // Tracks which room InboxModule currently has open (updated via "inbox:active-room" event)
    const activeInboxRoomRef = useRef<string | null>(null);

    // Ask for browser notification permission once
    useEffect(() => {
        if (typeof Notification !== "undefined" && Notification.permission === "default") {
            void Notification.requestPermission();
        }
    }, []);

    // Listen for InboxModule telling us which room it has open
    useEffect(() => {
        const handler = (e: Event) => {
            activeInboxRoomRef.current =
                (e as CustomEvent<{ roomId: string | null }>).detail.roomId;
        };
        window.addEventListener("inbox:active-room", handler);
        return () => window.removeEventListener("inbox:active-room", handler);
    }, []);

    // Subscribe to every accessible room
    useEffect(() => {
        if (!currentUserId) return;

        const subscribedIds = new Set<string>();
        const channels: ReturnType<typeof supabase.channel>[] = [];

        function notify(msg: IncomingMessage) {
            playSound();
            if (typeof Notification !== "undefined" && Notification.permission === "granted") {
                const notif = new Notification(
                    `${msg.senderUser?.name ?? "Someone"} — ServiceMgmt`,
                    {
                        body: msg.body.length > 100 ? msg.body.slice(0, 100) + "…" : msg.body,
                        icon: "/favicon.ico",
                        tag:  `msg-${msg.id}`,
                    }
                );
                notif.onclick = () => {
                    window.focus();
                    window.location.href = "/inbox";
                    notif.close();
                };
            }
            // Tell Sidebar to refresh its unread badge
            window.dispatchEvent(new CustomEvent("inbox:unread"));
        }

        async function syncRooms() {
            try {
                const res = await axios.get<Room[]>("/api/inbox/rooms");
                for (const room of res.data) {
                    if (subscribedIds.has(room.id)) continue; // already subscribed

                    subscribedIds.add(room.id);

                    const ch = supabase
                        .channel(`room:${room.id}`)
                        .on("broadcast", { event: "new_message" }, ({ payload }) => {
                            const msg = payload as IncomingMessage;
                            if (msg.senderUser?.id === currentUserId) return; // own message
                            if (msg.messageType !== "USER") return;            // system message
                            // Skip if InboxModule is actively showing this room
                            if (activeInboxRoomRef.current === room.id) return;
                            notify(msg);
                        })
                        .subscribe();

                    channels.push(ch);
                }
            } catch { /* non-critical */ }
        }

        void syncRooms();

        // Re-check every 60 s to pick up newly created DM rooms
        const interval = setInterval(() => void syncRooms(), 60_000);

        return () => {
            clearInterval(interval);
            for (const ch of channels) void supabase.removeChannel(ch);
        };
    }, [currentUserId]);

    return null;
}
