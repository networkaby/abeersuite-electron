"use client";

/**
 * TeamRoomPane — one staff chat room (a group or a one-to-one): its messages,
 * live delivery and the composer. Shared by the team Inbox (POS drawer) and
 * CRM → Messages, which lists staff chats beside customer ones.
 *
 * Live delivery is Supabase Broadcast on "room:<id>" (the sender broadcasts
 * the saved row); a slow poll is only the dropped-socket safety net. While a
 * room is open it is stamped as the active room so GlobalInboxListener does
 * not notify for it twice — see that file for the cross-tab mirror.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Send, MessageSquare, Loader2, Hash, AtSign, Bell, ChevronLeft } from "lucide-react";
import { extractApiError } from "@/shared/lib/api";
import { GatedLink } from "@/shared/components/GatedLink";
import { supabase } from "@/shared/lib/supabase/supabaseClient";
import { formatInboxTime } from "@/shared/lib/format/formatDate";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { INBOX_MESSAGES_POLL_MS } from "@/shared/lib/constants/polling";
import { writeCache } from "@/shared/lib/browser/pollCache";
import { initials } from "@/shared/lib/format/initials";
import { useValueChange } from "@/shared/hooks/useValueChange";

/** Cross-tab mirror of "which room is open" — see `GlobalInboxListener.tsx`'s reader. */
const ACTIVE_ROOM_KEY = "inbox-active-room:v1";
/** How often the mirror re-stamps while a room is open. */
const ACTIVE_ROOM_STAMP_MS = 60_000;

export type RoomType = "SYSTEM_INBOX" | "PERSONAL_INBOX" | "ORG_GROUP" | "DIRECT_MESSAGE";

/** A row of GET /api/inbox/rooms. */
export type Room = {
    id: string;
    key: string;
    type: RoomType;
    name: string;
    unreadCount: number;
    messageCount: number;
    latestMessage: {
        id: number;
        body: string;
        createdAt: string;
        senderUser: { name: string } | null;
    } | null;
};

type Message = {
    id: number;
    title: string | null;
    body: string;
    link: string | null;
    messageType: "SYSTEM" | "USER";
    createdAt: string;
    senderUser: { id: number; name: string; role: string } | null;
    pending?: boolean;
};

/** The other person's id in a DM room ("dm:<a>:<b>"). */
export function dmPartnerId(room: Pick<Room, "key">, me: number): number {
    const [, a, b] = room.key.split(":");
    const ai = parseInt(a, 10), bi = parseInt(b, 10);
    return me === ai ? bi : ai;
}

function playNotificationSound() {
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
    } catch { /* unsupported — silently skip */ }
}

function notify(msg: Message) {
    playNotificationSound();
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        const notif = new Notification(`${msg.senderUser?.name ?? "Someone"} — ServiceMgmt`, {
            body: msg.body.length > 100 ? msg.body.slice(0, 100) + "…" : msg.body,
            icon: "/favicon.ico",
            tag:  `msg-${msg.id}`,
        });
        notif.onclick = () => { window.focus(); notif.close(); };
    }
}

/** Returns true when this message should start a new visual group (new avatar + name row). */
function isNewGroup(messages: Message[], i: number): boolean {
    if (i === 0) return true;
    const prev = messages[i - 1];
    const curr = messages[i];
    if (prev.messageType !== curr.messageType) return true;
    if (prev.senderUser?.id !== curr.senderUser?.id) return true;
    // New group if gap > 5 min
    return new Date(curr.createdAt).getTime() - new Date(prev.createdAt).getTime() > 5 * 60_000;
}

