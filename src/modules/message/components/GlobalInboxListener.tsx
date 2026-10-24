"use client";

/**
 * GlobalInboxListener — always mounted in the protected layout.
 *
 * Subscribes to every accessible chat room via Supabase Broadcast so the user
 * gets sound + browser notification even when they are on a completely different
 * page (tickets, customers, etc.) — or a completely different TAB.
 *
 * LEADER-GATED. This component is mounted in every tab, so subscribing
 * unconditionally meant three open tabs held three separate live sockets all
 * day, whether or not any of them were being looked at — the actual source of
 * the app's background Realtime cost (see `appChannel.ts`'s module doc). Only
 * the tab that wins leadership (`tabLeader.ts`) subscribes to rooms at all; a
 * follower tab does nothing here. Nothing the USER sees changes — a browser
 * Notification shown by the leader is visible regardless of which tab is
 * focused, and the sidebar unread badge already cross-tab-syncs on its own
 * (`useNavCounts`'s localStorage mirror) — only which tab is paying for the
 * socket does.
 *
 * Coordination:
 *  - "inbox:active-room" (window CustomEvent) + a localStorage mirror
 *      InboxModule fires the event AND writes the mirror so we can skip the
 *      room it is already displaying (InboxModule handles that room itself —
 *      no double-notification) — the mirror is what lets the LEADER tab know
 *      this even when InboxModule is open in a DIFFERENT, follower tab.
 *  - "inbox:unread"
 *      We fire this so Sidebar re-fetches and updates its unread badge.
 *
 * TRUST THE MIRROR ONLY WHILE IT IS FRESH. `InboxModule` re-stamps its claim
 * every `ACTIVE_ROOM_STAMP_MS`, and we only honor a claim younger than
 * `ACTIVE_ROOM_TTL_MS`. A write-once "I'm viewing this room" is a permanent
 * trap the moment the page that wrote it dies without its unmount running (a
 * crashed tab, a force-closed browser) — nothing else was ever going to clear
 * it, so that room's notifications would be suppressed forever, in every tab,
 * from then on. That is exactly what happened once already: a stale mirror
 * from an earlier session pointed at the org group and silently ate every
 * group notification while direct messages, never stuck, kept working — the
 * asymmetry that made it look room-type-specific when it was really just
 * "one room's claim happened to be the one left dangling."
 */

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { supabase } from "@/shared/lib/supabase/supabaseClient";
import { usePolling } from "@/shared/hooks/usePolling";
import { useRealtimeTopics } from "@/shared/hooks/useRealtimeTopics";
import { INBOX_ROOMS_POLL_MS } from "@/shared/lib/constants/polling";
import { onBecomeLeader } from "@/shared/lib/realtime/tabLeader";
import { readCache, subscribeToCache } from "@/shared/lib/browser/pollCache";

type Room = { id: string };

type IncomingMessage = {
    id: number;
    body: string;
    messageType: "SYSTEM" | "USER";
    senderUser: { id: number; name: string } | null;
};

/** Cross-tab mirror of `"inbox:active-room"` — see `InboxModule.tsx`'s writer. */
const ACTIVE_ROOM_KEY = "inbox-active-room:v1";
/** Wider than `InboxModule`'s own re-stamp interval (60s) so one missed tick —
 *  a slow tab, a moment of throttling — doesn't false-positive a still-open
 *  room as abandoned. */
const ACTIVE_ROOM_TTL_MS = 150_000;

type ActiveRoomClaim = { roomId: string | null; at: number };

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
    const router = useRouter();
    // A click on the desktop notification opens the Inbox in-app (no full reload).
    const openInbox = useEffectEvent(() => router.push("/office/message/inbox"));
    // True once THIS tab has won leadership — the gate for everything below.
    const [isLeader, setIsLeader] = useState(false);
    // Tracks which room InboxModule currently has open — same-tab via the
    // CustomEvent, any-tab via the localStorage mirror (initial value read
    // synchronously so a leader that wins AFTER InboxModule already opened a
    // room, e.g. on a fresh leader handoff, still starts correctly informed).
    // `at` is what makes the claim expire — see the module doc.
    const initialMirror = readCache<{ roomId: string | null }>(ACTIVE_ROOM_KEY);
    const activeInboxRoomRef = useRef<ActiveRoomClaim>({
        roomId: initialMirror?.data.roomId ?? null,
        at: initialMirror ? new Date(initialMirror.computedAt).getTime() : 0,
    });

    /** The active room to actually honor right now — null once the claim has aged out. */
    function currentActiveRoom(): string | null {
        const claim = activeInboxRoomRef.current;
        if (!claim.roomId) return null;
        return Date.now() - claim.at > ACTIVE_ROOM_TTL_MS ? null : claim.roomId;
    }
    // Set by the subscribe effect below so the room re-check can be driven by
    // usePolling (which stops while the tab is hidden) instead of a bare interval.
    const syncRoomsRef = useRef<(() => void) | null>(null);

    useEffect(() => {
        onBecomeLeader(() => setIsLeader(true));
    }, []);

    // Ask for browser notification permission once
    useEffect(() => {
        if (typeof Notification !== "undefined" && Notification.permission === "default") {
            void Notification.requestPermission();
        }
    }, []);

    // Listen for InboxModule telling us which room it has open — same-tab fast
    // path (event) plus the cross-tab mirror, so a room open in a FOLLOWER tab
    // still suppresses the LEADER tab's notification for it.
    useEffect(() => {
        const handler = (e: Event) => {
            const roomId = (e as CustomEvent<{ roomId: string | null }>).detail.roomId;
            // Same-tick, same-tab — inherently fresh, no borrowed timestamp needed.
            activeInboxRoomRef.current = { roomId, at: Date.now() };
        };
        window.addEventListener("inbox:active-room", handler);
        const unsub = subscribeToCache<{ roomId: string | null }>(
            ACTIVE_ROOM_KEY,
            (entry) => {
                activeInboxRoomRef.current = { roomId: entry.data.roomId, at: new Date(entry.computedAt).getTime() };
            },
        );
        return () => { window.removeEventListener("inbox:active-room", handler); unsub(); };
    }, []);

    // Subscribe to every accessible room — leader tab only.
    useEffect(() => {
        if (!currentUserId || !isLeader) return;

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
                    openInbox();
                    notif.close();
                };
            }
            // Tell Sidebar to refresh its unread badge — every tab picks this up
            // via useNavCounts's own cross-tab cache, not just this one.
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
                            // Skip if InboxModule is actively showing this room —
                            // in this tab, or in any other — and that claim hasn't
                            // gone stale.
                            if (currentActiveRoom() === room.id) return;
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
    }, [currentUserId, isLeader]);

    // A brand new DM room mints itself over POST /api/inbox/direct, which
    // announces the "chat" topic — the leader picks it up and subscribes
    // instantly instead of waiting for the next poll.
    useRealtimeTopics(["chat"], () => syncRoomsRef.current?.(), isLeader);

    // The poll is now a DISTANT fallback, not the mechanism — realtime covers
    // both new messages (per-room broadcast) and new rooms (above). It still
    // runs, slowly, only while visible AND leader, purely in case a signal
    // was somehow missed; see INBOX_ROOMS_POLL_MS.
    usePolling(() => syncRoomsRef.current?.(), INBOX_ROOMS_POLL_MS, !!currentUserId && isLeader);

    return null;
}
