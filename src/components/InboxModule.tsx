"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import Link from "next/link";

type Room = {
    id: string;
    key: string;
    type: "SYSTEM_INBOX" | "PERSONAL_INBOX" | "ROLE_GROUP" | "ORG_GROUP";
    name: string;
    roleId: string | null;
    unreadCount: number;
    messageCount: number;
    latestMessage: {
        id: number;
        title: string | null;
        body: string;
        link: string | null;
        messageType: "SYSTEM" | "USER";
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
};

const TYPE_LABELS: Record<Room["type"], string> = {
    SYSTEM_INBOX: "System",
    PERSONAL_INBOX: "Personal",
    ROLE_GROUP: "Role Group",
    ORG_GROUP: "Organisation",
};

export default function InboxModule() {
    const [rooms, setRooms] = useState<Room[]>([]);
    const [activeRoomId, setActiveRoomId] = useState<string>("");
    const [messages, setMessages] = useState<Message[]>([]);
    const [loadingRooms, setLoadingRooms] = useState(true);
    const [loadingMessages, setLoadingMessages] = useState(false);
    const [draft, setDraft] = useState("");
    const [sending, setSending] = useState(false);

    const activeRoom = rooms.find((room) => room.id === activeRoomId) ?? null;

    const loadRooms = async () => {
        try {
            const res = await axios.get<Room[]>("/api/inbox/rooms");
            setRooms(res.data);
            setActiveRoomId((current) => current || res.data[0]?.id || "");
        } catch {
            toast.error("Failed to load inbox rooms");
        } finally {
            setLoadingRooms(false);
        }
    };

    const loadMessages = async (roomId: string) => {
        setLoadingMessages(true);
        try {
            const res = await axios.get<Message[]>(`/api/inbox/rooms/${roomId}/messages`);
            setMessages(res.data);
            setRooms((prev) => prev.map((room) => room.id === roomId ? { ...room, unreadCount: 0 } : room));
        } catch {
            toast.error("Failed to load messages");
        } finally {
            setLoadingMessages(false);
        }
    };

    useEffect(() => {
        loadRooms();
    }, []);

    useEffect(() => {
        if (!activeRoomId) return;
        loadMessages(activeRoomId);
    }, [activeRoomId]);

    const sendMessage = async () => {
        if (!activeRoom || !draft.trim()) return;
        setSending(true);
        try {
            await axios.post(`/api/inbox/rooms/${activeRoom.id}/messages`, {
                body: draft.trim(),
            });
            setDraft("");
            await Promise.all([loadMessages(activeRoom.id), loadRooms()]);
        } catch (error) {
            const message = axios.isAxiosError(error)
                ? error.response?.data?.error
                : null;
            toast.error(message ?? "Failed to send message");
        } finally {
            setSending(false);
        }
    };

    return (
        <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
            <section className="border-2 border-border bg-card shadow">
                <div className="border-b border-border px-4 py-3">
                    <h2 className="text-lg font-semibold">Inbox Rooms</h2>
                    <p className="text-sm text-muted-foreground">System, personal, role, and organisation spaces.</p>
                </div>
                {loadingRooms ? (
                    <div className="p-4 text-sm text-muted-foreground">Loading rooms...</div>
                ) : (
                    <div className="divide-y">
                        {rooms.map((room) => (
                            <button
                                key={room.id}
                                type="button"
                                onClick={() => setActiveRoomId(room.id)}
                                className={`w-full px-4 py-3 text-left transition-colors ${
                                    activeRoomId === room.id ? "bg-primary/10" : "hover:bg-muted/50"
                                }`}
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="truncate text-sm font-medium text-foreground">{room.name}</p>
                                        <p className="text-xs text-muted-foreground">{TYPE_LABELS[room.type]}</p>
                                        {room.latestMessage && (
                                            <p className="mt-1 truncate text-xs text-muted-foreground">
                                                {room.latestMessage.title ? `${room.latestMessage.title}: ` : ""}
                                                {room.latestMessage.body}
                                            </p>
                                        )}
                                    </div>
                                    {room.unreadCount > 0 && (
                                        <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">
                                            {room.unreadCount}
                                        </span>
                                    )}
                                </div>
                            </button>
                        ))}
                    </div>
                )}
            </section>

            <section className="border-2 border-border bg-card shadow">
                {activeRoom ? (
                    <>
                        <div className="border-b border-border px-4 py-3">
                            <h2 className="text-lg font-semibold">{activeRoom.name}</h2>
                            <p className="text-sm text-muted-foreground">{TYPE_LABELS[activeRoom.type]}</p>
                        </div>
                        <div className="max-h-[60vh] overflow-y-auto p-4 space-y-3">
                            {loadingMessages ? (
                                <p className="text-sm text-muted-foreground">Loading messages...</p>
                            ) : messages.length === 0 ? (
                                <p className="text-sm text-muted-foreground">No messages yet.</p>
                            ) : (
                                messages.map((message) => (
                                    <div
                                        key={message.id}
                                        className={`rounded-xl border p-3 ${
                                            message.messageType === "SYSTEM"
                                                ? "border-amber-200 bg-amber-50"
                                                : "border-border bg-background"
                                        }`}
                                    >
                                        <div className="flex items-center justify-between gap-3">
                                            <p className="text-sm font-medium text-foreground">
                                                {message.messageType === "SYSTEM"
                                                    ? "System"
                                                    : message.senderUser?.name ?? "You"}
                                            </p>
                                            <p className="text-xs text-muted-foreground">
                                                {new Date(message.createdAt).toLocaleString()}
                                            </p>
                                        </div>
                                        {message.title && (
                                            <p className="mt-1 text-sm font-semibold text-foreground">{message.title}</p>
                                        )}
                                        <p className="mt-1 text-sm text-foreground whitespace-pre-wrap">{message.body}</p>
                                        {message.link && (
                                            <Link
                                                href={message.link}
                                                className="mt-2 inline-flex text-xs font-medium text-primary hover:underline"
                                            >
                                                Open related item
                                            </Link>
                                        )}
                                    </div>
                                ))
                            )}
                        </div>
                        <div className="border-t border-border p-4">
                            {activeRoom.type === "SYSTEM_INBOX" ? (
                                <p className="text-sm text-muted-foreground">System inbox is read-only.</p>
                            ) : (
                                <div className="space-y-3">
                                    <textarea
                                        value={draft}
                                        onChange={(e) => setDraft(e.target.value)}
                                        rows={3}
                                        placeholder="Write a message..."
                                        className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                                    />
                                    <div className="flex justify-end">
                                        <button
                                            type="button"
                                            onClick={sendMessage}
                                            disabled={sending || !draft.trim()}
                                            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                                        >
                                            {sending ? "Sending..." : "Send"}
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </>
                ) : (
                    <div className="p-6 text-sm text-muted-foreground">Select a room to open the inbox.</div>
                )}
            </section>
        </div>
    );
}
