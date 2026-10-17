"use client";

/**
 * MessageAlertPopup — a customer's WhatsApp message pops up on whatever screen
 * staff are on, and is ANSWERED FROM THE POPUP, like a call is logged from the
 * call popup. Mounted once in the office layout and once in the POS layout (as
 * CallFollowUpPopup), so it is never tied to the Messages screen — which stays
 * open to everyone with the page, as before.
 *
 * WHO SEES WHICH CHAT (MessageClaim):
 *  - nobody in the conversation yet → everyone who may open CRM → Messages;
 *  - once someone has replied → only the people in it: the first to reply
 *    (owner), anyone else who replied, and anyone invited. "Ask the accountant
 *    about the bill" is an Invite (or Hand over) right on the card;
 *  - …until a message has waited MESSAGE_CLAIM_FALLBACK_MS unanswered, then
 *    everyone again — nobody can sit on a customer.
 *
 * @MENTION PASSES IT ON. "@Naba what time can they collect?" is a STAFF NOTE,
 * never sent to the customer: Naba becomes the one handling the chat, sees the
 * note on his popup, and the writer steps out — no more popups for them on this
 * customer until someone mentions them back.
 *
 * A MESSAGE WAITS LIKE A CALL. A customer's message stays on screen — no ✕,
 * only minimise — until the shop gets back to them: a reply, a Help/Deal ticket
 * raised from the card, a call logged, an activity on them in CRM → Reconnect,
 * or a visit (bill or ticket). Any of these answers their waiting calls too;
 * the server works it out (lastContactByPhone). Opening the chat is not an
 * answer. The card counts down WhatsApp's 24-hour reply window; past it the
 * reply box locks and asks staff to call — the card still waits for that call.
 *
 * AN ANSWERED CARD STAYS for the people in the chat, so they can watch for the
 * customer's next message; now the ✕ is offered, and closes it until the
 * customer writes again.
 *
 * COST. One read of /api/messages/alerts per realtime "messages" signal, none on
 * a timer: the answer carries every chat with its claim, and the 10-minute
 * hand-back is worked out here against a local clock.
 *
 * MINIMISE + MOVE. The – button folds the cards into a green chat bubble with
 * the waiting count; new messages still chime and notify but do not unfold it.
 * Each card drags on its own by its header, out of the stack, and keeps that
 * spot while its chat waits; double-click puts it back in the stack (and, on
 * a stacked card, sends the stack home to the bottom-right). The bubble drags
 * too. Spots and the folded state are remembered on this computer.
 *
 * Hidden on the Messages screen itself, which already shows all of this.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import axios from "axios";
import { toast } from "sonner";
import { MessageCircle, X, Send, Users, ArrowRightLeft, ExternalLink, Minus, Ticket, HandCoins, PhoneCall } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRealtimeTopics } from "@/shared/hooks/useRealtimeTopics";
import { canOpenPage } from "@/shared/lib/auth/pageAccess";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { MESSAGE_CLAIM_FALLBACK_MS, MESSAGE_REPLY_WINDOW_MS } from "@/shared/lib/constants/polling";
import { extractApiError } from "@/shared/lib/api";
import StaffPickerDialog, { type PickMode, type Staff } from "./StaffPickerDialog";
import MentionTextarea, { mentionTargets } from "./MentionTextarea";
import { requestOpenChat, useChatDrawerOpen } from "../lib/chatDrawer";
import { MessageMedia, captionOf, type MediaInfo } from "@/modules/crm/components/MessageMedia";

const MESSAGES_HREF = "/office/crm/messages";
const DISMISS_KEY = "message-alert-dismissed:v1";
const MAX_CARDS = 3;
const PLACE_KEY = "message-alert-place:v1";
const EDGE = 16;

/** Where the popup sits: its distance from the window's right and bottom edges. */
type Place = { right: number; bottom: number; minimised: boolean };
function loadPlace(): Place {
    try { return { right: EDGE, bottom: EDGE, minimised: false, ...JSON.parse(window.localStorage.getItem(PLACE_KEY) ?? "{}") }; }
    catch { return { right: EDGE, bottom: EDGE, minimised: false }; }
}
function savePlace(p: Place) {
    try { window.localStorage.setItem(PLACE_KEY, JSON.stringify(p)); } catch { /* private mode */ }
}

