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
 * a shift closes. A counter sees the calls on its own extension(s) at once.
 * Every other call reaches it too, on two rules (server side, `forCounter=1`,
 * see `counterPopupScope`): a call that belongs to NO counter — no extension
 * at all (an unanswered incoming call records none) or one no counter is set
 * to (a spare handset, Ext 45) — shows everywhere at once; another counter's
 * call shows everywhere once it has waited `CALL_POPUP_PUBLIC_AFTER_MS`
 * unlogged. A PC with no known extension (bridge down, or never bound) has no
 * calls of its own and gets just those two. The line under the title names
 * the extension (or trunk), so staff can tell whose call it was.
 *
 * A MISSED CALL IS LOCKED. Under `MISSED_CALL_UNDER_SEC` of talk nobody has
 * spoken to the caller, so there is nothing to note — only a call back. The
 * panel shows no note, ticket or save for it, only that line, and its chip is
 * red. It closes by itself when someone really talks to the caller (that call
 * joins the same chip as its newest call and unlocks it, and the one save
 * covers the miss too), or when the customer turns up at the shop — a bill or
 * a ticket for them after the miss (`customerSeenSince`). In an emergency a
 * note on the CRM Call Log closes it. It still drops off after
 * `CALL_POPUP_MAX_AGE_MS` like any other call.
 *
 * ONE CALLER, ONE ENTRY. A customer who rings five times has one thing to say,
 * not five, so pending calls fold together by their normalised number: one chip,
 * one panel, and the single save writes the note or ticket onto every call in
 * that group (`alsoIds` on PATCH /api/calls/[id]). The floating icon counts
 * CALLERS for the same reason — it is the number of people still waiting, which
 * is what the counter can actually act on.
 *
 * A CALL THE COUNTER CANNOT ACT ON IS NOT A REMINDER. Only a COMPLETE Indian or
 * international number appears here (`isCallableNumber`). Two captures fail that
 * test: a short trunk CLI (`38446`, seen live) and a part number — the EPBX
 * sends an incoming CLI digit by digit, so answering before the last digit lands
 * records only what had arrived (`91600204286`, nine of India's ten digits).
 * Neither can be rung back or matched to a contact. Those calls are real — one
 * ran 38 seconds of speech — and they keep their row on the CRM Call Log, where
 * a part number is marked as one and carries a near-match to verify; but there
 * is nothing the counter can do with the reminder, so it drops off.
 *
 * AND ONE ANSWER CLOSES WHAT CAME BEFORE IT. The server (`sinceLastLogged=1`)
 * drops a number's calls that are older than that number's most recent logged
 * call: staff answered then, so those rings were part of it. Only a logged CALL
 * moves that line — an open help ticket does NOT silence the customer's future
 * calls, because they ring again precisely when something is still wrong. The
 * comparison is against the calls' own times, never when the note was typed, so
 * a note written late in the day cannot swallow the calls that came in between.
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
 * THE ICON WAITS UNTIL ZERO. Escape / outside-click / the header's hide
 * control all do the same thing: collapse to a small floating button instead
 * of closing. That button is on screen for as long as ANY call is still
 * unlogged — it is the resting state of this feature, not a temporary
 * snooze, and it only disappears when the count reaches zero. The panel
 * itself opens by itself in two cases: a call that was not in the queue on
 * the previous tick has just arrived, and every `CALL_POPUP_REMIND_MS` as a
 * scheduled "these are still waiting" nudge. A call older than
 * `CALL_POPUP_MAX_AGE_MS` drops off the icon — the row is untouched and
 * still on the CRM Call Log, it just stops being a counter reminder.
 * HOW A SAVE STAYS SAVED. A save is two writes (the ticket/deal, then the
 * PATCH that marks the call handled) and the first of them publishes the
 * realtime signal that triggers a refresh — so a refresh can read the call as
 * still unhandled and push it back on screen a moment after staff logged it.
 * On a till the gap is wider still: the PATCH is relayed to the office and has
 * to come back down through the replica. `handledIdsRef` holds the just-logged
 * ids out of the queue until a refresh confirms the data caught up.
 *
 * It EXPIRES rather than hiding for ever. Past `CALL_POPUP_HANDLED_TTL_MS` the
 * call comes back on screen carrying a line saying staff logged it and this
 * counter has not received it. Both silences it could have kept are worse:
 * hiding for ever buries a save that never landed (the 2026-09-13 sync bug did
 * exactly that — `Call` synced as `append`, so an edit never came down), and
 * coming back unannounced invites a second ticket for the same call.
 *
 * `minimized`/`remindAt`/`pos` and the handled set persist to localStorage (not
 * component state) because this component is mounted separately in two different
 * layouts (office vs POS) — crossing between them unmounts one copy and mounts
 * the other, and a plain in-memory value would forget the moment that happens.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChatDrawerOpen } from "@/modules/message/lib/chatDrawer";
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
import { CALL_POPUP_POLL_MS, CALL_POPUP_MAX_AGE_MS, CALL_POPUP_REMIND_MS, CALL_POPUP_HANDLED_TTL_MS } from "@/shared/lib/constants/polling";
import { formatCallerNumber, formatDateTime, isCallableNumber } from "@/shared/lib/format";
import { extractApiError } from "@/shared/lib/api";

