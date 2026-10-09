"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import axios from "axios";
import { toast } from "sonner";
import {
    MessageCircle, Mail, PhoneIncoming, PhoneOutgoing, PhoneMissed, Ticket, Check, CheckCheck,
    AlertCircle, Search, Send, Paperclip, X, UserPlus, User, Building2, ShieldAlert, RefreshCw, Lock, FileText, Hand, Users, ArrowRightLeft,
    AtSign, Hash, MessageSquarePlus, ChevronLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDateTime } from "@/shared/lib/format";
import { extractApiError } from "@/shared/lib/api";
import { useRealtimeTopics } from "@/shared/hooks";
import CreatePersonDialog from "@/shared/components/CreatePersonDialog";
import { cn } from "@/shared/lib/format/utils";
import MentionTextarea, { mentionTargets } from "@/modules/message/components/MentionTextarea";
import StaffPickerDialog, { type PickMode, type Staff } from "@/modules/message/components/StaffPickerDialog";
import TeamRoomPane, { dmPartnerId, type Room } from "@/modules/message/components/TeamRoomPane";
import { MessageMedia, captionOf, type MediaInfo } from "./MessageMedia";
import { CustomerAvatar } from "./CustomerAvatar";
import { CustomerProfileDialog } from "./CustomerProfileDialog";

// ── Wire types (mirror /api/messages/*) ─────────────────────────────────────────
type Owner = {
    kind: "person" | "company";
    id: number;
    name: string;
    avatarUrl?: string | null;
    address?: string | null;
    accountId?: number | null;
    balance?: number | null;
    normalBalance?: "DEBIT" | "CREDIT" | null;
};
interface Conversation {
    phone: string;
    customer: Owner | null;
    senderName: string | null;
    unread: number;
    openTicketId: number | null;
    last: { id: number; channel: string; direction: string; kind: string; body: string; at: string };
}
interface ConversationsResponse { items: Conversation[]; page: number; hasMore: boolean; totalUnread: number }

type ThreadMessage = {
    type: "message"; id: number; at: string; channel: string; direction: string; kind: string; body: string;
    senderName: string | null; businessNumber?: string | null; sentBy: string | null; billKind: string | null; billRefId: number | null;
    ticketId: number | null; status: string | null; deliveredAt: string | null; readAt: string | null; error: string | null;
    pending?: boolean;
} & MediaInfo;
type ThreadCall = { type: "call"; id: number; at: string; direction: string; missed: boolean; durationSec: number; note: string | null };
interface Thread {
    phone: string;
    customer: Owner | null;
    senderName: string | null;
    spam: boolean;
    ticket: { id: number; title: string | null; priority: string; status: string | null; assignee: string | null } | null;
    /** Who is handling this chat (MessageClaim) — null until someone replies or takes it. */
    claim: { owner: Staff; helpers: Staff[] } | null;
    replyWindow: { open: boolean; closesAt: string | null };
    items: (ThreadMessage | ThreadCall)[];
}

type Filter = "all" | "unread" | "open" | "unknown" | "team" | "groups";
const FILTERS: { key: Filter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "unread", label: "Unread" },
    { key: "open", label: "Open ticket" },
    { key: "unknown", label: "Unknown" },
    { key: "team", label: "Team" },
    { key: "groups", label: "Groups" },
];
/** Filters that list customers; Team / Groups list only staff rooms. */
const CUSTOMER_FILTERS: Filter[] = ["all", "unread", "open", "unknown"];

type StaffUser = { id: number; name: string };
/** Everyone a staff chat can be with — fetched once per page load. */
let usersCache: Promise<StaffUser[]> | null = null;
function loadUsers(): Promise<StaffUser[]> {
    usersCache ??= axios.get<StaffUser[]>("/api/users").then((r) => r.data.map((u) => ({ id: u.id, name: u.name })))
        .catch((e) => { usersCache = null; throw e; });
    return usersCache;
}

/** One row of the merged list: a customer number, a staff room, or a colleague to start a chat with. */
type Row =
    | { kind: "customer"; key: string; at: string; c: Conversation }
    | { kind: "room"; key: string; at: string; room: Room; title: string }
    | { kind: "start"; key: string; at: string; user: StaffUser };

/** The source logo every message carries. */
function ChannelIcon({ channel, className }: { channel: string; className?: string }) {
    if (channel === "EMAIL") return <Mail className={cn("size-3.5", className)} aria-label="Email" />;
    return <MessageCircle className={cn("size-3.5 text-green-600", className)} aria-label="WhatsApp" />;
}

function displayName(c: { customer: Owner | null; senderName: string | null; phone: string }) {
    return c.customer?.name ?? c.senderName ?? `+91 ${c.phone}`;
}