/** A card the person dragged out of the stack, keyed by phone. */
const CARDS_KEY = "message-alert-cards:v1";
type Spot = { right: number; bottom: number };
function loadCards(): Record<string, Spot> {
    try { return JSON.parse(window.localStorage.getItem(CARDS_KEY) ?? "{}") as Record<string, Spot>; } catch { return {}; }
}
function saveCards(c: Record<string, Spot>) {
    try { window.localStorage.setItem(CARDS_KEY, JSON.stringify(c)); } catch { /* private mode */ }
}
/** Keep a box of size w×h fully on screen. */
const clampSpot = (sp: Spot, w: number, h: number): Spot => ({
    right: Math.min(Math.max(sp.right, 0), Math.max(window.innerWidth - w, 0)),
    bottom: Math.min(Math.max(sp.bottom, 0), Math.max(window.innerHeight - h, 0)),
});

/**
 * Drag `box` by pointer from spot `from`. `onMove` gets each new spot, `onDone`
 * the final one; `onClick` fires instead when the pointer barely moved, so the
 * bubble can be both dragged and clicked. Buttons and text boxes inside never
 * start a drag.
 */
function startDrag(
    e: React.PointerEvent<HTMLElement>, box: HTMLElement | null, from: Spot,
    onMove: (sp: Spot) => void, onDone: (sp: Spot) => void, onClick?: () => void,
) {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button:not([data-drag]),textarea,input")) return;
    const x0 = e.clientX, y0 = e.clientY;
    const w = box?.offsetWidth ?? 60, h = box?.offsetHeight ?? 60;
    let moved = false, last = from;
    const move = (ev: PointerEvent) => {
        const dx = ev.clientX - x0, dy = ev.clientY - y0;
        if (!moved && Math.abs(dx) + Math.abs(dy) < 5) return;
        moved = true;
        last = clampSpot({ right: from.right - dx, bottom: from.bottom - dy }, w, h);
        onMove(last);
    };
    const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        if (moved) onDone(last); else onClick?.();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
}

type Alert = {
    phone: string;
    name: string;
    lastId: number;
    body: string;
    /** Newest customer message — a ticket is raised from it. */
    lastInId: number | null;
    /** Up to the last 3 customer messages (the waiting ones while any wait), oldest first. */
    recent: (MediaInfo & { body: string })[];
    /** Customer messages still waiting for the shop to get back to them. */
    count: number;
    lastAt: string;
    /** Newest customer message — the 24-hour reply window runs from it. */
    lastInAt: string | null;
    /** Oldest waiting customer message — null when none waits. */
    firstAt: string | null;
    /** Some customer message is not answered yet — the card cannot be closed. */
    waiting: boolean;
    /** The newest unanswered @mention note on this chat. */
    note: { by: string; text: string; at: string } | null;
    /** `since` = when the chat last changed hands. */
    claim: { owner: Staff; helpers: Staff[]; since: string } | null;
};

/** phone → the newest message id this person closed the card on. */
function loadDismissed(): Record<string, number> {
    try { return JSON.parse(window.localStorage.getItem(DISMISS_KEY) ?? "{}") as Record<string, number>; } catch { return {}; }
}
function saveDismissed(d: Record<string, number>) {
    try { window.localStorage.setItem(DISMISS_KEY, JSON.stringify(d)); } catch { /* private mode */ }
}

function chime() {
    try {
        const ctx = new AudioContext();
        for (const [i, f] of [660, 880].entries()) {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain); gain.connect(ctx.destination);
            osc.type = "sine";
            const t = ctx.currentTime + i * 0.16;
            osc.frequency.setValueAtTime(f, t);
            gain.gain.setValueAtTime(0.14, t);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
            osc.start(t); osc.stop(t + 0.3);
        }
    } catch { /* no audio */ }
}

const inChat = (a: Alert, me: number) => !!a.claim && (a.claim.owner.id === me || a.claim.helpers.some((h) => h.id === me));

/**
 * `href` is where "open the full chat" goes — the staff phone app passes its own
 * Inbox, since a phone never leaves the app; `mayOpen` is that screen's own rule.
 */