/** Tables GET /api/calls reads — the replica wake-up filter below. User (staff
 *  names only) is left out: a rename shows at the next CALL_POPUP_POLL_MS tick. */
const CALL_POPUP_MODELS = [
    "Call", "Phone", "Person", "Company", "PosCounter", "Account", "UniversalVoucher",
    "Ticket", "TicketLog", "Message", "MessageConversation", "MessageClaim",
] as const;

const STORAGE_KEY = "call-followup-popup:v1";

// Floating-button screen position — dragged once, remembered everywhere
// (same cross-layout-mount reasoning as minimized/remindAt below).
type Pos = { x: number; y: number };
// `handled` is call id -> when staff saved it (epoch ms). It has to outlive a
// remount for the same reason `minimized` does — this component is mounted in
// both the office and POS layouts, and crossing between them unmounts one copy
// and mounts the other. See HOW A SAVE STAYS SAVED in the module doc.
type Persisted = { minimized: boolean; remindAt: number; pos: Pos | null; handled: Record<string, number> };
const EMPTY: Persisted = { minimized: false, remindAt: 0, pos: null, handled: {} };
function loadPersisted(): Persisted {
    if (typeof window === "undefined") return EMPTY;
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return EMPTY;
        const parsed = JSON.parse(raw) as Partial<Persisted>;
        const pos = parsed.pos && typeof parsed.pos.x === "number" && typeof parsed.pos.y === "number" ? parsed.pos : null;
        const handled = parsed.handled && typeof parsed.handled === "object" ? parsed.handled : {};
        return { minimized: Boolean(parsed.minimized), remindAt: Number(parsed.remindAt) || 0, pos, handled };
    } catch {
        return EMPTY;
    }
}
// Merge, not replace: the four callers each own one field, and a whole-object
// write from any of them would drop whatever the others had just stored.
function savePersisted(patch: Partial<Persisted>) {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...loadPersisted(), ...patch })); } catch { /* private mode etc */ }
}

/**
 * The saved-just-now set, read back from localStorage and pruned on the way in.
 *
 * Anything older than the icon's own age window is dropped outright — the call
 * has left the icon by then, so remembering it buys nothing — and the newest 50
 * are kept, which is the page size the popup asks for anyway.
 */
function loadHandled(): Map<number, number> {
    const cutoff = Date.now() - CALL_POPUP_MAX_AGE_MS;
    return new Map(
        Object.entries(loadPersisted().handled)
            .map(([id, at]) => [Number(id), Number(at)] as [number, number])
            .filter(([id, at]) => Number.isFinite(id) && at >= cutoff)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 50),
    );
}
function saveHandled(map: Map<number, number>) {
    savePersisted({ handled: Object.fromEntries([...map].map(([id, at]) => [String(id), at])) });
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
    /** Normalised match key — the grouping key, and what resolves the customer. */
    phone: string | null;
    rawNumber: string | null;
    occurredAt: string;
    customer: { kind: "person" | "company"; id: number; name: string } | null;
    fromExt: string | null;
    toExt: string | null;
    trunk: string | null;
    /** Under MISSED_CALL_UNDER_SEC of talk — needs a call back, see the module doc. */
    missed: boolean;
};

/** Which extension took the call — the popup can open on another counter, so
 *  staff need to see whose call it was. Trunk when the exchange sent no ext. */
