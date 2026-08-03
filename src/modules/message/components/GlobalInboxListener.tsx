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
import { supabase } from "@/shared/lib/supabase/supabaseClient";
import { usePolling } from "@/shared/hooks/usePolling";
import { INBOX_ROOMS_POLL_MS } from "@/shared/lib/constants/polling";

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
    // Set by the subscribe effect below so the room re-check can be driven by
    // usePolling (which stops while the tab is hidden) instead of a bare interval.
    const syncRoomsRef = useRef<(() => void) | null>(null);

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
                    window.location.href = "/office/message/inbox";
                    notif.close();
                };
            }
            // Tell Sidebar to refresh its unread badge
            window.dispatchEvent(new CustomEvent("inbox:unread"));
        }

        // Mount fires this twice — once here, once from usePolling's immediate run —
        // so drop anything that overlaps a request already in flight.
        let syncing = false;

        async function syncRooms() {
            if (syncing) return;
            syncing = true;
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
            } catch { /* non-critical */ } finally { syncing = false; }
        }

        syncRoomsRef.current = () => void syncRooms();
        void syncRooms();

        return () => {
            syncRoomsRef.current = null;
            for (const ch of channels) void supabase.removeChannel(ch);
        };
    }, [currentUserId]);

    // Periodically pick up newly created DM rooms — but only while the tab is
    // visible. Already-subscribed rooms keep delivering over the broadcast
    // regardless, so a hidden tab loses nothing but the discovery of brand-new rooms,
    // which it picks up the moment it is looked at again.
    usePolling(() => syncRoomsRef.current?.(), INBOX_ROOMS_POLL_MS, !!currentUserId);

    return null;
}