export default function MessageAlertPopup({ href = MESSAGES_HREF, mayOpen }: { href?: string; mayOpen?: (permissions: string[]) => boolean } = {}) {
    const router = useRouter();
    const pathname = usePathname();
    const { data } = useSession();
    const user = data?.user as { id?: string; permissions?: string[] } | undefined;
    const me = user?.id ? Number(user.id) : null;
    const permissions = user?.permissions;
    const allowed = !!me && !!permissions && (mayOpen ? mayOpen(permissions) : canOpenPage(href, permissions));
    const canReply = !!permissions && (permissions.includes(PERMISSIONS.MESSAGES_REPLY) || permissions.includes(PERMISSIONS.ADMIN_BYPASS));
    // The POS Messages drawer shows everything too — hide while it is up.
    const drawerOpen = useChatDrawerOpen();
    const onMessagesScreen = (pathname?.startsWith(href) ?? false) || drawerOpen;

    const [items, setItems] = useState<Alert[]>([]);
    const [loaded, setLoaded] = useState(false);
    const [dismissed, setDismissed] = useState<Record<string, number>>({});
    const [now, setNow] = useState(() => Date.now());
    const [drafts, setDrafts] = useState<Record<string, string>>({});
    const [sending, setSending] = useState<string | null>(null);
    const [pick, setPick] = useState<{ mode: PickMode; alert: Alert } | null>(null);
    const notified = useRef<Set<number> | null>(null);
    const [place, setPlace] = useState<Place>({ right: EDGE, bottom: EDGE, minimised: false });
    const boxRef = useRef<HTMLDivElement>(null);
    const bubbleRef = useRef<HTMLButtonElement>(null);
    const changePlace = (p: Place) => { setPlace(p); savePlace(p); };
    const dragStack = (e: React.PointerEvent<HTMLElement>, box: HTMLElement | null, onClick?: () => void) =>
        startDrag(e, box, place, (sp) => setPlace({ ...place, ...sp }), (sp) => changePlace({ ...place, ...sp }), onClick);
    // Cards moved on their own; the rest stay in the stack.
    const [cards, setCards] = useState<Record<string, Spot>>({});
    const changeCard = (phone: string, sp: Spot | null) => setCards((c) => {
        const next = { ...c };
        if (sp) next[phone] = sp; else delete next[phone];
        saveCards(next);
        return next;
    });
    const dragCard = (e: React.PointerEvent<HTMLElement>, phone: string) => {
        const card = (e.currentTarget as HTMLElement).closest<HTMLElement>("[data-card]");
        if (!card) return;
        const r = card.getBoundingClientRect();
        const from = cards[phone] ?? { right: window.innerWidth - r.right, bottom: window.innerHeight - r.bottom };
        startDrag(e, card, from, (sp) => setCards((c) => ({ ...c, [phone]: sp })), (sp) => changeCard(phone, sp));
    };

    useEffect(() => { setDismissed(loadDismissed()); setPlace(loadPlace()); setCards(loadCards()); }, []);

    // A smaller window must not strand the popup off screen.
    useEffect(() => {
        const fit = () => setPlace((p) => ({
            ...p,
            right: Math.min(p.right, Math.max(window.innerWidth - 80, 0)),
            bottom: Math.min(p.bottom, Math.max(window.innerHeight - 80, 0)),
        }));
        fit();
        window.addEventListener("resize", fit);
        return () => window.removeEventListener("resize", fit);
    }, []);

    const load = useCallback(async () => {
        try {
            const { data } = await axios.get<{ items: Alert[] }>("/api/messages/alerts");
            setItems(data.items);
            setLoaded(true);
            setNow(Date.now());
        } catch { /* the next signal tries again */ }
    }, []);
    useEffect(() => { if (allowed) void load(); }, [allowed, load]);
    // A call logged, a ticket or a Reconnect activity answers a chat too.
    useRealtimeTopics(["messages", "tickets"], () => void load(), allowed, ["Message", "MessageClaim", "Call", "Ticket", "TicketLog"]);

    // The hand-back to everyone is a matter of time passing, not of new data.
    useEffect(() => {
        if (!allowed) return;
        const t = setInterval(() => setNow(Date.now()), 30_000);
        return () => clearInterval(t);
    }, [allowed]);

    const visible = useMemo(() => {
        if (!me) return [];
        return items.filter((a) => {
            // Closing is only for an answered chat — a waiting one ignores it.
            if (!a.waiting && (dismissed[a.phone] ?? 0) >= a.lastId) return false;
            // An answered chat stays only with the people in it.
            if (!a.waiting && !a.note) return inChat(a, me);
            if (!a.claim || inChat(a, me)) return true;
            // Only an unanswered CUSTOMER message goes back to everyone; a note
            // is for the people it mentions.
            // The clock restarts whenever the chat changes hands, so whoever it
            // was just passed to gets their own 10 minutes.
            if (a.firstAt == null) return false;
            const waitingSince = Math.max(new Date(a.firstAt).getTime(), new Date(a.claim.since).getTime());
            return now - waitingSince >= MESSAGE_CLAIM_FALLBACK_MS;
        });
    }, [items, dismissed, me, now]);
    const hasCards = visible.length > 0;

    // A moved card's spot lasts only while its chat is waiting.
    useEffect(() => {
        if (!loaded) return; // nothing fetched yet — keep every saved spot
        const live = new Set(visible.map((a) => a.phone));
        if (Object.keys(cards).every((ph) => live.has(ph))) return;
        const next = Object.fromEntries(Object.entries(cards).filter(([ph]) => live.has(ph)));
        setCards(next);
        saveCards(next);
    }, [visible, cards, loaded]);

    // The stack grows upward from its spot; when it is taller than the room
    // above, it slides down so its top never leaves the screen.
    const [boxH, setBoxH] = useState(0);
    useEffect(() => {
        const el = boxRef.current;
        if (!el) return;
        const ro = new ResizeObserver(() => setBoxH(el.offsetHeight));
        ro.observe(el);
        return () => ro.disconnect();
    }, [place.minimised, hasCards]);

    // Sound + a Windows notification for each message that newly reaches this
    // person. The first answer after mount only primes the set — a reload must
    // not chime for messages that were already waiting.
    useEffect(() => {
        if (!allowed) return;
        const ids = visible.map((a) => a.lastId);
        if (notified.current == null) { notified.current = new Set(ids); return; }
        const fresh = visible.filter((a) => !notified.current!.has(a.lastId));
        for (const id of ids) notified.current.add(id);
        if (!fresh.length || onMessagesScreen) return;
        chime();
        if (typeof Notification !== "undefined" && Notification.permission === "granted") {
            const a = fresh[0];
            const n = new Notification(
                a.note ? `${a.note.by} mentioned you · ${a.name}` : `WhatsApp · ${a.name}`,
                { body: (a.note?.text ?? a.body).slice(0, 120), tag: `wa-${a.phone}` },
            );
            n.onclick = () => { window.focus(); n.close(); };
        }
    }, [visible, allowed, onMessagesScreen]);

    useEffect(() => {
        if (allowed && typeof Notification !== "undefined" && Notification.permission === "default") {
            void Notification.requestPermission();
        }
    }, [allowed]);

    const close = (a: Alert) => {
        const next = { ...loadDismissed(), [a.phone]: a.lastId };
        saveDismissed(next);
        setDismissed(next);
    };

    /** Past WhatsApp's 24 hours since their last message — only a call reaches them now. */
    const locked = (a: Alert) => !!a.lastInAt && now - new Date(a.lastInAt).getTime() >= MESSAGE_REPLY_WINDOW_MS;

    const send = async (a: Alert) => {
        const text = (drafts[a.phone] ?? "").trim();
        if (!text || sending) return;
        setSending(a.phone);
        try {
            const target = await mentionTargets(text, me);
            if (!target && locked(a)) { toast.error("24 hours have passed — WhatsApp will not deliver a reply. Call the customer."); return; }
            if (target && !target.ids.length) { toast.error("Nobody else in that mention can take this chat"); return; }
            if (target) {
                // A staff note — the chat passes to them and this person steps out.
                // A group mention is each of its members mentioned one by one.
                await axios.post("/api/messages/note", { phone: a.phone, text, mentionIds: target.ids });
                toast.success(`Passed to ${target.label} — not sent to the customer`);
            } else {
                await axios.post("/api/messages/reply", { phone: a.phone, text });
                toast.success(`Replied to ${a.name}`);
            }
            setDrafts((d) => ({ ...d, [a.phone]: "" }));
            // A mention steps this person out — gone at once. A reply keeps the
            // card, now answered, to watch for the customer's next message.
            if (target) setItems((list) => list.filter((x) => x.phone !== a.phone));
            else setItems((list) => list.map((x) => x.phone === a.phone ? { ...x, waiting: false, count: 0, firstAt: null } : x));
            void load();
        } catch (e) {
            toast.error(extractApiError(e, "Reply not sent"));
        } finally {
            setSending(null);
        }
    };

    const [raising, setRaising] = useState<string | null>(null);
    const raiseTicket = async (a: Alert, kind: "help" | "deal") => {
        if (!a.lastInId || raising) return;
        setRaising(a.phone);
        try {
            const { data } = await axios.post<{ ticketId: number }>(`/api/messages/${a.lastInId}/ticket`, { kind });
            toast.success(`${kind === "deal" ? "Deal" : "Help ticket"} #${data.ticketId} raised for ${a.name}`);
            void load();
        } catch (e) {
            toast.error(extractApiError(e, "Ticket not raised"));
        } finally {
            setRaising(null);
        }
    };

    const claim = async (a: Alert, mode: PickMode, s: Staff) => {
        setPick(null);
        try {
            await axios.post("/api/messages/claim", { phone: a.phone, action: mode, userId: s.id });
            toast.success(mode === "handover" ? `Handed over to ${s.name}` : `${s.name} invited`);
            void load();
        } catch (e) {
            toast.error(extractApiError(e, "Could not update who handles this chat"));
        }
    };

    if (!allowed || onMessagesScreen || !me) return null;
    const shown = visible.slice(0, MAX_CARDS);
    const more = visible.length - shown.length;
    const stacked = shown.filter((a) => !cards[a.phone]);

    const renderCard = (a: Alert) => {
        const mine = inChat(a, me);
        const isOwner = a.claim?.owner.id === me;
        const isLocked = locked(a);
        const leftMs = a.lastInAt ? new Date(a.lastInAt).getTime() + MESSAGE_REPLY_WINDOW_MS - now : 0;
        const leftLabel = leftMs >= 3_600_000 ? `${Math.floor(leftMs / 3_600_000)}h left to reply` : `${Math.max(1, Math.ceil(leftMs / 60_000))} min left to reply`;
        return (
            <div key={a.phone} data-card className="rounded-lg border border-green-300 bg-background p-3 shadow-lg dark:border-green-800">
                <div
                    className="flex cursor-move touch-none select-none items-start gap-2"
                    title="Drag to move this chat · double-click to put it back"
                    onPointerDown={(e) => dragCard(e, a.phone)}
                    onDoubleClick={() => cards[a.phone] ? changeCard(a.phone, null) : changePlace({ ...place, right: EDGE, bottom: EDGE })}
                >
                    <MessageCircle className="mt-0.5 size-4 shrink-0 text-green-600" />
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-semibold">{a.name}</span>
                            {a.count > 1 && <span className="rounded-full bg-green-600 px-1.5 text-[11px] text-white">{a.count}</span>}
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                            {a.waiting && (
                                <span className={isLocked ? "font-medium text-red-600" : leftMs < 3 * 3_600_000 ? "font-medium text-amber-600" : ""}>
                                    {isLocked ? "24h passed — call the customer" : leftLabel}{" · "}
                                </span>
                            )}
                            {!a.waiting && !a.note
                                ? "Answered — watching for their reply"
                                : !a.claim
                                ? "New — nobody has answered yet"
                                : mine
                                    ? (a.note ? `${a.note.by} passed this to you` : isOwner ? "Your chat" : `With ${a.claim.owner.name} — you were invited`)
                                    : `${a.claim.owner.name} has not answered for 10 min`}
                        </p>
                    </div>
                    <button onClick={() => { if (!requestOpenChat(a.phone)) router.push(`${href}?phone=${a.phone}`); }} className="text-muted-foreground hover:text-foreground" title="Open the full chat">
                        <ExternalLink className="size-4" />
                    </button>
                    <button onClick={() => changePlace({ ...place, minimised: true })} className="text-muted-foreground hover:text-foreground" title="Minimise to a chat bubble">
                        <Minus className="size-4" />
                    </button>
                    {/* A waiting customer cannot be closed — only answered, or
                        minimised. Once answered, close until they write again. */}
                    {!a.waiting && (
                        <button onClick={() => close(a)} className="text-muted-foreground hover:text-foreground" title="Close until they write again">
                            <X className="size-4" />
                        </button>
                    )}
                </div>
                <div className="mt-2 space-y-1">
                    {a.recent.map((m, i) => {
                        const caption = captionOf(m.body, !!(m.mediaUrl || m.mediaType));
                        return (
                            <div key={i} className="w-fit max-w-full space-y-1 rounded-md bg-muted px-2 py-1 text-sm [&_img]:max-h-40 [&_video]:max-h-40">
                                <MessageMedia m={m} />
                                {caption && <p className="whitespace-pre-wrap break-words">{caption}</p>}
                            </div>
                        );
                    })}
                    {a.note && (
                        <p className="whitespace-pre-wrap break-words rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-50">
                            <span className="text-[11px] font-medium">{a.note.by} · staff note</span><br />{a.note.text}
                        </p>
                    )}
                </div>
                {a.waiting && isLocked && (
                    <p className="mt-2 flex items-center gap-1.5 rounded-md border border-red-300 bg-red-50 px-2 py-1 text-xs text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-100">
                        <PhoneCall className="size-3.5 shrink-0" /> WhatsApp allows no reply after 24 hours. Call them — the logged call closes this.
                    </p>
                )}
                {canReply && (
                    <>
                        {/^\s*@|\s@\S/.test(drafts[a.phone] ?? "") && (
                            <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-300">With an @mention this is a staff note — the customer will not see it.</p>
                        )}
                        <div className="mt-2 flex items-end gap-2">
                            <MentionTextarea
                                value={drafts[a.phone] ?? ""}
                                onChange={(text) => setDrafts((d) => ({ ...d, [a.phone]: text }))}
                                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(a); } }}
                                placeholder={isLocked ? "Reply closed — @name for a staff note" : "Reply, or @name for a staff note"}
                                className="text-sm"
                            />
                            <Button size="icon" disabled={sending === a.phone || !(drafts[a.phone] ?? "").trim()} onClick={() => void send(a)} title="Send on WhatsApp">
                                <Send className="size-4" />
                            </Button>
                        </div>
                        <div className="mt-1.5 flex justify-end gap-1">
                            {a.waiting && a.lastInId && (
                                <>
                                    <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" disabled={raising === a.phone} onClick={() => void raiseTicket(a, "help")} title="Raise a Help Desk ticket from this message — answers it">
                                        <Ticket className="mr-1 size-3" /> Help
                                    </Button>
                                    <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" disabled={raising === a.phone} onClick={() => void raiseTicket(a, "deal")} title="Raise a Deal from this message — answers it">
                                        <HandCoins className="mr-1 size-3" /> Deal
                                    </Button>
                                </>
                            )}
                            <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setPick({ mode: "invite", alert: a })}>
                                <Users className="mr-1 size-3" /> Invite
                            </Button>
                            {(isOwner || !a.claim) && (
                                <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setPick({ mode: "handover", alert: a })}>
                                    <ArrowRightLeft className="mr-1 size-3" /> Hand over
                                </Button>
                            )}
                        </div>
                    </>
                )}
            </div>
        );
    };


    return (
        <>
            {shown.length > 0 && place.minimised && (
                <button
                    ref={bubbleRef}
                    data-drag
                    style={{ right: place.right, bottom: place.bottom }}
                    onPointerDown={(e) => dragStack(e, bubbleRef.current, () => changePlace({ ...place, minimised: false }))}
                    className="fixed z-[60] flex size-12 touch-none items-center justify-center rounded-full bg-green-600 text-white shadow-lg hover:bg-green-700"
                    title="WhatsApp chats waiting — click to open, drag to move"
                >
                    <MessageCircle className="size-6" />
                    <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-red-600 px-1 text-center text-[11px] font-semibold leading-5">{visible.length}</span>
                </button>
            )}
            {!place.minimised && shown.filter((a) => cards[a.phone]).map((a) => {
                // A card moved on its own; kept on screen if the window shrank.
                const sp = clampSpot(cards[a.phone], 384, 140);
                return (
                    <div key={a.phone} style={{ right: sp.right, bottom: sp.bottom }} className="fixed z-[60] w-96 max-w-[calc(100vw-1rem)]">
                        {renderCard(a)}
                    </div>
                );
            })}
            {stacked.length > 0 && !place.minimised && (
                <div ref={boxRef} style={{ right: place.right, bottom: Math.max(0, Math.min(place.bottom, (typeof window === "undefined" ? 0 : window.innerHeight) - boxH - 8)) }} className="fixed z-[60] flex w-96 max-w-[calc(100vw-1rem)] flex-col gap-2">
                    {stacked.map(renderCard)}
                    {more > 0 && (
                        <button onClick={() => router.push(href)} className="self-end rounded-md bg-green-600 px-2 py-1 text-xs text-white shadow">
                            +{more} more waiting
                        </button>
                    )}
                </div>
            )}
            <StaffPickerDialog
                mode={pick?.mode ?? null}
                exclude={[me, ...(pick?.alert.claim ? [pick.alert.claim.owner.id, ...pick.alert.claim.helpers.map((h) => h.id)] : [])]}
                onClose={() => setPick(null)}
                onPick={(s) => pick && void claim(pick.alert, pick.mode, s)}
            />
        </>
    );
}