function callExtLabel(c: PendingCall): string | null {
    const ext = c.direction === "OUTGOING" ? c.fromExt : c.toExt;
    return ext ? `Ext ${ext}` : c.trunk;
}

/** One caller's pending calls. `latest` is what the panel shows and saves from. */
type Group = { key: string; calls: PendingCall[]; latest: PendingCall };

/**
 * Pending calls folded into one entry per caller.
 *
 * `queue` arrives newest-first, so each group's first element is its latest call
 * — the one the panel puts in the header and the one the save writes from.
 * Calls with no normalised key never reach here — `refresh` drops them, because
 * a number too short to key can never be matched to a contact or rung back.
 */
function groupByCaller(calls: PendingCall[]): Group[] {
    const byKey = new Map<string, PendingCall[]>();
    for (const c of calls) {
        const key = c.phone ?? `call:${c.id}`; // defensive — refresh already filtered these out
        const list = byKey.get(key);
        if (list) list.push(c);
        else byKey.set(key, [c]);
    }
    return [...byKey].map(([key, list]) => ({ key, calls: list, latest: list[0] }));
}

type LinkCandidate = { id: number; kind: "help" | "deal"; label: string; statusLabel: string | null };
type TicketLite = { id: number; subject?: string | null; title?: string | null; ticketStatus: { label: string } | null };

