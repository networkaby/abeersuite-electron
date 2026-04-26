"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import axios from "axios";
import { toast } from "sonner";
import Link from "next/link";
import { Send, Users2, Monitor, User, MessageSquare, Loader2, Hash, AtSign, Bell } from "lucide-react";
import { supabase } from "@/lib/supabase-client";

// ── Types ──────────────────────────────────────────────────────────────────────

type RoomType = "SYSTEM_INBOX" | "PERSONAL_INBOX" | "ROLE_GROUP" | "ORG_GROUP" | "DIRECT_MESSAGE";

type Room = {
    id: string;
    key: string;
    type: RoomType;
    name: string;
    roleId: string | null;
    unreadCount: number;
    messageCount: number;
    latestMessage: {
        id: number;
        body: string;
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

type TeamUser = {
    id: number;
    name: string;
    role: string;
    userRole: { label: string; color: string };
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatTime(dateStr: string): string {
    // Supabase Realtime may omit the 'Z' suffix — normalise to UTC
    const utc  = dateStr && !dateStr.endsWith("Z") && !dateStr.includes("+") ? dateStr + "Z" : dateStr;
    const date = new Date(utc);
    const now  = new Date();
    if (date.toDateString() === now.toDateString()) {
        return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
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

function initials(name: string) {
    return name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
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

/** Derive a display name for a DM room from the room key + current user id. */
function dmPartnerName(room: Room, currentUserId: number, teamUsers: TeamUser[]): string {
    const parts = room.key.split(":");
    const a = parseInt(parts[1], 10);
    const b = parseInt(parts[2], 10);
    const partnerId = currentUserId === a ? b : a;
    return teamUsers.find((u) => u.id === partnerId)?.name ?? room.name;
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function InboxModule({
    currentUserId,
    currentUserName,
}: {
    currentUserId?: number;
    currentUserName?: string;
}) {
    const searchParams  = useSearchParams();
    const initialSection = searchParams.get("section") ?? "groups";

    const [rooms, setRooms]               = useState<Room[]>([]);
    const [teamUsers, setTeamUsers]       = useState<TeamUser[]>([]);
    const [activeRoomId, setActiveRoomId] = useState<string>("");
    const [messages, setMessages]         = useState<Message[]>([]);
    const [loadingRooms, setLoadingRooms] = useState(true);
    const [loadingMsgs, setLoadingMsgs]   = useState(false);
    const [openingDm, setOpeningDm]       = useState<number | null>(null);
    const [draft, setDraft]               = useState("");
    const [sending, setSending]           = useState(false);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const activeRoom     = rooms.find((r) => r.id === activeRoomId) ?? null;

    // ── Loaders ─────────────────────────────────────────────────────────────────

    const loadRooms = useCallback(async () => {
        try {
            const res = await axios.get<Room[]>("/api/inbox/rooms");
            setRooms(res.data);
        } catch {
            toast.error("Failed to load inbox");
        } finally {
            setLoadingRooms(false);
        }
    }, []);

    const loadTeamUsers = useCallback(async () => {
        try {
            const res = await axios.get<TeamUser[]>("/api/users");
            setTeamUsers(res.data.filter((u) => u.id !== currentUserId));
        } catch { /* non-critical */ }
    }, [currentUserId]);

    const loadMessages = useCallback(async (roomId: string) => {
        setMessages([]);
        setLoadingMsgs(true);
        try {
            const res = await axios.get<Message[]>(`/api/inbox/rooms/${roomId}/messages`);
            setMessages(res.data);
            setRooms((prev) => prev.map((r) => r.id === roomId ? { ...r, unreadCount: 0 } : r));
        } catch {
            toast.error("Failed to load messages");
        } finally {
            setLoadingMsgs(false);
        }
    }, []);

    // ── Bootstrap ────────────────────────────────────────────────────────────────

    // Request browser notification permission once on mount
    useEffect(() => {
        if (typeof Notification !== "undefined" && Notification.permission === "default") {
            Notification.requestPermission();
        }
    }, []);

    useEffect(() => { loadRooms(); loadTeamUsers(); }, [loadRooms, loadTeamUsers]);

    useEffect(() => {
        if (rooms.length === 0 || activeRoomId) return;
        const sectionTypes: Record<string, RoomType[]> = {
            groups: ["ROLE_GROUP", "ORG_GROUP"],
            users:  ["DIRECT_MESSAGE"],
            system: ["SYSTEM_INBOX"],
        };
        const types = sectionTypes[initialSection] ?? sectionTypes.groups;
        const first = rooms.find((r) => types.includes(r.type)) ?? rooms[0];
        if (first) setActiveRoomId(first.id);
    }, [rooms, activeRoomId, initialSection]);

    useEffect(() => {
        if (!activeRoomId) return;
        loadMessages(activeRoomId);
    }, [activeRoomId, loadMessages]);

    // Tell GlobalInboxListener which room we have open so it skips it (no double-notify)
    useEffect(() => {
        window.dispatchEvent(
            new CustomEvent("inbox:active-room", { detail: { roomId: activeRoomId || null } })
        );
        return () => {
            // On unmount (user left /inbox), clear the active room
            window.dispatchEvent(
                new CustomEvent("inbox:active-room", { detail: { roomId: null } })
            );
        };
    }, [activeRoomId]);

    // When GlobalInboxListener signals a new message on a background room, refresh
    // the rooms list so the left-panel unread badges stay accurate
    useEffect(() => {
        const handler = () => { void loadRooms(); };
        window.addEventListener("inbox:unread", handler);
        return () => window.removeEventListener("inbox:unread", handler);
    }, [loadRooms]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    // ── Supabase Broadcast — real-time WebSocket delivery ────────────────────────
    // Uses Broadcast (pure pub/sub), NOT postgres_changes — avoids Prisma camelCase issues.
    // Flow: sender POSTs → gets full message back → broadcasts on channel "room:<id>"
    //       → all subscribers receive it instantly via WebSocket.

    const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

    useEffect(() => {
        if (!activeRoomId) return;

        const channel = supabase
            .channel(`room:${activeRoomId}`)
            .on("broadcast", { event: "new_message" }, ({ payload }) => {
                const msg = payload as Message;
                setMessages((prev) => {
                    // Already confirmed — skip (own message was added directly after send)
                    if (prev.some((m) => !m.pending && m.id === msg.id)) return prev;
                    // Remove matching optimistic (same body + sender) — replaced by confirmed msg
                    const deduped = prev.filter(
                        (m) => !(m.pending && m.body === msg.body && m.senderUser?.id === msg.senderUser?.id)
                    );
                    // Notification for messages from others
                    if (msg.senderUser?.id !== currentUserId && msg.messageType === "USER") {
                        playNotificationSound();
                        if (typeof Notification !== "undefined" && Notification.permission === "granted") {
                            const notif = new Notification(
                                `${msg.senderUser?.name ?? "Someone"} — ServiceMgmt`,
                                {
                                    body: msg.body.length > 100 ? msg.body.slice(0, 100) + "…" : msg.body,
                                    icon: "/favicon.ico",
                                    tag:  `msg-${msg.id}`,
                                }
                            );
                            notif.onclick = () => { window.focus(); notif.close(); };
                        }
                    }
                    return [...deduped, msg];
                });
            })
            .subscribe();

        channelRef.current = channel;

        return () => {
            void supabase.removeChannel(channel);
            channelRef.current = null;
        };
    }, [activeRoomId, currentUserId]);

    // ── 30-second fallback poll ───────────────────────────────────────────────────
    // Safety net: catches messages if the WebSocket was briefly disconnected.
    // Uses lastKnownIdRef so it never fires duplicate sound/notifications.

    const lastKnownIdRef = useRef<number>(0);

    useEffect(() => {
        const confirmed = messages.filter((m) => !m.pending);
        if (confirmed.length > 0) {
            lastKnownIdRef.current = Math.max(...confirmed.map((m) => m.id));
        }
    }, [messages]);

    useEffect(() => { lastKnownIdRef.current = 0; }, [activeRoomId]);

    useEffect(() => {
        if (!activeRoomId) return;

        const poll = async () => {
            try {
                const res = await axios.get<Message[]>(`/api/inbox/rooms/${activeRoomId}/messages`);
                const incoming = res.data;
                if (!incoming.length) return;

                const maxIncoming = Math.max(...incoming.map((m) => m.id));

                setMessages((prev) => {
                    const prevMaxId = Math.max(...prev.filter((m) => !m.pending).map((m) => m.id), 0);
                    if (maxIncoming <= prevMaxId) return prev; // nothing new — Broadcast already handled it

                    const newMsgs = incoming.filter((m) => m.id > prevMaxId);

                    // Notify only if we actually missed something (prevMaxId > 0 guard avoids load-time noise)
                    if (prevMaxId > 0) {
                        for (const msg of newMsgs) {
                            if (msg.senderUser?.id !== currentUserId && msg.messageType === "USER") {
                                playNotificationSound();
                                if (typeof Notification !== "undefined" && Notification.permission === "granted") {
                                    const notif = new Notification(
                                        `${msg.senderUser?.name ?? "Someone"} — ServiceMgmt`,
                                        {
                                            body: msg.body.length > 100 ? msg.body.slice(0, 100) + "…" : msg.body,
                                            icon: "/favicon.ico",
                                            tag:  `msg-${msg.id}`,
                                        }
                                    );
                                    notif.onclick = () => { window.focus(); notif.close(); };
                                }
                            }
                        }
                    }

                    const pendingNotYetConfirmed = prev.filter(
                        (p) => p.pending && !incoming.some((m) => m.body === p.body && m.senderUser?.id === p.senderUser?.id)
                    );
                    return [...incoming, ...pendingNotYetConfirmed];
                });
            } catch { /* silent */ }
        };

        const interval = setInterval(poll, 30_000); // 30s — fallback only
        return () => clearInterval(interval);
    }, [activeRoomId, currentUserId]);

    // ── Actions ─────────────────────────────────────────────────────────────────

    const sendMessage = async () => {
        const body = draft.trim();
        if (!body || !activeRoom || sending) return;
        setSending(true);
        setDraft("");

        // Optimistic: add immediately with negative temp ID
        const tempId = -(Date.now());
        const optimistic: Message = {
            id:          tempId,
            title:       null,
            body,
            link:        null,
            messageType: "USER",
            createdAt:   new Date().toISOString(),
            senderUser:  currentUserId
                ? { id: currentUserId, name: currentUserName ?? "You", role: "" }
                : null,
            pending: true,
        };
        setMessages((prev) => [...prev, optimistic]);

        try {
            const res = await axios.post<Message>(`/api/inbox/rooms/${activeRoom.id}/messages`, { body });
            const saved = res.data;

            // Replace the optimistic message with the confirmed one
            setMessages((prev) => [...prev.filter((m) => m.id !== tempId), saved]);

            // Broadcast to all other subscribers in this room — they receive it via WebSocket
            void channelRef.current?.send({
                type: "broadcast",
                event: "new_message",
                payload: saved,
            });
        } catch (error) {
            // Rollback optimistic
            setMessages((prev) => prev.filter((m) => m.id !== tempId));
            setDraft(body);
            const msg = axios.isAxiosError(error) ? error.response?.data?.error : null;
            toast.error(msg ?? "Failed to send message");
        } finally {
            setSending(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    };

    const openDm = async (targetUserId: number) => {
        setOpeningDm(targetUserId);
        try {
            const res = await axios.post<{ id: string }>(`/api/inbox/direct/${targetUserId}`);
            await loadRooms();
            setActiveRoomId(res.data.id);
        } catch {
            toast.error("Failed to open direct message");
        } finally {
            setOpeningDm(null);
        }
    };

    // ── Derived ──────────────────────────────────────────────────────────────────

    const groupRooms  = rooms.filter((r) => r.type === "ROLE_GROUP" || r.type === "ORG_GROUP");
    const dmRooms     = rooms.filter((r) => r.type === "DIRECT_MESSAGE");
    const systemRooms = rooms.filter((r) => r.type === "SYSTEM_INBOX");

    const dmOpenIds = new Set(
        dmRooms.map((r) => {
            if (!currentUserId) return -1;
            const [, a, b] = r.key.split(":");
            const ai = parseInt(a, 10), bi = parseInt(b, 10);
            return currentUserId === ai ? bi : ai;
        })
    );

    const totalUnread = (list: Room[]) => list.reduce((s, r) => s + r.unreadCount, 0);

    // ── Sub-components ───────────────────────────────────────────────────────────

    const SectionLabel = ({
        icon: Icon,
        label,
        unread,
    }: { icon: React.ElementType; label: string; unread: number }) => (
        <div className="flex items-center gap-2 px-3 pt-4 pb-1">
            <Icon size={11} className="text-muted-foreground/60" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">
                {label}
            </span>
            {unread > 0 && (
                <span className="ml-auto rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground leading-none">
                    {unread}
                </span>
            )}
        </div>
    );

    const RoomRow = ({ room, displayName }: { room: Room; displayName: string }) => {
        const isActive = activeRoomId === room.id;
        const prefix =
            room.type === "DIRECT_MESSAGE" ? "@" :
            room.type === "SYSTEM_INBOX"   ? "" : "#";
        return (
            <button
                type="button"
                onClick={() => setActiveRoomId(room.id)}
                className={[
                    "flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors",
                    isActive
                        ? "bg-primary/15 text-foreground font-semibold"
                        : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                ].join(" ")}
            >
                <span className="truncate">
                    {prefix}{displayName}
                </span>
                {room.unreadCount > 0 && (
                    <span className="ml-auto shrink-0 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground leading-none">
                        {room.unreadCount}
                    </span>
                )}
            </button>
        );
    };

    // ── Render ───────────────────────────────────────────────────────────────────

    return (
        <div className="-m-8 flex h-screen bg-background">

            {/* ══ Left sidebar ═══════════════════════════════════════════════════ */}
            <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-sidebar overflow-hidden">

                {/* Header */}
                <div className="flex items-center justify-between border-b border-border px-4 py-3 shrink-0">
                    <div className="flex items-center gap-2">
                        <MessageSquare size={15} className="text-primary" />
                        <span className="text-sm font-bold">Inbox</span>
                    </div>
                    {totalUnread([...groupRooms, ...dmRooms, ...systemRooms]) > 0 && (
                        <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-primary-foreground leading-none">
                            {totalUnread([...groupRooms, ...dmRooms, ...systemRooms])}
                        </span>
                    )}
                </div>

                {loadingRooms ? (
                    <div className="flex flex-1 items-center justify-center">
                        <Loader2 size={18} className="animate-spin text-muted-foreground" />
                    </div>
                ) : (
                    <nav className="flex-1 overflow-y-auto px-2 pb-4">

                        {/* Groups */}
                        <SectionLabel icon={Users2} label="Groups" unread={totalUnread(groupRooms)} />
                        {groupRooms.length === 0
                            ? <p className="px-3 py-1 text-xs text-muted-foreground/50 italic">No groups</p>
                            : groupRooms.map((r) => (
                                <RoomRow key={r.id} room={r} displayName={r.name} />
                            ))
                        }

                        {/* Users */}
                        <SectionLabel icon={User} label="Users" unread={totalUnread(dmRooms)} />
                        {dmRooms.map((r) => (
                            <RoomRow
                                key={r.id}
                                room={r}
                                displayName={currentUserId ? dmPartnerName(r, currentUserId, teamUsers) : r.name}
                            />
                        ))}
                        {teamUsers
                            .filter((u) => !dmOpenIds.has(u.id))
                            .map((u) => (
                                <button
                                    key={u.id}
                                    type="button"
                                    onClick={() => openDm(u.id)}
                                    disabled={openingDm === u.id}
                                    className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-sm text-muted-foreground/60 hover:bg-muted/60 hover:text-muted-foreground transition-colors disabled:opacity-40"
                                >
                                    <span className="truncate">@ {u.name}</span>
                                    {openingDm === u.id && (
                                        <Loader2 size={11} className="ml-auto animate-spin" />
                                    )}
                                </button>
                            ))
                        }

                        {/* System */}
                        <SectionLabel icon={Monitor} label="System" unread={totalUnread(systemRooms)} />
                        {systemRooms.map((r) => (
                            <RoomRow key={r.id} room={r} displayName={r.name} />
                        ))}

                    </nav>
                )}
            </aside>

            {/* ══ Chat area ══════════════════════════════════════════════════════ */}
            <section className="flex flex-1 flex-col overflow-hidden">

                {!activeRoom ? (
                    <div className="flex flex-1 items-center justify-center text-muted-foreground">
                        <div className="text-center">
                            <MessageSquare size={40} strokeWidth={1} className="mx-auto mb-3 opacity-30" />
                            <p className="text-sm">Select a conversation to start chatting.</p>
                        </div>
                    </div>
                ) : (
                    <>
                        {/* Room header */}
                        <div className="flex items-center gap-2 border-b border-border bg-card px-6 py-3 shrink-0 shadow-sm">
                            {activeRoom.type === "DIRECT_MESSAGE" ? (
                                <AtSign size={16} className="text-muted-foreground" />
                            ) : activeRoom.type === "SYSTEM_INBOX" ? (
                                <Bell size={16} className="text-muted-foreground" />
                            ) : (
                                <Hash size={16} className="text-muted-foreground" />
                            )}
                            <h2 className="text-sm font-bold">
                                {activeRoom.type === "DIRECT_MESSAGE" && currentUserId
                                    ? dmPartnerName(activeRoom, currentUserId, teamUsers)
                                    : activeRoom.name}
                            </h2>
                            <span className="ml-2 text-xs text-muted-foreground capitalize hidden sm:block">
                                {activeRoom.type.replace(/_/g, " ").toLowerCase()}
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

                                        // ── System message ───────────────────
                                        if (message.messageType === "SYSTEM") {
                                            return (
                                                <div key={message.id} className="flex justify-center py-2">
                                                    <div className="max-w-lg rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 px-4 py-2 text-center">
                                                        {message.title && (
                                                            <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">
                                                                {message.title}
                                                            </p>
                                                        )}
                                                        <p className="text-sm text-amber-900 dark:text-amber-200 whitespace-pre-wrap">
                                                            {message.body}
                                                        </p>
                                                        {message.link && (
                                                            <Link href={message.link} className="mt-1 inline-flex text-xs font-medium text-primary hover:underline">
                                                                Open →
                                                            </Link>
                                                        )}
                                                        <p className="mt-0.5 text-[10px] text-amber-600/60">
                                                            {formatTime(message.createdAt)}
                                                        </p>
                                                    </div>
                                                </div>
                                            );
                                        }

                                        // ── User message ─────────────────────
                                        const isOwn    = message.senderUser?.id === currentUserId;
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
                                                            isOwn
                                                                ? "bg-primary/20 text-primary"
                                                                : "bg-muted text-foreground",
                                                        ].join(" ")}>
                                                            {initials(senderName)}
                                                        </div>
                                                    ) : (
                                                        /* Timestamp on hover for grouped messages */
                                                        <span className="hidden group-hover:flex h-8 items-center justify-end text-[10px] text-muted-foreground/50 w-full pr-1">
                                                            {formatTime(message.createdAt)}
                                                        </span>
                                                    )}
                                                </div>

                                                {/* Body column */}
                                                <div className="flex-1 min-w-0">
                                                    {newGroup && (
                                                        <div className="flex items-baseline gap-2 mb-0.5">
                                                            <span className={`text-sm font-bold ${isOwn ? "text-primary" : "text-foreground"}`}>
                                                                {isOwn ? (currentUserName ?? "You") : senderName}
                                                            </span>
                                                            <span className="text-[10px] text-muted-foreground/60">
                                                                {formatTime(message.createdAt)}
                                                            </span>
                                                            {message.pending && (
                                                                <span className="text-[10px] text-muted-foreground/50 italic">sending…</span>
                                                            )}
                                                        </div>
                                                    )}
                                                    {message.title && (
                                                        <p className="text-xs font-semibold text-foreground mb-0.5">{message.title}</p>
                                                    )}
                                                    <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed break-words">
                                                        {message.body}
                                                    </p>
                                                    {message.link && (
                                                        <Link href={message.link} className="mt-0.5 inline-flex text-xs text-primary hover:underline">
                                                            Open →
                                                        </Link>
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
                        <div className="border-t border-border bg-card px-6 py-3 shrink-0">
                            {activeRoom.type === "SYSTEM_INBOX" ? (
                                <p className="text-sm text-muted-foreground italic py-1">
                                    System inbox is read-only.
                                </p>
                            ) : (
                                <div className="flex items-end gap-2 rounded-xl border border-border bg-background px-3 py-2 focus-within:ring-2 focus-within:ring-ring">
                                    <textarea
                                        value={draft}
                                        onChange={(e) => setDraft(e.target.value)}
                                        onKeyDown={handleKeyDown}
                                        rows={1}
                                        placeholder={`Message ${
                                            activeRoom.type === "DIRECT_MESSAGE" && currentUserId
                                                ? `@ ${dmPartnerName(activeRoom, currentUserId, teamUsers)}`
                                                : `# ${activeRoom.name}`
                                        }`}
                                        className="flex-1 resize-none bg-transparent text-sm focus:outline-none placeholder:text-muted-foreground/50 max-h-40"
                                        style={{ overflowY: "auto" }}
                                        onInput={(e) => {
                                            const el = e.currentTarget;
                                            el.style.height = "auto";
                                            el.style.height = `${el.scrollHeight}px`;
                                        }}
                                    />
                                    <button
                                        type="button"
                                        onClick={sendMessage}
                                        disabled={sending || !draft.trim()}
                                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-30 transition-colors"
                                        title="Send (Enter)"
                                    >
                                        <Send size={14} />
                                    </button>
                                </div>
                            )}
                            <p className="mt-1 px-1 text-[10px] text-muted-foreground/40">
                                Enter to send · Shift+Enter for new line
                            </p>
                        </div>
                    </>
                )}
            </section>
        </div>
    );
}
