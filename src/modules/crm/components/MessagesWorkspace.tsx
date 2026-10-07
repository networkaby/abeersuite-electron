"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import {
    MessageCircle, Mail, PhoneIncoming, PhoneOutgoing, PhoneMissed, Ticket, Check, CheckCheck,
    AlertCircle, Search, Send, UserPlus, User, Building2, ShieldAlert, RefreshCw, Lock, FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime } from "@/shared/lib/format";
import { extractApiError } from "@/shared/lib/api";
import { useRealtimeTopics } from "@/shared/hooks";
import CreatePersonDialog from "@/shared/components/CreatePersonDialog";
import { cn } from "@/shared/lib/format/utils";

// ── Wire types (mirror /api/messages/*) ─────────────────────────────────────────
type Owner = { kind: "person" | "company"; id: number; name: string };
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
    senderName: string | null; sentBy: string | null; billKind: string | null; billRefId: number | null;
    ticketId: number | null; status: string | null; deliveredAt: string | null; readAt: string | null; error: string | null;
    pending?: boolean;
};
type ThreadCall = { type: "call"; id: number; at: string; direction: string; missed: boolean; durationSec: number; note: string | null };
interface Thread {
    phone: string;
    customer: Owner | null;
    senderName: string | null;
    spam: boolean;
    ticket: { id: number; title: string | null; priority: string; status: string | null; assignee: string | null } | null;
    replyWindow: { open: boolean; closesAt: string | null };
    items: (ThreadMessage | ThreadCall)[];
}

type Filter = "all" | "unread" | "open" | "unknown";
const FILTERS: { key: Filter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "unread", label: "Unread" },
    { key: "open", label: "Open ticket" },
    { key: "unknown", label: "Unknown" },
];

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

