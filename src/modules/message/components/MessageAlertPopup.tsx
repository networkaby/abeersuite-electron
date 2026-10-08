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
 * A REPLY CLOSES IT FOR EVERYONE. Sending marks the customer's messages read
 * (server side, sendReply), so the card leaves every screen at once. The card
 * also leaves when someone opens the chat on the Messages screen, or when this
 * person closes it — and then only until the customer writes again.
 *
 * COST. One read of /api/messages/alerts per realtime "messages" signal, none on
 * a timer: the answer carries every chat with its claim, and the 10-minute
 * hand-back is worked out here against a local clock.
 *
 * Hidden on the Messages screen itself, which already shows all of this.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import axios from "axios";
import { toast } from "sonner";
import { MessageCircle, X, Send, Users, ArrowRightLeft, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRealtimeTopics } from "@/shared/hooks/useRealtimeTopics";
import { canOpenPage } from "@/shared/lib/auth/pageAccess";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { MESSAGE_CLAIM_FALLBACK_MS } from "@/shared/lib/constants/polling";
import { extractApiError } from "@/shared/lib/api";
import StaffPickerDialog, { type PickMode, type Staff } from "./StaffPickerDialog";
import MentionTextarea, { mentionedStaff } from "./MentionTextarea";

const MESSAGES_HREF = "/office/crm/messages";
const DISMISS_KEY = "message-alert-dismissed:v1";
const MAX_CARDS = 3;

type Alert = {
    phone: string;
    name: string;
    lastId: number;
    body: string;
    /** Up to the last 3 unread messages, oldest first. */
    recent: string[];
    count: number;
    lastAt: string;
    /** Oldest unread customer message — null when only a staff note is waiting. */
    firstAt: string | null;
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

export default function MessageAlertPopup() {
    const router = useRouter();
    const pathname = usePathname();
    const { data } = useSession();
    const user = data?.user as { id?: string; permissions?: string[] } | undefined;
    const me = user?.id ? Number(user.id) : null;
    const permissions = user?.permissions;
    const allowed = !!me && !!permissions && canOpenPage(MESSAGES_HREF, permissions);
    const canReply = !!permissions && (permissions.includes(PERMISSIONS.MESSAGES_REPLY) || permissions.includes(PERMISSIONS.ADMIN_BYPASS));
    const onMessagesScreen = pathname?.startsWith(MESSAGES_HREF) ?? false;

    const [items, setItems] = useState<Alert[]>([]);
    const [dismissed, setDismissed] = useState<Record<string, number>>({});
    const [now, setNow] = useState(() => Date.now());
    const [drafts, setDrafts] = useState<Record<string, string>>({});
    const [sending, setSending] = useState<string | null>(null);
    const [pick, setPick] = useState<{ mode: PickMode; alert: Alert } | null>(null);
    const notified = useRef<Set<number> | null>(null);

    useEffect(() => { setDismissed(loadDismissed()); }, []);

    const load = useCallback(async () => {
        try {
            const { data } = await axios.get<{ items: Alert[] }>("/api/messages/alerts");
            setItems(data.items);
            setNow(Date.now());
        } catch { /* the next signal tries again */ }
    }, []);
    useEffect(() => { if (allowed) void load(); }, [allowed, load]);
    useRealtimeTopics(["messages"], () => void load(), allowed, ["Message", "MessageClaim"]);

    // The hand-back to everyone is a matter of time passing, not of new data.
    useEffect(() => {
        if (!allowed) return;
        const t = setInterval(() => setNow(Date.now()), 30_000);
        return () => clearInterval(t);
    }, [allowed]);

    const visible = useMemo(() => {
        if (!me) return [];
        return items.filter((a) => {
            if ((dismissed[a.phone] ?? 0) >= a.lastId) return false;
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

    const send = async (a: Alert) => {
        const text = (drafts[a.phone] ?? "").trim();
        if (!text || sending) return;
        setSending(a.phone);
        try {
            const mentions = (await mentionedStaff(text)).filter((m) => m.id !== me);
            if (mentions.length) {
                // A staff note — the chat passes to them and this person steps out.
                await axios.post("/api/messages/note", { phone: a.phone, text, mentionIds: mentions.map((m) => m.id) });
                toast.success(`Passed to ${mentions.map((m) => m.name).join(", ")} — not sent to the customer`);
            } else {
                await axios.post("/api/messages/reply", { phone: a.phone, text });
                toast.success(`Replied to ${a.name}`);
            }
            setDrafts((d) => ({ ...d, [a.phone]: "" }));
            // Gone at once here; the server has it for everyone else.
            setItems((list) => list.filter((x) => x.phone !== a.phone));
        } catch (e) {
            toast.error(extractApiError(e, "Reply not sent"));
        } finally {
            setSending(null);
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

    return (
        <>
            {shown.length > 0 && (
                <div className="fixed bottom-4 right-4 z-[60] flex w-96 flex-col gap-2">
                    {shown.map((a) => {
                        const mine = inChat(a, me);
                        const isOwner = a.claim?.owner.id === me;
                        return (
                            <div key={a.phone} className="rounded-lg border border-green-300 bg-background p-3 shadow-lg dark:border-green-800">
                                <div className="flex items-start gap-2">
                                    <MessageCircle className="mt-0.5 size-4 shrink-0 text-green-600" />
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2">
                                            <span className="truncate text-sm font-semibold">{a.name}</span>
                                            {a.count > 1 && <span className="rounded-full bg-green-600 px-1.5 text-[11px] text-white">{a.count}</span>}
                                        </div>
                                        <p className="text-[11px] text-muted-foreground">
                                            {!a.claim
                                                ? "New — nobody has answered yet"
                                                : mine
                                                    ? (a.note ? `${a.note.by} passed this to you` : isOwner ? "Your chat" : `With ${a.claim.owner.name} — you were invited`)
                                                    : `${a.claim.owner.name} has not answered for 10 min`}
                                        </p>
                                    </div>
                                    <button onClick={() => router.push(`${MESSAGES_HREF}?phone=${a.phone}`)} className="text-muted-foreground hover:text-foreground" title="Open the full chat">
                                        <ExternalLink className="size-4" />
                                    </button>
                                    <button onClick={() => close(a)} className="text-muted-foreground hover:text-foreground" title="Close until they write again">
                                        <X className="size-4" />
                                    </button>
                                </div>
                                <div className="mt-2 space-y-1">
                                    {a.recent.map((b, i) => (
                                        <p key={i} className="w-fit max-w-full whitespace-pre-wrap break-words rounded-md bg-muted px-2 py-1 text-sm">{b}</p>
                                    ))}
                                    {a.note && (
                                        <p className="whitespace-pre-wrap break-words rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-50">
                                            <span className="text-[11px] font-medium">{a.note.by} · staff note</span><br />{a.note.text}
                                        </p>
                                    )}
                                </div>
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
                                                placeholder="Reply, or @name for a staff note"
                                                className="text-sm"
                                            />
                                            <Button size="icon" disabled={sending === a.phone || !(drafts[a.phone] ?? "").trim()} onClick={() => void send(a)} title="Send on WhatsApp">
                                                <Send className="size-4" />
                                            </Button>
                                        </div>
                                        <div className="mt-1.5 flex justify-end gap-1">
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
                    })}
                    {more > 0 && (
                        <button onClick={() => router.push(MESSAGES_HREF)} className="self-end rounded-md bg-green-600 px-2 py-1 text-xs text-white shadow">
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
