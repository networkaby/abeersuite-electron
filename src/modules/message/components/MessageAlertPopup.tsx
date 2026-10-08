"use client";

/**
 * MessageAlertPopup — a customer's WhatsApp message pops up on whatever screen
 * staff are on. Mounted once in the office layout and once in the POS layout
 * (as CallFollowUpPopup), so it is never tied to the Messages screen.
 *
 * WHO SEES WHICH CHAT (MessageClaim):
 *  - nobody handling it yet → everyone who may open CRM → Messages;
 *  - claimed → its owner and invited helpers only;
 *  - …until its oldest unread message has waited MESSAGE_CLAIM_FALLBACK_MS,
 *    then everyone again — an owner who has gone for tea cannot sit on it.
 * The first reply claims the chat on the server; "Take it" here claims it
 * without replying.
 *
 * STAYS UNTIL ACTED ON. A card leaves when someone opens the chat (that marks it
 * seen for the whole shop), or when this person closes it — and then only until
 * the customer writes again.
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
import { MessageCircle, X, Hand } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRealtimeTopics } from "@/shared/hooks/useRealtimeTopics";
import { canOpenPage } from "@/shared/lib/auth/pageAccess";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { MESSAGE_CLAIM_FALLBACK_MS } from "@/shared/lib/constants/polling";
import { extractApiError } from "@/shared/lib/api";

const MESSAGES_HREF = "/office/crm/messages";
const DISMISS_KEY = "message-alert-dismissed:v1";
const MAX_CARDS = 3;

type Staff = { id: number; name: string };
type Alert = {
    phone: string;
    name: string;
    lastId: number;
    body: string;
    count: number;
    lastAt: string;
    firstAt: string;
    claim: { owner: Staff; helpers: Staff[] } | null;
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
    const [busy, setBusy] = useState<string | null>(null);
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
            if (!a.claim) return true;
            if (a.claim.owner.id === me || a.claim.helpers.some((h) => h.id === me)) return true;
            return now - new Date(a.firstAt).getTime() >= MESSAGE_CLAIM_FALLBACK_MS;
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
            const n = new Notification(`WhatsApp · ${a.name}`, { body: a.body.slice(0, 120), tag: `wa-${a.phone}` });
            n.onclick = () => { window.focus(); router.push(`${MESSAGES_HREF}?phone=${a.phone}`); n.close(); };
        }
    }, [visible, allowed, onMessagesScreen, router]);

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
    const open = (a: Alert) => router.push(`${MESSAGES_HREF}?phone=${a.phone}`);
    const take = async (a: Alert) => {
        setBusy(a.phone);
        try {
            await axios.post("/api/messages/claim", { phone: a.phone, action: "take" });
            open(a);
        } catch (e) {
            toast.error(extractApiError(e, "Could not take the chat"));
        } finally {
            setBusy(null);
        }
    };

    if (!allowed || onMessagesScreen || visible.length === 0) return null;
    const shown = visible.slice(0, MAX_CARDS);
    const more = visible.length - shown.length;

    return (
        <div className="fixed bottom-4 right-4 z-[60] flex w-80 flex-col gap-2">
            {shown.map((a) => {
                const mine = a.claim?.owner.id === me;
                const waitedOut = a.claim && !mine && !a.claim.helpers.some((h) => h.id === me);
                return (
                    <div key={a.phone} className="rounded-lg border border-green-300 bg-background p-3 shadow-lg dark:border-green-800">
                        <div className="flex items-start gap-2">
                            <MessageCircle className="mt-0.5 size-4 shrink-0 text-green-600" />
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center justify-between gap-2">
                                    <span className="truncate text-sm font-semibold">{a.name}</span>
                                    {a.count > 1 && <span className="rounded-full bg-green-600 px-1.5 text-[11px] text-white">{a.count}</span>}
                                </div>
                                <p className="line-clamp-2 text-sm text-muted-foreground">{a.body}</p>
                                <p className="mt-1 text-[11px] text-muted-foreground">
                                    {!a.claim
                                        ? "New — nobody has taken it yet"
                                        : mine
                                            ? "Your chat"
                                            : waitedOut
                                                ? `${a.claim.owner.name} has not answered for 10 min`
                                                : `${a.claim.owner.name} invited you`}
                                </p>
                            </div>
                            <button onClick={() => close(a)} className="text-muted-foreground hover:text-foreground" title="Close until they write again">
                                <X className="size-4" />
                            </button>
                        </div>
                        <div className="mt-2 flex justify-end gap-2">
                            {canReply && !mine && (
                                <Button size="sm" variant="outline" disabled={busy === a.phone} onClick={() => void take(a)}>
                                    <Hand className="mr-1 size-3.5" /> Take it
                                </Button>
                            )}
                            <Button size="sm" onClick={() => open(a)}>Open</Button>
                        </div>
                    </div>
                );
            })}
            {more > 0 && (
                <button onClick={() => router.push(MESSAGES_HREF)} className="self-end rounded-md bg-green-600 px-2 py-1 text-xs text-white shadow">
                    +{more} more waiting
                </button>
            )}
        </div>
    );
}