export default function MessagesWorkspace({ canReply, canTicket }: { canReply: boolean; canTicket: boolean }) {
    const [filter, setFilter] = useState<Filter>("all");
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
    const [newPartyPhone, setNewPartyPhone] = useState<string | null>(null);
    const bottomRef = useRef<HTMLDivElement>(null);

    const loadList = useCallback(async (p = 1) => {
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
    }, [filter, query]);

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
            void axios.patch("/api/messages/thread", { phone, seen: true }).catch(() => {});
        }
    };

    const refresh = useCallback(() => {
        void loadList(1);
        if (selected) void loadThread(selected);
    }, [loadList, loadThread, selected]);
    useRealtimeTopics(["chat", "tickets"], refresh, true, ["Message", "Call", "Ticket"]);

    useEffect(() => { bottomRef.current?.scrollIntoView({ block: "end" }); }, [thread?.items.length, selected]);

    const send = async () => {
        const text = draft.trim();
        if (!text || !thread || sending) return;
        setSending(true);
        // Show it straight away; the server copy replaces it on reload.
        const temp: ThreadMessage = {
            type: "message", id: -Date.now(), at: new Date().toISOString(), channel: "WHATSAPP", direction: "OUT",
            kind: "text", body: text, senderName: null, sentBy: "You", billKind: null, billRefId: null,
            ticketId: thread.ticket?.id ?? null, status: null, deliveredAt: null, readAt: null, error: null, pending: true,
        };
        setThread((t) => (t ? { ...t, items: [...t.items, temp] } : t));
        setDraft("");
        try {
            await axios.post("/api/messages/reply", { phone: thread.phone, text });
            void loadThread(thread.phone);
            void loadList(1);
        } catch (e) {
            setThread((t) => (t ? { ...t, items: t.items.filter((i) => i !== temp) } : t));
            setDraft(text);
            toast.error(extractApiError(e, "Reply not sent"));
        } finally {
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

    return (
        <div className="grid h-full min-h-0 grid-cols-[320px_minmax(0,1fr)]">
            {/* ── Conversation list ─────────────────────────────────────────── */}
            <aside className="flex min-h-0 flex-col border-r">
                <div className="space-y-2 border-b p-3">
                    <div className="flex items-center justify-between">
                        <h1 className="text-base font-semibold">Messages</h1>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            {totalUnread > 0 && <span>{totalUnread} unread</span>}
                            <Button variant="ghost" size="icon" className="size-7" onClick={() => void loadList(1)} title="Refresh">
                                <RefreshCw className="size-3.5" />
                            </Button>
                        </div>
                    </div>
                    <div className="relative">
                        <Search className="absolute left-2 top-2.5 size-4 text-muted-foreground" />
                        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name, mobile or message" className="pl-8" />
                    </div>
                    <div className="flex flex-wrap gap-1">
                        {FILTERS.map((f) => (
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
                    {!listLoading && list.length === 0 && (
                        <p className="p-4 text-sm text-muted-foreground">
                            No messages yet. Customer replies to WhatsApp bills land here.
                        </p>
                    )}
                    {list.map((c) => (
                        <button
                            key={c.phone}
                            onClick={() => openConversation(c.phone)}
                            className={cn(
                                "block w-full border-b px-3 py-2 text-left hover:bg-muted/60",
                                selected === c.phone && "bg-primary/10",
                            )}
                        >
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
                                    <span className="truncate">{c.last.direction === "OUT" ? "You: " : ""}{c.last.body}</span>
                                </span>
                                <span className="flex shrink-0 items-center gap-1">
                                    {c.openTicketId && <span className="rounded bg-sky-100 px-1 text-sky-800 dark:bg-sky-900 dark:text-sky-100">#{c.openTicketId}</span>}
                                    {c.unread > 0 && <span className="rounded-full bg-green-600 px-1.5 text-[11px] text-white">{c.unread}</span>}
                                </span>
                            </div>
                        </button>
                    ))}
                    {hasMore && (
                        <div className="p-2 text-center">
                            <Button variant="ghost" size="sm" onClick={() => void loadList(page + 1)}>Load more</Button>
                        </div>
                    )}
                </div>
            </aside>

            {/* ── Thread ───────────────────────────────────────────────────── */}
            <section className="flex min-h-0 flex-col">
                {!selected && (
                    <div className="m-auto text-sm text-muted-foreground">Pick a conversation on the left.</div>
                )}
                {selected && threadLoading && !thread && <p className="p-4 text-sm text-muted-foreground">Loading…</p>}
                {thread && (
                    <>
                        <header className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2">
                            <div className="min-w-0">
                                <div className="flex items-center gap-2 font-medium">
                                    {thread.customer?.kind === "company" ? <Building2 className="size-4" /> : <User className="size-4" />}
                                    <span className="truncate">{displayName(thread)}</span>
                                    {thread.customer
                                        ? <span className="rounded bg-amber-100 px-1.5 text-[11px] text-amber-800 dark:bg-amber-900 dark:text-amber-100">Customer</span>
                                        : <span className="rounded bg-muted px-1.5 text-[11px] text-muted-foreground">Not a party</span>}
                                </div>
                                <div className="text-xs text-muted-foreground">+91 {thread.phone}{thread.senderName && thread.customer ? ` · WhatsApp name: ${thread.senderName}` : ""}</div>
                            </div>
                            <div className="flex gap-2">
                                {!thread.customer && (
                                    <Button size="sm" variant="outline" onClick={() => setNewPartyPhone(thread.phone)}>
                                        <UserPlus className="mr-1 size-4" /> Create party
                                    </Button>
                                )}
                                {thread.customer && (
                                    <Button size="sm" variant="outline" asChild>
                                        <a href={`/office/customers/all?${thread.customer.kind === "person" ? "personId" : "companyId"}=${thread.customer.id}`}>Party</a>
                                    </Button>
                                )}
                                <Button size="sm" variant="ghost" onClick={toggleSpam} title={thread.spam ? "Not spam" : "Mark this number spam"}>
                                    <ShieldAlert className="size-4" />
                                </Button>
                            </div>
                        </header>

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
                                                {out && <span>· {it.sentBy ?? "System"}</span>}
                                                {it.billKind && (
                                                    <span className="inline-flex items-center gap-0.5">
                                                        · <FileText className="size-3" />
                                                        {link ? <a href={link} target="_blank" rel="noreferrer" className="underline">{out ? "Bill" : "Reply to bill"}</a> : "Bill"}
                                                    </span>
                                                )}
                                                {it.ticketId && <span className="inline-flex items-center gap-0.5">· <Ticket className="size-3" />#{it.ticketId}</span>}
                                            </div>
                                            <div className="whitespace-pre-wrap break-words">{it.body}</div>
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

                        <footer className="border-t px-4 py-2">
                            {!canReply ? (
                                <p className="text-xs text-muted-foreground">You can read these messages. Replying needs the &ldquo;Reply to customer messages&rdquo; tick on your role.</p>
                            ) : thread.replyWindow.open ? (
                                <>
                                    <div className="flex items-end gap-2">
                                        <span className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground"><ChannelIcon channel="WHATSAPP" /> WhatsApp</span>
                                        <Textarea
                                            value={draft}
                                            onChange={(e) => setDraft(e.target.value)}
                                            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
                                            placeholder={`Reply to ${displayName(thread)}`}
                                            rows={1}
                                            className="min-h-9 resize-none"
                                        />
                                        <Button onClick={() => void send()} disabled={sending || !draft.trim()} size="icon" title="Send">
                                            <Send className="size-4" />
                                        </Button>
                                    </div>
                                    <p className="mt-1 text-[11px] text-muted-foreground">
                                        Free reply open for {hoursLeft(thread.replyWindow.closesAt)} h more. Enter sends, Shift+Enter adds a line.
                                    </p>
                                </>
                            ) : (
                                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                                    <Lock className="size-3.5" /> More than 24 hours since the customer last wrote. WhatsApp only allows an approved template now.
                                </p>
                            )}
                        </footer>
                    </>
                )}
            </section>

            <CreatePersonDialog
                open={newPartyPhone !== null}
                onOpenChange={(o) => { if (!o) { setNewPartyPhone(null); refresh(); } }}
                initialPhone={newPartyPhone ?? undefined}
            />
        </div>
    );
}