export default function CallFollowUpPopup() {
    const extension = useMyCounterExtension();

    const chatDrawerOpen = useChatDrawerOpen();
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
    // Call ids the previous refresh saw — null until the first one lands, so
    // the opening backlog is seeded rather than treated as newly arrived.
    const seenIdsRef = useRef<Set<number> | null>(null);
    // Calls this counter has just logged, and when. A save writes the ticket/deal
    // first, and that write publishes the "tickets" realtime signal — which fires
    // a refresh while the follow-up PATCH that actually marks the call handled is
    // still in flight (and, on a till, before the relay's write has come back down
    // through the replica). That in-flight read still says "unhandled" and would
    // put the just-logged call straight back on screen. Holding the id here keeps
    // it off the queue until the data agrees — and the moment a refresh no longer
    // returns it, the id is dropped.
    //
    // Persisted, unlike the other refs: a reload or a crossing between the office
    // and POS layouts remounts this component and would otherwise empty the set
    // mid-race. And it times out rather than hiding for ever — see `staleHandled`.
    const handledIdsRef = useRef<Map<number, number>>(new Map());
    useEffect(() => { handledIdsRef.current = loadHandled(); }, []);
    // Ids the guard has held longer than it should: staff logged them, the server
    // still disagrees. These are NOT hidden — they come back with a warning line.
    const [staleHandled, setStaleHandled] = useState<Set<number>>(new Set());
    /** More pending than one page — the icon says "50+" rather than lying. */
    const [morePending, setMorePending] = useState(false);
    // Refresh responses can come back out of order (poll tick vs realtime tick).
    // Only the newest one is allowed to set the queue.
    const refreshSeqRef = useRef(0);
    const posRef = useRef(pos);
    useEffect(() => { minimizedRef.current = minimized; }, [minimized]);
    useEffect(() => { posRef.current = pos; }, [pos]);

    const noteRef = useRef<HTMLTextAreaElement>(null);

    // Several CALLERS can queue up (staff was away, or a few rang back to
    // back) — which one is on screen is a pick, not just "oldest first".
    // Defaults to the most recent (queue is newest-first from the API); falls
    // back to that default the moment the picked one is resolved or expires.
    const [selectedKey, setSelectedKey] = useState<string | null>(null);
    const groups = useMemo(() => groupByCaller(queue), [queue]);
    const current = groups.find((g) => g.key === selectedKey) ?? groups[0] ?? null;
    /** The call the panel shows and saves from — its caller's most recent. */
    const call = current?.latest ?? null;

    const refresh = useCallback(async () => {
        if (extension === "unknown") return; // still resolving which counter this PC is
        try {
            // `forCounter` scopes to this counter's own calls plus the ones that
            // are nobody's or have waited too long; `extension === null` sends no
            // ext, so only the latter (see the module doc's WHICH CALLS).
            // The window is days now, not minutes, so ask for more than a
            // screenful — the icon's count has to be the honest total.
            // `sinceLastLogged` drops calls from a number that came BEFORE that
            // number's most recent logged call — staff already answered those.
            // The CRM Call Log never sends it; nothing may be hidden there.
            const params: Record<string, string> = { unhandled: "1", sinceLastLogged: "1", forCounter: "1", limit: "50" };
            if (extension) params.ext = extension;
            const seq = ++refreshSeqRef.current;
            const { data } = await axios.get<{ items: PendingCall[]; pagination?: { total: number } }>("/api/calls", { params });
            if (seq !== refreshSeqRef.current) return; // a newer refresh already answered
            const cutoff = Date.now() - CALL_POPUP_MAX_AGE_MS;
            // Two display rules, both of them about whether a reminder can lead
            // anywhere. Old calls drop off (CALL_POPUP_MAX_AGE_MS). So does any
            // call whose number is not a COMPLETE Indian or international
            // number — that is this popup's law, not a side effect of a helper.
            // A five-digit trunk CLI, or a CLI the handset cut off mid-arrival
            // (the EPBX sends the digits one by one), cannot be rung back and
            // cannot identify anyone. Such calls stay on the CRM Call Log for
            // the audit, marked "part number" with a near-match to verify; here
            // they just stop nagging.
            // A part number staff have COMPLETED on the Call Log resolves to a
            // customer and can be rung back, so it belongs here again; a stale
            // junk key from before the shape rule resolves to nobody and stays out.
            const fresh = data.items.filter(
                (c) =>
                    c.phone !== null
                    && (isCallableNumber(c.rawNumber, c.direction) || c.customer !== null)
                    && new Date(c.occurredAt).getTime() >= cutoff,
            );

            // The server has stopped calling it unhandled — the data is now
            // correct, so release the guard for that call.
            const serverIds = new Set(data.items.map((c) => c.id));
            let released = false;
            for (const id of handledIdsRef.current.keys()) {
                if (!serverIds.has(id)) { handledIdsRef.current.delete(id); released = true; }
            }
            if (released) saveHandled(handledIdsRef.current);

            // A held id splits in two by age. Inside the TTL it stays hidden —
            // that is the race guard doing its job. Past it, the save is not
            // arriving and silence would be a lie: the call goes back on screen
            // flagged, so staff can check the Call Log instead of raising a
            // second ticket for the same call.
            const staleAfter = Date.now() - CALL_POPUP_HANDLED_TTL_MS;
            const stale = new Set<number>();
            const visible = fresh.filter((c) => {
                const at = handledIdsRef.current.get(c.id);
                if (at === undefined) return true;
                if (at >= staleAfter) return false;
                stale.add(c.id);
                return true;
            });
            setStaleHandled(stale);
            setQueue(visible);
            // The count has to be honest, and neither number alone is. `total` counts
            // every unhandled call the server knows of, including ones older than the
            // icon's own age window — calls it has deliberately decided not to show.
            // `items` is capped at the page size. So: exact whenever the page reached
            // the stale zone (fewer fresh rows than rows returned), and "50+" only when
            // a full page of fresh rows sits in front of a bigger total.
            setMorePending(
                fresh.length === data.items.length
                && data.items.length >= 50
                && (data.pagination?.total ?? 0) > data.items.length,
            );

            // A call the previous tick had not seen is a call that just
            // happened — open the panel for it. The very first tick only
            // seeds the set: the backlog already waiting when this PC
            // opened the app is not "new", and the scheduled nudge below
            // will raise it soon enough.
            const seen = seenIdsRef.current;
            const isNew = seen !== null && visible.some((c) => !seen.has(c.id));
            seenIdsRef.current = new Set(visible.map((c) => c.id));

            // Piggyback the "is it time to nudge again" check on the same
            // tick instead of a second timer.
            const due = Date.now() >= remindAtRef.current;
            if (minimizedRef.current && visible.length > 0 && (isNew || due)) {
                minimizedRef.current = false;
                setMinimized(false);
                savePersisted({ minimized: false, remindAt: 0, pos: posRef.current });
            }
        } catch { /* next tick tries again */ }
    }, [extension]);

    const pollEnabled = extension !== "unknown";
    usePolling(() => void refresh(), CALL_POPUP_POLL_MS, pollEnabled);
    // A WhatsApp reply to the caller answers their calls too (lastContactByPhone).
    // On a replica PC the local half wakes on ANY table's sync cycle unless told
    // which ones matter — that re-read /api/calls about once a second (2026-10-19).
    // These are the tables GET /api/calls reads (route, followUp.ts, customerMessages.ts).
    useRealtimeTopics(["tickets", "messages"], () => void refresh(), pollEnabled, CALL_POPUP_MODELS);

    // Fresh call, fresh form state.
    useEffect(() => {
        setNoteDraft(""); setLinkCandidates([]); setSelectedTicketId(null); setCreateAs(null);
    }, [call?.id]);

    // Open tickets that could plausibly BE this caller — fetched eagerly so
    // the list can simply be empty instead of the staff opening onto a dead
    // end. Matches on the linked person/company AND on the ticket's own
    // phone field — see the module doc.
    useEffect(() => {
        // A missed call is locked (no ticket to link) — skip the read.
        if (!call || call.missed) { setLinkCandidates([]); return; }
        const customer = call.customer;
        const phone = call.rawNumber;
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
    }, [call]);

    /**
     * Take the whole caller off the queue — one save answers every call they made,
     * so every one of their ids goes into the just-logged guard, not only the
     * newest. Defaults back to the (new) most recent caller.
     */
    const advance = (group: Group) => {
        const now = Date.now();
        const ids = new Set(group.calls.map((c) => c.id));
        for (const id of ids) handledIdsRef.current.set(id, now);
        saveHandled(handledIdsRef.current);
        setQueue((q) => q.filter((c) => !ids.has(c.id)));
        setSelectedKey((cur) => (cur === group.key ? null : cur));
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
        const remindAt = Date.now() + CALL_POPUP_REMIND_MS;
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

    const phoneDisplay = call ? formatCallerNumber(call.rawNumber, call.direction) : "";
    /** When staff saved this call — only read for ids the TTL has flagged stale. */
    const handledAt = (id: number) => handledIdsRef.current.get(id) ?? Date.now();

    const save = async () => {
        if (!current || !call) return;
        // Every call this caller made, answered by this one note — see `advance`.
        const alsoIds = current.calls.map((c) => c.id).filter((cid) => cid !== call.id);
        const note = noteDraft.trim();
        if (!note) return;
        setBusy(true);
        try {
            if (selectedTicketId != null) {
                await axios.post(`/api/tickets/${selectedTicketId}/notes`, { note });
                await axios.patch(`/api/calls/${call.id}`, { ticketId: selectedTicketId, alsoIds });
                toast.success("Linked to ticket");
            } else if (createAs === "help") {
                const contactName = call.customer?.name ?? phoneDisplay;
                const { data } = await axios.post<{ id: number }>("/api/help", {
                    contactName,
                    phone: call.rawNumber || undefined,
                    personId: call.customer?.kind === "person" ? call.customer.id : undefined,
                    companyId: call.customer?.kind === "company" ? call.customer.id : undefined,
                    subject: note.slice(0, 300),
                    notes: note,
                });
                await axios.patch(`/api/calls/${call.id}`, { ticketId: data.id, alsoIds });
                toast.success("Help ticket created");
            } else if (createAs === "deal") {
                const contactName = call.customer?.name ?? phoneDisplay;
                const { data } = await axios.post<{ id: number }>("/api/deals", {
                    contactName,
                    phone: call.rawNumber || undefined,
                    personId: call.customer?.kind === "person" ? call.customer.id : undefined,
                    companyId: call.customer?.kind === "company" ? call.customer.id : undefined,
                    title: note.slice(0, 300),
                    source: "Phone",
                    notes: note,
                });
                await axios.patch(`/api/calls/${call.id}`, { ticketId: data.id, alsoIds });
                toast.success("Deal created");
            } else {
                await axios.patch(`/api/calls/${call.id}`, { note, alsoIds });
                toast.success("Note saved");
            }
            advance(current);
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

    // The panel is up only when it has a call to show AND staff has not
    // parked it; the icon fills every other moment the queue is not empty.
    const panelOpen = Boolean(current) && !minimized;
    // The POS Messages drawer covers this corner — the bubble waits behind it.

    return (
        <>
            {groups.length > 0 && !panelOpen && !chatDrawerOpen && (
                <button
                    type="button"
                    onPointerDown={onDragStart}
                    onPointerMove={onDragMove}
                    onPointerUp={onDragEnd}
                    style={pos ? { left: pos.x, top: pos.y, right: "auto", bottom: "auto" } : undefined}
                    // A round bubble like the WhatsApp one, parked just left of it.
                    className="fixed bottom-4 right-20 z-50 flex size-12 touch-none items-center justify-center rounded-full bg-sky-600 text-white shadow-lg ring-4 ring-sky-600/25 transition hover:bg-sky-700"
                    title={`${groups.length}${morePending ? "+" : ""} call${groups.length > 1 ? "s" : ""} to log — click to open, drag to move`}
                    aria-label={`${groups.length} calls to log`}
                >
                    <span className="absolute inset-0 animate-ping rounded-full bg-sky-500/30" />
                    <PhoneIncoming size={22} className="relative" />
                    <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-red-600 px-1 text-center text-[11px] font-semibold leading-5">
                        {groups.length}{morePending ? "+" : ""}
                    </span>
                </button>
            )}

            {/* Escape / outside-click minimize instead of closing — see the module doc. */}
            <Dialog open={panelOpen} onOpenChange={(open) => { if (!open) hide(); }}>
                <DialogContent className="sm:max-w-sm" showCloseButton={false}>
                    {current && call && (
                        <>
                            <DialogHeader>
                                <div className="flex items-start justify-between gap-2">
                                    <DialogTitle className="flex items-center gap-2">
                                        {call.direction === "OUTGOING"
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
                                    {call.customer ? ` — ${call.customer.name}` : ""}
                                    {" · "}{formatDateTime(call.occurredAt)}
                                    {callExtLabel(call) ? ` · ${callExtLabel(call)}` : ""}
                                </DialogDescription>
                            </DialogHeader>

                            {/* Staff logged this one, and the counter still has not
                                been told. Saying so beats both alternatives: hiding it
                                for ever would bury a save that never landed, and
                                showing it plainly invites a second ticket for the same
                                call. See the module doc's HOW A SAVE STAYS SAVED. */}
                            {current.calls.some((c) => staleHandled.has(c.id)) && (
                                <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-xs text-amber-900 dark:text-amber-200">
                                    You logged this {relativeLabel(new Date(handledAt(call.id)).toISOString())} and this counter
                                    has not received it yet. Check the Call Log before raising another ticket.
                                </p>
                            )}

                            {/* This caller rang more than once and nobody has logged
                                any of it. Those calls are one thing to answer, not
                                several — the save below covers every one of them —
                                but the times still matter: four rings in ten minutes
                                reads very differently from four over two days. */}
                            {current.calls.length > 1 && (
                                <p className="text-xs text-muted-foreground">
                                    Rang {current.calls.length} times — also{" "}
                                    {current.calls.slice(1).map((c) => relativeLabel(c.occurredAt)).join(", ")}.
                                    One note covers them all.
                                </p>
                            )}

                            {/* Which pending caller is on screen — several can queue up
                                (staff was away, or a few came in back to back). Picking
                                one doesn't drop the others; it just changes what's shown. */}
                            {groups.length > 1 && (
                                <div className="-mt-1 flex flex-wrap gap-1.5">
                                    {groups.map((g) => (
                                        <button
                                            key={g.key}
                                            type="button"
                                            onClick={() => setSelectedKey(g.key)}
                                            className={`rounded-full border px-2.5 py-1 text-xs transition ${g.key === current.key ? "bg-primary/10 font-medium" : "hover:bg-muted"} ${g.latest.missed ? "border-destructive/60 text-destructive" : g.key === current.key ? "border-primary" : "border-muted-foreground/30 text-muted-foreground"}`}
                                        >
                                            {g.latest.customer ? g.latest.customer.name : formatCallerNumber(g.latest.rawNumber, g.latest.direction)}
                                            {g.calls.length > 1 ? ` ×${g.calls.length}` : ""} · {relativeLabel(g.latest.occurredAt)}
                                        </button>
                                    ))}
                                </div>
                            )}

                            {/* A missed call is LOCKED: nobody has talked to this caller,
                                so there is nothing to note — only a call back. It closes
                                by itself once someone really talks to them (the new call
                                joins this chip and unlocks it) or they turn up at the shop;
                                in an emergency, a note on the CRM Call Log closes it. */}
                            {call.missed ? (
                                <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                                    Missed call — call back to the caller. Closes once you talk to them or they visit.
                                </p>
                            ) : (
                                <>
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
                        </>
                    )}
                </DialogContent>
            </Dialog>
        </>
    );
}