export default function TeamRoomPane({
    room,
    title,
    currentUserId,
    currentUserName,
    onRead,
    onSent,
    onBack,
}: {
    room: Pick<Room, "id" | "type" | "name">;
    /** Header name — the colleague's name for a DM, the room name otherwise. */
    title: string;
    currentUserId?: number;
    currentUserName?: string;
    /** Opening a room marks it read server-side; the parent zeroes its badge. */
    onRead?: (roomId: string) => void;
    /** After the server saved this person's own message — a list can refresh its preview. */
    onSent?: () => void;
    /** Back button for mobile view */
    onBack?: () => void;
}) {
    const roomId = room.id;
    const [messages, setMessages] = useState<Message[]>([]);
    const [loadingMsgs, setLoadingMsgs] = useState(false);
    const [draft, setDraft] = useState("");
    const [sending, setSending] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const onReadRef = useRef(onRead);
    useLayoutEffect(() => { onReadRef.current = onRead; });

    // Another room: the old messages go and the spinner shows while rendering.
    if (useValueChange(roomId, null)) {
        setMessages([]);
        setLoadingMsgs(true);
    }
    useEffect(() => {
        let cancelled = false;
        axios.get<Message[]>(`/api/inbox/rooms/${roomId}/messages`)
            .then((res) => {
                if (cancelled) return;
                setMessages(res.data);
                onReadRef.current?.(roomId);
                // GET /messages marks the room read server-side — tell the Sidebar badge to drop
                window.dispatchEvent(new CustomEvent("inbox:read"));
            })
            .catch(() => { if (!cancelled) toast.error("Failed to load messages"); })
            .finally(() => { if (!cancelled) setLoadingMsgs(false); });
        return () => { cancelled = true; };
    }, [roomId]);

    // Tell GlobalInboxListener which room is open so it skips it (no double-notify).
    // The CustomEvent covers a listener in THIS tab; the localStorage mirror covers
    // a leader tab elsewhere. Re-stamped on a clock: a write-once claim can outlive
    // a crashed page and silence the room forever — the listener only trusts a
    // fresh stamp.
    useEffect(() => {
        const stamp = () => writeCache(ACTIVE_ROOM_KEY, { roomId }, new Date().toISOString());
        window.dispatchEvent(new CustomEvent("inbox:active-room", { detail: { roomId } }));
        stamp();
        const ticker = setInterval(stamp, ACTIVE_ROOM_STAMP_MS);
        return () => {
            clearInterval(ticker);
            window.dispatchEvent(new CustomEvent("inbox:active-room", { detail: { roomId: null } }));
            writeCache(ACTIVE_ROOM_KEY, { roomId: null }, new Date().toISOString());
        };
    }, [roomId]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    // ── Supabase Broadcast — real-time WebSocket delivery ────────────────────
    // Broadcast (pure pub/sub), NOT postgres_changes — avoids Prisma camelCase issues.
    const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

    useEffect(() => {
        const channel = supabase
            .channel(`room:${roomId}`)
            .on("broadcast", { event: "new_message" }, ({ payload }) => {
                const msg = payload as Message;
                setMessages((prev) => {
                    // Already confirmed — skip (own message was added directly after send)
                    if (prev.some((m) => !m.pending && m.id === msg.id)) return prev;
                    // Remove matching optimistic (same body + sender) — replaced by confirmed msg
                    const deduped = prev.filter(
                        (m) => !(m.pending && m.body === msg.body && m.senderUser?.id === msg.senderUser?.id),
                    );
                    if (msg.senderUser?.id !== currentUserId && msg.messageType === "USER") notify(msg);
                    return [...deduped, msg];
                });
            })
            .subscribe();
        channelRef.current = channel;
        return () => {
            void supabase.removeChannel(channel);
            channelRef.current = null;
        };
    }, [roomId, currentUserId]);

    // ── Fallback poll — only for a dropped socket ────────────────────────────
    useEffect(() => {
        const poll = async () => {
            // A tab nobody is looking at need not run the safety net at all.
            if (document.hidden) return;
            try {
                const res = await axios.get<Message[]>(`/api/inbox/rooms/${roomId}/messages`);
                const incoming = res.data;
                if (!incoming.length) return;
                const maxIncoming = Math.max(...incoming.map((m) => m.id));
                setMessages((prev) => {
                    const prevMaxId = Math.max(...prev.filter((m) => !m.pending).map((m) => m.id), 0);
                    if (maxIncoming <= prevMaxId) return prev; // nothing new — Broadcast already handled it
                    // Notify only if we actually missed something (prevMaxId > 0 avoids load-time noise)
                    if (prevMaxId > 0) {
                        for (const msg of incoming.filter((m) => m.id > prevMaxId)) {
                            if (msg.senderUser?.id !== currentUserId && msg.messageType === "USER") notify(msg);
                        }
                    }
                    const pendingNotYetConfirmed = prev.filter(
                        (p) => p.pending && !incoming.some((m) => m.body === p.body && m.senderUser?.id === p.senderUser?.id),
                    );
                    return [...incoming, ...pendingNotYetConfirmed];
                });
            } catch { /* silent */ }
        };
        const interval = setInterval(poll, INBOX_MESSAGES_POLL_MS);
        return () => clearInterval(interval);
    }, [roomId, currentUserId]);

    const sendMessage = async () => {
        const body = draft.trim();
        if (!body || sending) return;
        setSending(true);
        setDraft("");

        // Optimistic: add immediately with negative temp ID
        const tempId = -(Date.now());
        const optimistic: Message = {
            id: tempId, title: null, body, link: null, messageType: "USER",
            createdAt: new Date().toISOString(),
            senderUser: currentUserId ? { id: currentUserId, name: currentUserName ?? "You", role: "" } : null,
            pending: true,
        };
        setMessages((prev) => [...prev, optimistic]);

        try {
            const res = await axios.post<Message>(`/api/inbox/rooms/${roomId}/messages`, { body });
            const saved = res.data;
            setMessages((prev) => [...prev.filter((m) => m.id !== tempId), saved]);
            // Broadcast to all other subscribers in this room
            void channelRef.current?.send({ type: "broadcast", event: "new_message", payload: saved });
            onSent?.();
        } catch (error) {
            setMessages((prev) => prev.filter((m) => m.id !== tempId));
            setDraft(body);
            toast.error(extractApiError(error, "Failed to send message"));
        } finally {
            setSending(false);
        }
    };

    return (
        <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {/* Room header */}
            <div className="flex shrink-0 items-center gap-2 border-b border-border bg-card px-4 py-3 pt-[calc(0.5rem+env(safe-area-inset-top))] md:px-6 md:pt-3">
                {onBack && (
                    <button
                        type="button"
                        onClick={onBack}
                        className="mr-1 -ml-1 rounded-md p-1 hover:bg-muted md:hidden"
                        aria-label="Back to chat list"
                    >
                        <ChevronLeft className="size-5" />
                    </button>
                )}
                {room.type === "DIRECT_MESSAGE" ? (
                    <AtSign size={16} className="text-muted-foreground" />
                ) : room.type === "SYSTEM_INBOX" ? (
                    <Bell size={16} className="text-muted-foreground" />
                ) : (
                    <Hash size={16} className="text-muted-foreground" />
                )}
                <h2 className="text-sm font-bold">{title}</h2>
                <span className="ml-2 hidden text-xs capitalize text-muted-foreground sm:block">
                    {room.type === "DIRECT_MESSAGE" ? "staff · direct" : room.type === "ORG_GROUP" ? "staff group" : room.type.replace(/_/g, " ").toLowerCase()}
                </span>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-6 py-4">
                {loadingMsgs ? (
                    <div className="flex justify-center pt-16">
                        <Loader2 size={22} className="animate-spin text-muted-foreground" />
                    </div>
                ) : messages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center pt-16 text-muted-foreground">
                        <MessageSquare size={32} strokeWidth={1} className="mb-2 opacity-30" />
                        <p className="text-sm">No messages yet. Say hello!</p>
                    </div>
                ) : (
                    <div className="space-y-0.5">
                        {messages.map((message, i) => {
                            if (message.messageType === "SYSTEM") {
                                return (
                                    <div key={message.id} className="flex justify-center py-2">
                                        <div className="max-w-lg rounded-md border border-border bg-secondary/40 px-4 py-2 text-center">
                                            {message.title && <p className="text-xs font-semibold text-foreground">{message.title}</p>}
                                            <p className="whitespace-pre-wrap text-sm text-foreground">{message.body}</p>
                                            {message.link && (
                                                <GatedLink href={message.link} className="mt-1 inline-flex text-xs font-medium text-primary hover:underline">
                                                    Open →
                                                </GatedLink>
                                            )}
                                            <p className="mt-0.5 text-[10px] text-muted-foreground/60">{formatInboxTime(message.createdAt)}</p>
                                        </div>
                                    </div>
                                );
                            }

                            const isOwn = message.senderUser?.id === currentUserId;
                            const newGroup = isNewGroup(messages, i);
                            const senderName = message.senderUser?.name ?? "Unknown";
                            return (
                                <div
                                    key={message.id}
                                    className={[
                                        "group flex gap-3 rounded-md px-2 py-0.5 transition-colors",
                                        isOwn ? "bg-primary/5 hover:bg-primary/10" : "hover:bg-muted/40",
                                        newGroup ? "mt-3" : "",
                                        message.pending ? "opacity-60" : "",
                                    ].join(" ")}
                                >
                                    {/* Avatar column — always same width */}
                                    <div className="w-9 shrink-0 pt-0.5">
                                        {newGroup ? (
                                            <div className={[
                                                "flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold",
                                                isOwn ? "bg-primary/20 text-primary" : "bg-muted text-foreground",
                                            ].join(" ")}>
                                                {initials(senderName)}
                                            </div>
                                        ) : (
                                            <span className="hidden h-8 w-full items-center justify-end pr-1 text-[10px] text-muted-foreground/65 group-hover:flex">
                                                {formatInboxTime(message.createdAt)}
                                            </span>
                                        )}
                                    </div>

                                    <div className="min-w-0 flex-1">
                                        {newGroup && (
                                            <div className="mb-0.5 flex items-baseline gap-2">
                                                <span className={`text-sm font-bold ${isOwn ? "text-primary" : "text-foreground"}`}>
                                                    {isOwn ? (currentUserName ?? "You") : senderName}
                                                </span>
                                                <span className="text-[10px] text-muted-foreground/60">{formatInboxTime(message.createdAt)}</span>
                                                {message.pending && <span className="text-[10px] italic text-muted-foreground/65">sending…</span>}
                                            </div>
                                        )}
                                        {message.title && <p className="mb-0.5 text-xs font-semibold text-foreground">{message.title}</p>}
                                        <p className="wrap-break-word whitespace-pre-wrap text-sm leading-relaxed text-foreground">{message.body}</p>
                                        {message.link && (
                                            <GatedLink href={message.link} className="mt-0.5 inline-flex text-xs text-primary hover:underline">
                                                Open →
                                            </GatedLink>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            {/* Composer */}
            <div className="shrink-0 border-t border-border bg-card px-4 py-3 pb-[max(0.6rem,env(safe-area-inset-bottom))] md:px-6 md:py-3">
                {room.type === "SYSTEM_INBOX" ? (
                    <p className="py-1 text-sm italic text-muted-foreground">System inbox is read-only.</p>
                ) : (
                    <div className="flex items-end gap-2 rounded-md border border-border bg-background px-3 py-2 focus-within:ring-2 focus-within:ring-ring">
                        <Textarea
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendMessage(); } }}
                            rows={1}
                            placeholder={`Message ${room.type === "DIRECT_MESSAGE" ? `@ ${title}` : `# ${title}`}`}
                            className="max-h-40 min-h-0 flex-1 resize-none border-0 bg-transparent px-0 py-0 text-sm shadow-none placeholder:text-muted-foreground/65 focus-visible:ring-0"
                            style={{ overflowY: "auto" }}
                            onInput={(e) => {
                                const el = e.currentTarget;
                                el.style.height = "auto";
                                el.style.height = `${el.scrollHeight}px`;
                            }}
                        />
                        <Button
                            type="button"
                            size="icon-sm"
                            onClick={() => void sendMessage()}
                            disabled={sending || !draft.trim()}
                            className="shrink-0 disabled:opacity-30"
                            title="Send (Enter)"
                        >
                            <Send size={14} />
                        </Button>
                    </div>
                )}
                <p className="mt-1 px-1 text-[10px] text-muted-foreground/65">Enter to send · Shift+Enter for new line</p>
            </div>
        </section>
    );
}
