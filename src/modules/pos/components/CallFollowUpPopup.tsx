"use client";

/**
 * CallFollowUpPopup — reminds whoever is at the counter to log a just-finished
 * call. Self-contained and universal: mounted once in the office layout and
 * once in the bare-chrome POS layout (same pattern as GlobalInboxListener),
 * not tied to any one screen.
 *
 * The epbx-bridge writes straight into `Call` (POST /api/calls) from the
 * counter PC's own process, not through this app's browser — so it can't ride
 * `attachChangePublisher`'s axios interceptor the way most writes do. Instead
 * `/api/calls`' POST handler publishes the "tickets" signal itself, server-side
 * (see `serverPublish.ts`), so the realtime subscription below is the real,
 * near-instant mechanism. Polling (`CALL_POPUP_POLL_MS`) is now just the
 * safety net for the rare missed publish.
 *
 * WHICH CALLS. No shift needs to be open — `useMyCounterExtension` resolves
 * this PC's counter from the bridge's device id, which stays bound long after
 * a shift closes. If it resolves to "no known extension" (bridge down, or
 * this PC was never bound to a counter) the popup does NOT stay silent — it
 * falls back to every unhandled call across every counter, on the theory
 * that a slow, unscoped reminder beats calls going unlogged just because
 * today's PC has no bridge.
 *
 * ONE PANEL, ONE MANDATORY NOTE. Earlier versions opened a separate dialog
 * per action and let an empty note through as "Done" — both cut against the
 * point. Now everything happens inline: tick an existing open ticket to link
 * to it, OR tick Help/Deal to spin up a new one from just the call's number
 * (no separate contact form — we already have the number), and either way
 * the note textarea IS the ticket's note / the call's note. A call with
 * genuinely nothing to say still gets one line ("wrong number") rather than
 * a silent skip. Ticking one of the three options is mutually exclusive with
 * the other two and jumps focus straight to the textarea for a fast type-and-
 * save. Save is disabled until that note is non-empty.
 *
 * MINIMIZE, NOT DISMISS. Escape / outside-click / the header's hide control
 * all do the same thing: collapse to a small floating button instead of
 * closing. While minimized the popup automatically re-expands after
 * `REMIND_MS` if anything is still pending — an honest "ask me later" rather
 * than a close that quietly drops the reminder. `minimized`/`remindAt` persist
 * to localStorage (not component state) because this component is mounted
 * separately in two different layouts (office vs POS) — crossing between
 * them unmounts one copy and mounts the other, and a plain in-memory flag
 * would forget it was minimized the moment that happens.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { PhoneIncoming, PhoneOutgoing, Ticket, HandCoins, Link2, ChevronDown, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { usePolling } from "@/shared/hooks/usePolling";
import { useRealtimeTopics } from "@/shared/hooks/useRealtimeTopics";
import { useMyCounterExtension } from "@/modules/pos/hooks/useMyCounterExtension";
import { CALL_POPUP_POLL_MS } from "@/shared/lib/constants/polling";
import { formatCallerNumber, formatDateTime } from "@/shared/lib/format";
import { extractApiError } from "@/shared/lib/api";

// A call this far back is stale by the time staff would see it (they were
// away, or the popup only just mounted on a fresh page load) — surfacing it
// would look like a phantom reminder for a conversation nobody remembers.
const LOOKBACK_MS = 20 * 60 * 1000;

// How long minimized holds before automatically re-expanding — "still
// pending, are you free now?" on a cadence, not a one-time snooze.
const REMIND_MS = 5 * 60 * 1000;

const STORAGE_KEY = "call-followup-popup:v1";

// Floating-button screen position — dragged once, remembered everywhere
// (same cross-layout-mount reasoning as minimized/remindAt below).
type Pos = { x: number; y: number };
type Persisted = { minimized: boolean; remindAt: number; pos: Pos | null };
function loadPersisted(): Persisted {
    if (typeof window === "undefined") return { minimized: false, remindAt: 0, pos: null };
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return { minimized: false, remindAt: 0, pos: null };
        const parsed = JSON.parse(raw) as Partial<Persisted>;
        const pos = parsed.pos && typeof parsed.pos.x === "number" && typeof parsed.pos.y === "number" ? parsed.pos : null;
        return { minimized: Boolean(parsed.minimized), remindAt: Number(parsed.remindAt) || 0, pos };
    } catch {
        return { minimized: false, remindAt: 0, pos: null };
    }
}
function savePersisted(next: Persisted) {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* private mode etc */ }
}