function shortTime(iso: string) {
    const d = new Date(iso);
    const today = new Date();
    return d.toDateString() === today.toDateString()
        ? d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })
        : d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function hoursLeft(closesAt: string | null) {
    if (!closesAt) return 0;
    return Math.max(0, Math.round((new Date(closesAt).getTime() - Date.now()) / 3_600_000));
}

function billLink(kind: string | null, refId: number | null) {
    if (!kind || refId == null) return null;
    return `/portal/b/${kind.startsWith("REPAIR") ? `t${refId}` : refId}`;
}

function Ticks({ m }: { m: ThreadMessage }) {
    if (m.pending) return <span className="opacity-70">sending…</span>;
    if (m.status === "failed") return <span className="inline-flex items-center gap-1 text-red-600" title={m.error ?? ""}><AlertCircle className="size-3" /> failed</span>;
    if (m.status === "read") return <span className="inline-flex items-center gap-1 text-sky-600"><CheckCheck className="size-3" /> read</span>;
    if (m.status === "delivered") return <span className="inline-flex items-center gap-1"><CheckCheck className="size-3" /> delivered</span>;
    return <span className="inline-flex items-center gap-1"><Check className="size-3" /> sent</span>;
}

export default function MessagesWorkspace({ canReply, canTicket, customers = true, openPhone }: {
    canReply: boolean;
    canTicket: boolean;
    /** False = staff chats only (the POS drawer for someone without CRM → Messages). */
    customers?: boolean;
    /** Open this customer's chat — the POS drawer passes what the popup asked for. */
    openPhone?: string | null;
}) {
    const searchParams = useSearchParams();
    const filters = customers ? FILTERS : FILTERS.filter((f) => f.key === "team" || f.key === "groups");
    const wantFilter = searchParams.get("filter") as Filter | null;
    const [filter, setFilter] = useState<Filter>(
        wantFilter && filters.some((f) => f.key === wantFilter) ? wantFilter : filters[0].key,
    );
    const [query, setQuery] = useState("");
    const [list, setList] = useState<Conversation[]>([]);
    const [hasMore, setHasMore] = useState(false);
    const [page, setPage] = useState(1);
    const [totalUnread, setTotalUnread] = useState(0);
    const [listLoading, setListLoading] = useState(true);

    const [selected, setSelected] = useState<string | null>(null);
    const [thread, setThread] = useState<Thread | null>(null);
    const [threadLoading, setThreadLoading] = useState(false);
    const [draft, setDraft] = useState("");
    const [sending, setSending] = useState(false);
    // A photo / file picked with the paperclip; the draft becomes its caption.
    const [attach, setAttach] = useState<File | null>(null);
    const fileRef = useRef<HTMLInputElement>(null);
    const [newPartyPhone, setNewPartyPhone] = useState<string | null>(null);
    const [showProfile, setShowProfile] = useState(false);
    const bottomRef = useRef<HTMLDivElement>(null);
    const me = Number((useSession().data?.user as { id?: string } | undefined)?.id ?? 0);
    const [pick, setPick] = useState<PickMode | null>(null);

    // ── Staff chats (team Inbox rooms) beside the customers ──────────────────
    const [rooms, setRooms] = useState<Room[]>([]);
    const [users, setUsers] = useState<StaffUser[]>([]);
    const [roomId, setRoomId] = useState<string | null>(null);
    const meName = (useSession().data?.user as { name?: string } | undefined)?.name ?? undefined;
    const loadRooms = useCallback(async () => {
        try {
            const { data } = await axios.get<Room[]>("/api/inbox/rooms");
            // System / personal notification rooms stay with the bell.
            setRooms(data.filter((r) => r.type === "ORG_GROUP" || r.type === "DIRECT_MESSAGE"));
        } catch { /* customers still work without it */ }
    }, []);
    useEffect(() => { void loadRooms(); loadUsers().then(setUsers).catch(() => {}); }, [loadRooms]);
    // A new room / being added announces "chat"; a message in a background room
    // reaches GlobalInboxListener, which fires "inbox:unread".
    useRealtimeTopics(["chat"], () => void loadRooms());
    useEffect(() => {
        const h = () => void loadRooms();
        window.addEventListener("inbox:unread", h);
        return () => window.removeEventListener("inbox:unread", h);
    }, [loadRooms]);
    const roomTitle = (r: Room) => (r.type === "DIRECT_MESSAGE" && me ? users.find((u) => u.id === dmPartnerId(r, me))?.name ?? r.name : r.name);
    const openRoom = (id: string) => {
        setRoomId(id);
        setSelected(null);
        setThread(null);
    };
    const startDm = async (userId: number) => {
        try {
            const { data } = await axios.post<{ id: string }>(`/api/inbox/direct/${userId}`);
            await loadRooms();
            setQuery("");
            openRoom(data.id);
        } catch (e) {
            toast.error(extractApiError(e, "Could not open the chat"));
        }
    };

    const staffSearch = query.trim().startsWith("@");
    const showCustomers = customers && CUSTOMER_FILTERS.includes(filter) && !staffSearch;
    const loadList = useCallback(async (p = 1) => {
        if (!showCustomers) { setList([]); setHasMore(false); setListLoading(false); return; }
        try {
            const { data } = await axios.get<ConversationsResponse>("/api/messages/conversations", {
                params: { filter, q: query.trim() || undefined, page: p },
            });
            setList((prev) => (p === 1 ? data.items : [...prev, ...data.items]));
            setHasMore(data.hasMore);
            setPage(p);
            setTotalUnread(data.totalUnread);
        } catch (e) {
            toast.error(extractApiError(e, "Could not load messages"));
        } finally {
            setListLoading(false);
        }
    }, [filter, query, showCustomers]);

    // Search waits for typing to settle; a filter change reloads at once.
    useEffect(() => {
        const t = setTimeout(() => void loadList(1), query ? 300 : 0);
        return () => clearTimeout(t);
    }, [loadList, query]);

    const loadThread = useCallback(async (phone: string) => {
        try {
            const { data } = await axios.get<Thread>("/api/messages/thread", { params: { phone } });
            setThread((prev) => (prev && prev.phone !== phone ? prev : data));
        } catch (e) {
            toast.error(extractApiError(e, "Could not load the conversation"));
        } finally {
            setThreadLoading(false);
        }
    }, []);

    const openConversation = (phone: string) => {
        setRoomId(null);
        setSelected(phone);
        setThread(null);
        setThreadLoading(true);
        setDraft("");
        void loadThread(phone);
        // Opening is reading: clear its unread count here and on the server.
        setList((prev) => prev.map((c) => (c.phone === phone ? { ...c, unread: 0 } : c)));
        const had = list.find((c) => c.phone === phone)?.unread ?? 0;
        if (had) {
            setTotalUnread((n) => Math.max(0, n - had));
            // Re-read once the server has it: a list load already in flight would
            // otherwise land after this and put the old count back.
            void axios.patch("/api/messages/thread", { phone, seen: true })
                .then(() => loadList(1))
                .catch(() => {});
        }
    };

    // The new-message popup opens a chat here as ?phone=... once per arrival.
    const wantPhone = openPhone ?? searchParams.get("phone");
    const openedFromLink = useRef<string | null>(null);
    useEffect(() => {
        if (!wantPhone || listLoading || openedFromLink.current === wantPhone) return;
        openedFromLink.current = wantPhone;
        openConversation(wantPhone);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- open once per link, after the list (unread counts) is in
    }, [wantPhone, listLoading]);

    const changeClaim = async (body: { action: "take" | "leave" } | { action: PickMode; userId: number }, done: string) => {
        if (!thread) return;
        try {
            await axios.post("/api/messages/claim", { phone: thread.phone, ...body });
            toast.success(done);
            setPick(null);
            void loadThread(thread.phone);
        } catch (e) {
            toast.error(extractApiError(e, "Could not update who handles this chat"));
        }
    };
    const openPicker = (mode: PickMode) => setPick(mode);

    const refresh = useCallback(() => {
        void loadList(1);
        if (selected) void loadThread(selected);
    }, [loadList, loadThread, selected]);
    useRealtimeTopics(["messages", "tickets"], refresh, true, ["Message", "MessageClaim", "Call", "Ticket"]);

    useEffect(() => { bottomRef.current?.scrollIntoView({ block: "end" }); }, [thread?.items.length, selected]);

    const send = async () => {
        const text = draft.trim();
        const file = attach;
        if ((!text && !file) || !thread || sending) return;
        // An @mention makes it a staff note — never sent to the customer.
        if (!file) {
            const target = await mentionTargets(text, me);
            if (target && !target.ids.length) { toast.error("Nobody else in that mention can take this chat"); return; }
            if (target) {
                setSending(true);
                try {
                    await axios.post("/api/messages/note", { phone: thread.phone, text, mentionIds: target.ids });
                    setDraft("");
                    toast.success(`Passed to ${target.label} — not sent to the customer`);
                    void loadThread(thread.phone);
                    void loadList(1);
                } catch (e) {
                    toast.error(extractApiError(e, "Note not saved"));
                } finally {
                    setSending(false);
                }
                return;
            }
        }
        setSending(true);
        // Show it straight away (a local preview for a file); the server copy replaces it on reload.
        const localUrl = file ? URL.createObjectURL(file) : null;
        const temp: ThreadMessage = {
            type: "message", id: -Date.now(), at: new Date().toISOString(), channel: "WHATSAPP", direction: "OUT",
            kind: "text", body: text, senderName: null, sentBy: "You", billKind: null, billRefId: null,
            ticketId: thread.ticket?.id ?? null, status: null, deliveredAt: null, readAt: null, error: null, pending: true,
            ...(file ? { mediaUrl: localUrl, mediaType: file.type || "application/octet-stream", fileName: file.name, mediaSize: file.size } : {}),
        };
        setThread((t) => (t ? { ...t, items: [...t.items, temp] } : t));
        setDraft("");
        setAttach(null);
        try {
            let media: { key: string; type: string; name: string; size: number } | null = null;
            if (file) {
                const type = file.type || "application/octet-stream";
                const { data } = await axios.post<{ key: string; putUrl: string }>("/api/messages/upload-url", {
                    phone: thread.phone, name: file.name, type, size: file.size,
                });
                // Straight to R2 — the signed URL carries the permission.
                const put = await fetch(data.putUrl, { method: "PUT", headers: { "Content-Type": type }, body: file });
                if (!put.ok) throw new Error(`Upload failed (${put.status})`);
                media = { key: data.key, type, name: file.name, size: file.size };
            }
            await axios.post("/api/messages/reply", { phone: thread.phone, text, media });
            void loadThread(thread.phone);
            void loadList(1);
        } catch (e) {
            setThread((t) => (t ? { ...t, items: t.items.filter((i) => i !== temp) } : t));
            setDraft(text);
            setAttach(file);
            toast.error(extractApiError(e, "Reply not sent"));
        } finally {
            if (localUrl) setTimeout(() => URL.revokeObjectURL(localUrl), 60_000);
            setSending(false);
        }
    };

    const raiseTicket = async (messageId: number, ticketId?: number) => {
        try {
            const { data } = await axios.post<{ ticketId: number }>(`/api/messages/${messageId}/ticket`, ticketId ? { ticketId } : {});
            toast.success(ticketId ? `Added to ticket #${data.ticketId}` : `Ticket #${data.ticketId} raised`);
            if (thread) void loadThread(thread.phone);
            void loadList(1);
        } catch (e) {
            toast.error(extractApiError(e, "Could not raise the ticket"));
        }
    };

    const toggleSpam = async () => {
        if (!thread) return;
        try {
            await axios.patch("/api/messages/thread", { phone: thread.phone, spam: !thread.spam });
            toast.success(thread.spam ? "Number un-flagged" : "Number marked spam — hidden from the list");
            void loadThread(thread.phone);
            void loadList(1);
        } catch (e) {
            toast.error(extractApiError(e, "Could not update"));
        }
    };

    // ── The merged list ──────────────────────────────────────────────────────
    const q = query.trim().replace(/^@/, "").toLowerCase();
    const roomRows: Row[] = filter === "open" || filter === "unknown" ? [] : rooms
        .filter((r) => filter !== "team" || r.type === "DIRECT_MESSAGE")
        .filter((r) => filter !== "groups" || r.type === "ORG_GROUP")
        .filter((r) => !staffSearch || r.type === "DIRECT_MESSAGE")
        .filter((r) => filter !== "unread" || r.unreadCount > 0)
        .map((r) => ({ kind: "room" as const, key: `r:${r.id}`, at: r.latestMessage?.createdAt ?? "", room: r, title: roomTitle(r) }))
        .filter((r) => !q || r.title.toLowerCase().includes(q));
    // "@name" (and the Team chip) also offer colleagues there is no chat with yet.
    const dmWith = new Set(rooms.filter((r) => r.type === "DIRECT_MESSAGE" && me).map((r) => dmPartnerId(r, me)));
    const startRows: Row[] = staffSearch || filter === "team"
        ? users.filter((u) => u.id !== me && !dmWith.has(u.id) && (!q || u.name.toLowerCase().includes(q)))
            .slice(0, staffSearch ? 8 : 50)
            .map((u) => ({ kind: "start" as const, key: `u:${u.id}`, at: "", user: u }))
        : [];
    // A staff room older than the last customer loaded waits for "Load more",
    // so paging never shuffles rows already on screen.
    const oldest = hasMore && list.length ? list[list.length - 1].last.at : "";
    const rows: Row[] = [
        ...list.map((c) => ({ kind: "customer" as const, key: `c:${c.phone}`, at: c.last.at, c })),
        ...roomRows.filter((r) => !oldest || r.at >= oldest),
    ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).concat(startRows);
    const roomUnread = rooms.reduce((n, r) => n + r.unreadCount, 0);
    const activeRoom = roomId ? rooms.find((r) => r.id === roomId) ?? null : null;
    const isDetailOpen = Boolean(selected || roomId);

    return (
        <div className="relative flex h-full min-h-0 w-full overflow-hidden md:grid md:grid-cols-[320px_minmax(0,1fr)]">
            {/* ── Conversation list ─────────────────────────────────────────── */}
            <aside className={cn(
                "flex h-full min-h-0 flex-col border-r bg-background",
                isDetailOpen ? "hidden md:flex" : "flex flex-1 w-full"
            )}>
                <div className="space-y-2 border-b p-3">
                    <div className="flex items-center justify-between">
                        <h1 className="text-base font-semibold">Messages</h1>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            {totalUnread + roomUnread > 0 && <span>{totalUnread + roomUnread} unread</span>}
                            <Button variant="ghost" size="icon" className="size-7" onClick={() => { void loadList(1); void loadRooms(); }} title="Refresh">
                                <RefreshCw className="size-3.5" />
                            </Button>
                        </div>
                    </div>
                    <div className="relative">
                        <Search className="absolute left-2 top-2.5 size-4 text-muted-foreground" />
                        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name, mobile, message — or @staff" className="pl-8" />
                    </div>
                    <div className="flex flex-wrap gap-1">
                        {filters.map((f) => (
                            <button
                                key={f.key}
                                onClick={() => setFilter(f.key)}
                                className={cn(
                                    "rounded-md border px-2 py-0.5 text-xs",
                                    filter === f.key ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted",
                                )}
                            >
                                {f.label}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto">
                    {listLoading && <p className="p-4 text-sm text-muted-foreground">Loading…</p>}
                    {!listLoading && rows.length === 0 && (
                        <p className="p-4 text-sm text-muted-foreground">
                            {showCustomers ? "No messages yet. Customer replies to WhatsApp bills land here." : "No staff chats here yet."}
                        </p>
                    )}
                    {rows.map((row) => {
                        if (row.kind === "start") {
                            return (
                                <button
                                    key={row.key}
                                    onClick={() => void startDm(row.user.id)}
                                    className="flex w-full items-center gap-2.5 border-b px-3 py-2 text-left text-sm text-muted-foreground hover:bg-muted/60"
                                >
                                    <div className="flex size-[38px] shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">
                                        <MessageSquarePlus className="size-4 shrink-0" />
                                    </div>
                                    <div className="min-w-0 flex-1 truncate">
                                        Start chat with <span className="font-medium text-foreground">{row.user.name}</span>
                                    </div>
                                </button>
                            );
                        }
                        if (row.kind === "room") {
                            const r = row.room;
                            const dm = r.type === "DIRECT_MESSAGE";
                            const Icon = dm ? AtSign : Hash;
                            const last = r.latestMessage;
                            return (
                                <button
                                    key={row.key}
                                    onClick={() => openRoom(r.id)}
                                    className={cn("block w-full border-b px-3 py-2 text-left hover:bg-muted/60", roomId === r.id && "bg-primary/10")}
                                >
                                    <div className="flex items-center gap-2.5">
                                        <div className={cn(
                                            "flex size-[38px] shrink-0 items-center justify-center rounded-full font-semibold text-xs",
                                            dm ? "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300" : "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                                        )}>
                                            <Icon className="size-4 shrink-0" aria-label={dm ? "Staff chat" : "Staff group"} />
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center justify-between gap-2">
                                                <span className={cn("truncate text-sm", r.unreadCount ? "font-semibold" : "font-medium")}>
                                                    {row.title}
                                                </span>
                                                {last && <span className="shrink-0 text-xs text-muted-foreground">{shortTime(last.createdAt)}</span>}
                                            </div>
                                            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                                                <span className="truncate">
                                                    {last ? `${!dm && last.senderUser?.name ? `${last.senderUser.name}: ` : ""}${last.body}` : "No messages yet"}
                                                </span>
                                                {r.unreadCount > 0 && (
                                                    <span className={cn("shrink-0 rounded-full px-1.5 text-[11px] text-white font-medium", dm ? "bg-violet-600" : "bg-blue-600")}>{r.unreadCount}</span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </button>
                            );
                        }
                        const c = row.c;
                        return (
                            <button
                                key={row.key}
                                onClick={() => openConversation(c.phone)}
                                className={cn(
                                    "block w-full border-b px-3 py-2 text-left hover:bg-muted/60",
                                    selected === c.phone && "bg-primary/10",
                                )}
                            >
                                <div className="flex items-center gap-2.5">
                                    <CustomerAvatar
                                        name={displayName(c)}
                                        avatarUrl={c.customer?.avatarUrl}
                                        kind={c.customer?.kind}
                                        phone={c.phone}
                                        sizePx={38}
                                    />
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center justify-between gap-2">
                                            <span className={cn("truncate text-sm", c.unread ? "font-semibold" : "font-medium")}>
                                                {!c.customer && <UserPlus className="mr-1 inline size-3.5 text-amber-600" aria-label="Not a party yet" />}
                                                {displayName(c)}
                                            </span>
                                            <span className="shrink-0 text-xs text-muted-foreground">{shortTime(c.last.at)}</span>
                                        </div>
                                        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                                            <span className="flex min-w-0 items-center gap-1">
                                                <ChannelIcon channel={c.last.channel} className="shrink-0" />
                                                <span className="truncate">{c.last.direction === "OUT" ? "You: " : c.last.direction === "NOTE" ? "Note: " : ""}{c.last.body}</span>
                                            </span>
                                            <span className="flex shrink-0 items-center gap-1">
                                                {c.openTicketId && <span className="rounded bg-sky-100 px-1 text-sky-800 dark:bg-sky-900 dark:text-sky-100">#{c.openTicketId}</span>}
                                                {c.unread > 0 && <span className="rounded-full bg-green-600 px-1.5 text-[11px] text-white font-medium">{c.unread}</span>}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </button>
                        );
                    })}
                    {hasMore && (
                        <div className="p-2 text-center">
                            <Button variant="ghost" size="sm" onClick={() => void loadList(page + 1)}>Load more</Button>
                        </div>
                    )}
                </div>
            </aside>

            {/* ── Thread / Room ───────────────────────────────────────────── */}
            <div className={cn(
                "flex h-full min-h-0 flex-col bg-background",
                !isDetailOpen ? "hidden md:flex" : "fixed inset-0 z-30 flex flex-1 w-full flex-col bg-background md:relative md:inset-auto md:z-auto md:h-full"
            )}>
                {activeRoom ? (
                    <TeamRoomPane
                        key={activeRoom.id}
                        room={activeRoom}
                        title={roomTitle(activeRoom)}
                        currentUserId={me || undefined}
                        currentUserName={meName}
                        onRead={(id) => setRooms((prev) => prev.map((r) => (r.id === id ? { ...r, unreadCount: 0 } : r)))}
                        onSent={() => void loadRooms()}
                        onBack={() => setRoomId(null)}
                    />
                ) : (
                    <section className="flex h-full min-h-0 flex-col">
                        {!selected && (
                            <div className="m-auto text-sm text-muted-foreground">Pick a conversation on the left.</div>
                        )}
                        {selected && threadLoading && !thread && <p className="p-4 text-sm text-muted-foreground">Loading…</p>}
                        {thread && (
                            <>
                                <header className="flex shrink-0 items-center justify-between gap-2 border-b bg-background px-3 py-2 pt-[calc(0.5rem+env(safe-area-inset-top))] md:px-4 md:pt-2">
                                    <div className="flex items-center gap-2 min-w-0">
                                        <button
                                            type="button"
                                            onClick={() => setSelected(null)}
                                            className="rounded-md p-1.5 hover:bg-muted active:bg-muted md:hidden shrink-0"
                                            aria-label="Back to chat list"
                                        >
                                            <ChevronLeft className="size-5" />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setShowProfile(true)}
                                            className="flex items-center gap-2.5 min-w-0 text-left hover:opacity-80 active:opacity-70 transition-opacity"
                                            title="View customer profile"
                                        >
                                            <CustomerAvatar
                                                name={displayName(thread)}
                                                avatarUrl={thread.customer?.avatarUrl}
                                                kind={thread.customer?.kind}
                                                phone={thread.phone}
                                                sizePx={38}
                                            />
                                            <div className="min-w-0">
                                                <div className="flex items-center gap-1.5 font-medium">
                                                    <span className="truncate text-sm font-semibold">{displayName(thread)}</span>
                                                    {thread.customer
                                                        ? <span className="shrink-0 rounded bg-amber-100 px-1 text-[10px] font-medium text-amber-800 dark:bg-amber-900 dark:text-amber-100">Customer</span>
                                                        : <span className="shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground">Not a party</span>}
                                                </div>
                                                <div className="truncate text-xs text-muted-foreground">
                                                    +91 {thread.phone}{thread.senderName && thread.customer ? ` · WA: ${thread.senderName}` : ""}
                                                </div>
                                            </div>
                                        </button>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-1">
                                        {!thread.customer && (
                                            <Button size="sm" variant="outline" className="h-8 px-2 text-xs" onClick={() => setNewPartyPhone(thread.phone)}>
                                                <UserPlus className="mr-1 size-3.5" /> <span className="hidden sm:inline">Create </span>party
                                            </Button>
                                        )}
                                        {thread.customer && (
                                            <Button size="sm" variant="outline" className="h-8 px-2 text-xs" onClick={() => setShowProfile(true)}>
                                                Profile
                                            </Button>
                                        )}
                                        <Button size="sm" variant="ghost" className="size-8 p-0" onClick={toggleSpam} title={thread.spam ? "Not spam" : "Mark this number spam"}>
                                            <ShieldAlert className="size-4" />
                                        </Button>
                                    </div>
                                </header>

                                {thread.claim && (
                                    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-muted/40 px-3 py-1 text-xs md:px-4">
                                        <Hand className="size-3.5 shrink-0 text-muted-foreground" />
                                        <span className="min-w-0 flex-1 truncate">
                                            Handled by <b>{thread.claim.owner.id === me ? "you" : thread.claim.owner.name}</b>
                                            {thread.claim.helpers.length > 0 && <> · with {thread.claim.helpers.map((h) => (h.id === me ? "you" : h.name)).join(", ")}</>}
                                        </span>
                                        {canReply && (
                                            <span className="flex shrink-0 gap-1">
                                                {thread.claim.owner.id !== me && (
                                                    <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={() => void changeClaim({ action: "take" }, "You are handling this chat")}>
                                                        <Hand className="mr-1 size-3" /> Take over
                                                    </Button>
                                                )}
                                                <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={() => openPicker("invite")}>
                                                    <Users className="mr-1 size-3" /> Invite
                                                </Button>
                                                {thread.claim.owner.id === me && (
                                                    <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={() => openPicker("handover")}>
                                                        <ArrowRightLeft className="mr-1 size-3" /> Handover
                                                    </Button>
                                                )}
                                                {thread.claim.helpers.some((h) => h.id === me) && (
                                                    <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={() => void changeClaim({ action: "leave" }, "You left this chat")}>
                                                        Leave
                                                    </Button>
                                                )}
                                            </span>
                                        )}
                                    </div>
                                )}

                        {thread.ticket && (
                            <a
                                href={`/office/help?ticket=${thread.ticket.id}`}
                                className="mx-4 mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-sky-300 bg-sky-50 px-3 py-2 text-sm text-sky-900 hover:bg-sky-100 dark:border-sky-700 dark:bg-sky-950 dark:text-sky-100"
                            >
                                <span className="flex items-center gap-2">
                                    <Ticket className="size-4" /> Open ticket #{thread.ticket.id} · {thread.ticket.title ?? "Help"}
                                </span>
                                <span className="text-xs">
                                    {[thread.ticket.status, thread.ticket.assignee ? `Assigned: ${thread.ticket.assignee}` : "Not assigned", thread.ticket.priority].filter(Boolean).join(" · ")}
                                </span>
                            </a>
                        )}

                        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-3">
                            {thread.items.length === 0 && <p className="text-sm text-muted-foreground">Nothing here yet.</p>}
                            {thread.items.map((it) => {
                                if (it.type === "call") {
                                    const Icon = it.missed ? PhoneMissed : it.direction === "OUTGOING" ? PhoneOutgoing : PhoneIncoming;
                                    return (
                                        <div key={`c${it.id}`} className="flex justify-center">
                                            <span className={cn("inline-flex items-center gap-1 text-xs text-muted-foreground", it.missed && "text-red-600")}>
                                                <Icon className="size-3.5" />
                                                {it.missed ? "Missed call" : it.direction === "OUTGOING" ? "Outgoing call" : "Incoming call"}
                                                {!it.missed && it.durationSec ? ` · ${Math.ceil(it.durationSec / 60)} min` : ""}
                                                {" · "}{formatDateTime(it.at)}
                                                {it.note ? ` · ${it.note}` : ""}
                                            </span>
                                        </div>
                                    );
                                }
                                if (it.direction === "NOTE") {
                                    return (
                                        <div key={`m${it.id}`} className="flex justify-center">
                                            <div className="max-w-[75%] rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-50">
                                                <div className="text-[11px] opacity-80">{it.sentBy ?? "Staff"} · staff note, not sent to the customer · {formatDateTime(it.at)}</div>
                                                <div className="whitespace-pre-wrap break-words">{it.body}</div>
                                            </div>
                                        </div>
                                    );
                                }
                                const out = it.direction === "OUT";
                                const link = billLink(it.billKind, it.billRefId);
                                return (
                                    <div key={`m${it.id}`} className={cn("flex", out ? "justify-end" : "justify-start")}>
                                        <div
                                            className={cn(
                                                "max-w-[75%] rounded-lg px-3 py-2 text-sm",
                                                out ? "bg-green-100 text-green-950 dark:bg-green-950 dark:text-green-50" : "bg-muted",
                                                it.ticketId && "ring-1 ring-sky-400",
                                            )}
                                        >
                                            <div className="mb-0.5 flex flex-wrap items-center gap-1 text-[11px] opacity-80">
                                                <ChannelIcon channel={it.channel} />
                                                <span>{it.channel === "EMAIL" ? "Email" : "WhatsApp"}</span>
                                                {it.businessNumber && <span title="Our number this came in on">· via …{it.businessNumber.slice(-5)}</span>}
                                                {out && <span>· {it.sentBy ?? "System"}</span>}
                                                {it.billKind && (
                                                    <span className="inline-flex items-center gap-0.5">
                                                        · <FileText className="size-3" />
                                                        {link ? <a href={link} target="_blank" rel="noreferrer" className="underline">{out ? "Bill" : "Reply to bill"}</a> : "Bill"}
                                                    </span>
                                                )}
                                                {it.ticketId && <span className="inline-flex items-center gap-0.5">· <Ticket className="size-3" />#{it.ticketId}</span>}
                                            </div>
                                            <MessageMedia m={it} />
                                            {captionOf(it.body, !!(it.mediaUrl || it.mediaType)) && (
                                                <div className="whitespace-pre-wrap break-words">{captionOf(it.body, !!(it.mediaUrl || it.mediaType))}</div>
                                            )}
                                            <div className="mt-0.5 flex items-center justify-end gap-2 text-[11px] opacity-70">
                                                {!out && !it.ticketId && canTicket && (
                                                    <button className="underline" onClick={() => void raiseTicket(it.id, thread.ticket?.id)}>
                                                        {thread.ticket ? `+ Add to #${thread.ticket.id}` : "+ Ticket"}
                                                    </button>
                                                )}
                                                <span>{formatDateTime(it.at)}</span>
                                                {out && <Ticks m={it} />}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                            <div ref={bottomRef} />
                        </div>

                        <footer className="shrink-0 border-t bg-background px-2.5 py-2 pb-[max(0.6rem,env(safe-area-inset-bottom))] md:px-4 md:py-2.5">
                            {!canReply ? (
                                <p className="text-xs text-muted-foreground">You can read these messages. Replying needs the &ldquo;Reply to customer messages&rdquo; tick on your role.</p>
                            ) : thread.replyWindow.open ? (
                                <>
                                    {attach && (
                                        <div className="mb-1.5 inline-flex max-w-full items-center gap-1 rounded-md border bg-muted px-2 py-0.5 text-xs">
                                            <Paperclip className="size-3 shrink-0" />
                                            <span className="truncate">{attach.name}</span>
                                            <span className="opacity-60">{Math.max(1, Math.round(attach.size / 1024))} KB</span>
                                            <button onClick={() => setAttach(null)} title="Remove" className="ml-1"><X className="size-3" /></button>
                                        </div>
                                    )}
                                    <div className="flex items-end gap-1.5 md:gap-2">
                                        <span className="mb-2 hidden sm:inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground"><ChannelIcon channel="WHATSAPP" /> WhatsApp</span>
                                        <input
                                            ref={fileRef}
                                            type="file"
                                            className="hidden"
                                            accept="image/jpeg,image/png,video/mp4,video/3gpp,audio/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip"
                                            onChange={(e) => { setAttach(e.target.files?.[0] ?? null); e.target.value = ""; }}
                                        />
                                        <Button variant="ghost" size="icon" className="size-9 shrink-0" onClick={() => fileRef.current?.click()} disabled={sending} title="Attach a photo or file">
                                            <Paperclip className="size-4" />
                                        </Button>
                                        <MentionTextarea
                                            value={draft}
                                            onChange={setDraft}
                                            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
                                            placeholder={attach ? "Add a caption (optional)" : "Reply, or @name for note…"}
                                        />
                                        <Button onClick={() => void send()} disabled={sending || (!draft.trim() && !attach)} size="icon" className="size-9 shrink-0" title="Send">
                                            <Send className="size-4" />
                                        </Button>
                                    </div>
                                    <p className="mt-1 flex items-center justify-between gap-1 text-[11px] text-muted-foreground">
                                        <span>Free reply: {hoursLeft(thread.replyWindow.closesAt)} h left.</span>
                                        <span className="hidden md:inline"> Enter sends, Shift+Enter adds a line.</span>
                                        <span>@name = staff note</span>
                                    </p>
                                </>
                            ) : (
                                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                                    <Lock className="size-3.5 shrink-0" /> More than 24 hours since customer last wrote. WhatsApp only allows approved templates.
                                </p>
                            )}
                        </footer>
                    </>
                )}
            </section>
            )}
            </div>

            <StaffPickerDialog
                mode={pick}
                exclude={[me, ...(pick === "invite" && thread?.claim ? [thread.claim.owner.id, ...thread.claim.helpers.map((h) => h.id)] : [])]}
                onClose={() => setPick(null)}
                onPick={(st: Staff) => pick && void changeClaim(
                    { action: pick, userId: st.id },
                    pick === "handover" ? `Handed over to ${st.name}` : `${st.name} invited`,
                )}
            />

            <CreatePersonDialog
                open={newPartyPhone !== null}
                onOpenChange={(o) => { if (!o) { setNewPartyPhone(null); refresh(); } }}
                initialPhone={newPartyPhone ?? undefined}
            />

            {thread && (
                <CustomerProfileDialog
                    open={showProfile}
                    onOpenChange={setShowProfile}
                    customer={thread.customer}
                    phone={thread.phone}
                    senderName={thread.senderName}
                    spam={thread.spam}
                    ticket={thread.ticket}
                    onToggleSpam={toggleSpam}
                    onCreateParty={() => {
                        setShowProfile(false);
                        setNewPartyPhone(thread.phone);
                    }}
                />
            )}
        </div>
    );
}