/** "just now" / "5m ago" / "1h ago" — the pending-calls picker's labels. */
function relativeLabel(iso: string): string {
    const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    return `${Math.round(minutes / 60)}h ago`;
}

type Direction = "INCOMING" | "OUTGOING" | "INTERNAL" | "UNKNOWN";
type PendingCall = {
    id: number;
    direction: Direction;
    rawNumber: string | null;
    occurredAt: string;
    customer: { kind: "person" | "company"; id: number; name: string } | null;
};

type LinkCandidate = { id: number; kind: "help" | "deal"; label: string; statusLabel: string | null };
type TicketLite = { id: number; subject?: string | null; title?: string | null; ticketStatus: { label: string } | null };

export default function CallFollowUpPopup() {
    const extension = useMyCounterExtension();

    const [queue, setQueue] = useState<PendingCall[]>([]);
    const [noteDraft, setNoteDraft] = useState("");
    const [busy, setBusy] = useState(false);
    const [linkCandidates, setLinkCandidates] = useState<LinkCandidate[]>([]);
    const [linkLoading, setLinkLoading] = useState(false);

    // Mutually exclusive: linking an existing ticket, creating a new help
    // ticket, creating a new deal, or (all three null) just a plain call note.
    const [selectedTicketId, setSelectedTicketId] = useState<number | null>(null);
    const [createAs, setCreateAs] = useState<"help" | "deal" | null>(null);

    const [minimized, setMinimized] = useState<boolean>(() => loadPersisted().minimized);
    const [pos, setPos] = useState<Pos | null>(() => loadPersisted().pos);
    // Refs, not state — read from the polling tick without becoming a
    // dependency of it (that would tear the timer down on every toggle).
    const minimizedRef = useRef(minimized);
    const remindAtRef = useRef(loadPersisted().remindAt);
    const posRef = useRef(pos);
    useEffect(() => { minimizedRef.current = minimized; }, [minimized]);
    useEffect(() => { posRef.current = pos; }, [pos]);

    const noteRef = useRef<HTMLTextAreaElement>(null);

    // Several calls can queue up (staff was away, or several came in back to
    // back) — which one is on screen is a pick, not just "oldest first".
    // Defaults to the most recent (queue is newest-first from the API); falls
    // back to that default the moment the picked one is resolved or expires.
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const current = queue.find((c) => c.id === selectedId) ?? queue[0] ?? null;

    const refresh = useCallback(async () => {
        if (extension === "unknown") return; // still resolving which counter this PC is
        try {
            // `extension === null` → no ext param → GET /api/calls falls back to
            // every counter's unhandled calls (see the module doc's WHICH CALLS).
            const params: Record<string, string> = { unhandled: "1", limit: "10" };
            if (extension) params.ext = extension;
            const { data } = await axios.get<{ items: PendingCall[] }>("/api/calls", { params });
            const cutoff = Date.now() - LOOKBACK_MS;
            setQueue(data.items.filter((c) => new Date(c.occurredAt).getTime() >= cutoff));

            // Piggyback the "is it time to nag again" check on the same tick
            // instead of a second timer.
            if (minimizedRef.current && Date.now() >= remindAtRef.current) {
                minimizedRef.current = false;
                setMinimized(false);
                savePersisted({ minimized: false, remindAt: 0, pos: posRef.current });
            }
        } catch { /* next tick tries again */ }
    }, [extension]);

    const pollEnabled = extension !== "unknown";
    usePolling(() => void refresh(), CALL_POPUP_POLL_MS, pollEnabled);
    useRealtimeTopics(["tickets"], () => void refresh(), pollEnabled);

    // Fresh call, fresh form state.
    useEffect(() => {
        setNoteDraft(""); setLinkCandidates([]); setSelectedTicketId(null); setCreateAs(null);
    }, [current?.id]);

    // Open tickets that could plausibly BE this caller — fetched eagerly so
    // the list can simply be empty instead of the staff opening onto a dead
    // end. Matches on the linked person/company AND on the ticket's own
    // phone field — see the module doc.
    useEffect(() => {
        if (!current) { setLinkCandidates([]); return; }
        const customer = current.customer;
        const phone = current.rawNumber;
        if (!customer && !phone) { setLinkCandidates([]); return; }
        let cancelled = false;
        setLinkLoading(true);
        const params: Record<string, string> = { open: "1" };
        if (customer?.kind === "person") params.personId = String(customer.id);
        if (customer?.kind === "company") params.companyId = String(customer.id);
        if (phone) params.phone = phone;
        (async () => {
            try {
                const [helpRes, dealRes] = await Promise.all([
                    axios.get<TicketLite[]>("/api/help", { params }),
                    axios.get<TicketLite[]>("/api/deals", { params }),
                ]);
                if (cancelled) return;
                const helps: LinkCandidate[] = helpRes.data.map((h) => ({ id: h.id, kind: "help", label: h.subject || "Help ticket", statusLabel: h.ticketStatus?.label ?? null }));
                const deals: LinkCandidate[] = dealRes.data.map((d) => ({ id: d.id, kind: "deal", label: d.title || "Deal", statusLabel: d.ticketStatus?.label ?? null }));
                setLinkCandidates([...helps, ...deals].slice(0, 6));
            } catch {
                if (!cancelled) setLinkCandidates([]);
            } finally {
                if (!cancelled) setLinkLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [current]);

    /** Remove the acted-on call from the queue — defaults back to the (new) most recent. */
    const advance = (id: number) => {
        setQueue((q) => q.filter((c) => c.id !== id));
        setSelectedId((cur) => (cur === id ? null : cur));
    };

    const focusNote = () => requestAnimationFrame(() => noteRef.current?.focus());

    const pickTicket = (id: number) => {
        setSelectedTicketId((cur) => (cur === id ? null : id));
        setCreateAs(null);
        focusNote();
    };
    const pickCreateAs = (kind: "help" | "deal") => {
        setCreateAs((cur) => (cur === kind ? null : kind));
        setSelectedTicketId(null);
        focusNote();
    };

    const hide = () => {
        const remindAt = Date.now() + REMIND_MS;
        remindAtRef.current = remindAt;
        setMinimized(true);
        savePersisted({ minimized: true, remindAt, pos });
    };
    const unhide = () => {
        remindAtRef.current = 0;
        setMinimized(false);
        savePersisted({ minimized: false, remindAt: 0, pos });
    };

    // Dragging the floating button — it defaults to the bottom-right corner
    // (plain CSS, no inline position) but can cover something on a busy
    // screen, so it's draggable once, remembered after via `pos`.
    const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number; moved: boolean; curX: number; curY: number } | null>(null);
    const onDragStart = (e: React.PointerEvent<HTMLButtonElement>) => {
        const rect = e.currentTarget.getBoundingClientRect();
        dragRef.current = { startX: e.clientX, startY: e.clientY, origX: rect.left, origY: rect.top, moved: false, curX: rect.left, curY: rect.top };
        e.currentTarget.setPointerCapture(e.pointerId);
    };
    const onDragMove = (e: React.PointerEvent<HTMLButtonElement>) => {
        const d = dragRef.current;
        if (!d) return;
        const dx = e.clientX - d.startX;
        const dy = e.clientY - d.startY;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) d.moved = true;
        if (!d.moved) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const x = Math.min(Math.max(0, d.origX + dx), window.innerWidth - rect.width);
        const y = Math.min(Math.max(0, d.origY + dy), window.innerHeight - rect.height);
        d.curX = x; d.curY = y;
        setPos({ x, y });
    };
    const onDragEnd = () => {
        const d = dragRef.current;
        dragRef.current = null;
        if (!d) return;
        if (d.moved) {
            // Was a drag, not a click — persist where it landed, don't un-minimize.
            savePersisted({ minimized: true, remindAt: remindAtRef.current, pos: { x: d.curX, y: d.curY } });
        } else {
            unhide();
        }
    };

    const phoneDisplay = current ? formatCallerNumber(current.rawNumber, current.direction) : "";

    const save = async () => {
        if (!current) return;
        const note = noteDraft.trim();
        if (!note) return;
        setBusy(true);
        try {
            if (selectedTicketId != null) {
                await axios.post(`/api/tickets/${selectedTicketId}/notes`, { note });
                await axios.patch(`/api/calls/${current.id}`, { ticketId: selectedTicketId });
                toast.success("Linked to ticket");
            } else if (createAs === "help") {
                const contactName = current.customer?.name ?? phoneDisplay;
                const { data } = await axios.post<{ id: number }>("/api/help", {
                    contactName,
                    phone: current.rawNumber || undefined,
                    personId: current.customer?.kind === "person" ? current.customer.id : undefined,
                    companyId: current.customer?.kind === "company" ? current.customer.id : undefined,
                    subject: note.slice(0, 300),
                    notes: note,
                });
                await axios.patch(`/api/calls/${current.id}`, { ticketId: data.id });
                toast.success("Help ticket created");
            } else if (createAs === "deal") {
                const contactName = current.customer?.name ?? phoneDisplay;
                const { data } = await axios.post<{ id: number }>("/api/deals", {
                    contactName,
                    phone: current.rawNumber || undefined,
                    personId: current.customer?.kind === "person" ? current.customer.id : undefined,
                    companyId: current.customer?.kind === "company" ? current.customer.id : undefined,
                    title: note.slice(0, 300),
                    source: "Phone",
                    notes: note,
                });
                await axios.patch(`/api/calls/${current.id}`, { ticketId: data.id });
                toast.success("Deal created");
            } else {
                await axios.patch(`/api/calls/${current.id}`, { note });
                toast.success("Note saved");
            }
            advance(current.id);
        } catch (err) {
            toast.error(extractApiError(err, "Failed to save"));
        } finally {
            setBusy(false);
        }
    };

    const saveLabel = selectedTicketId != null
        ? "Link & save"
        : createAs === "help"
            ? "Create help ticket"
            : createAs === "deal"
                ? "Create deal"
                : "Save note";

    return (
        <>
            {queue.length > 0 && minimized && (
                <button
                    type="button"
                    onPointerDown={onDragStart}
                    onPointerMove={onDragMove}
                    onPointerUp={onDragEnd}
                    style={pos ? { left: pos.x, top: pos.y, right: "auto", bottom: "auto" } : undefined}
                    className="fixed bottom-4 right-4 z-50 flex touch-none items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-lg transition hover:opacity-90"
                >
                    <PhoneIncoming size={15} />
                    {queue.length} call{queue.length > 1 ? "s" : ""} to log
                </button>
            )}

            {/* Escape / outside-click minimize instead of closing — see the module doc. */}
            <Dialog open={Boolean(current) && !minimized} onOpenChange={(open) => { if (!open) hide(); }}>
                <DialogContent className="sm:max-w-sm" showCloseButton={false}>
                    {current && (
                        <>
                            <DialogHeader>
                                <div className="flex items-start justify-between gap-2">
                                    <DialogTitle className="flex items-center gap-2">
                                        {current.direction === "OUTGOING"
                                            ? <PhoneOutgoing size={16} className="text-sky-600" />
                                            : <PhoneIncoming size={16} className="text-emerald-600" />}
                                        Log this call
                                    </DialogTitle>
                                    <Button variant="ghost" size="sm" className="h-6 px-2 text-xs text-muted-foreground" onClick={hide} title="Minimize — keeps reminding until logged">
                                        <ChevronDown size={13} /> Hide
                                    </Button>
                                </div>
                                <DialogDescription>
                                    {phoneDisplay}
                                    {current.customer ? ` — ${current.customer.name}` : ""}
                                    {" · "}{formatDateTime(current.occurredAt)}
                                </DialogDescription>
                            </DialogHeader>

                            {/* Which pending call is on screen — several can queue up
                                (staff was away, or a few came in back to back). Picking
                                one doesn't drop the others; it just changes what's shown. */}
                            {queue.length > 1 && (
                                <div className="-mt-1 flex flex-wrap gap-1.5">
                                    {queue.map((c) => (
                                        <button
                                            key={c.id}
                                            type="button"
                                            onClick={() => setSelectedId(c.id)}
                                            className={`rounded-full border px-2.5 py-1 text-xs transition ${c.id === current.id ? "border-primary bg-primary/10 font-medium" : "border-muted-foreground/30 text-muted-foreground hover:bg-muted"}`}
                                        >
                                            {c.customer ? c.customer.name : formatCallerNumber(c.rawNumber, c.direction)} · {relativeLabel(c.occurredAt)}
                                        </button>
                                    ))}
                                </div>
                            )}

                            <div className="space-y-2">
                                {linkCandidates.length > 0 && (
                                    <div className="space-y-1.5">
                                        <p className="text-xs font-medium text-muted-foreground">Already has an open ticket — link instead?</p>
                                        {linkCandidates.map((c) => {
                                            const picked = selectedTicketId === c.id;
                                            return (
                                                <button
                                                    key={`${c.kind}-${c.id}`}
                                                    type="button"
                                                    disabled={busy}
                                                    onClick={() => pickTicket(c.id)}
                                                    className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition disabled:opacity-50 ${picked ? "border-primary bg-primary/10" : "hover:bg-muted"}`}
                                                >
                                                    <span className="flex min-w-0 items-center gap-2">
                                                        <span className={`flex size-4 shrink-0 items-center justify-center rounded-sm border ${picked ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40"}`}>
                                                            {picked && <Check size={11} />}
                                                        </span>
                                                        <span className="truncate">
                                                            <span className="text-xs uppercase text-muted-foreground">{c.kind === "help" ? "Help" : "Deal"}</span>{" "}
                                                            {c.label}
                                                        </span>
                                                    </span>
                                                    {c.statusLabel && <span className="ml-2 shrink-0 text-xs text-muted-foreground">{c.statusLabel}</span>}
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                                {linkLoading && (
                                    <p className="text-xs text-muted-foreground">Checking for open tickets…</p>
                                )}

                                <div className="grid grid-cols-2 gap-2">
                                    <Button
                                        variant={createAs === "help" ? "default" : "outline"}
                                        onClick={() => pickCreateAs("help")}
                                        disabled={busy || selectedTicketId != null}
                                    >
                                        <Ticket size={15} /> Help ticket
                                    </Button>
                                    <Button
                                        variant={createAs === "deal" ? "default" : "outline"}
                                        onClick={() => pickCreateAs("deal")}
                                        disabled={busy || selectedTicketId != null}
                                    >
                                        <HandCoins size={15} /> Deal
                                    </Button>
                                </div>

                                <Textarea
                                    ref={noteRef}
                                    value={noteDraft}
                                    onChange={(e) => setNoteDraft(e.target.value)}
                                    placeholder={
                                        selectedTicketId != null ? "Follow-up note for this ticket…"
                                            : createAs ? "What does the customer need?"
                                                : "What was this call about?"
                                    }
                                    rows={3}
                                />
                            </div>

                            <DialogFooter>
                                <Button onClick={() => void save()} disabled={busy || !noteDraft.trim()} className="w-full">
                                    {busy ? "Saving…" : (
                                        <>{selectedTicketId != null && <Link2 size={15} />} {saveLabel}</>
                                    )}
                                </Button>
                            </DialogFooter>
                        </>
                    )}
                </DialogContent>
            </Dialog>
        </>
    );
}
