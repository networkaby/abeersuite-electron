import "server-only";
import webpush from "web-push";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { COMPANY_DETAILS } from "@/shared/lib/constants/companyDetails";

/**
 * Customer app notifications (web push) — free, unlike WhatsApp.
 *
 * Every device the customer allowed (PushSubscription) gets the message; the
 * phone's service worker (public/sw.js) shows it and reports back through
 * /api/portal/push/ack, which stamps PushMessage.shownAt. The sender reads that stamp
 * to decide whether the WhatsApp copy can be skipped — a `reached` count here
 * only means Google/Apple accepted the message, not that the phone showed it.
 *
 * ── Setup ────────────────────────────────────────────────────────────────────
 *   NEXT_PUBLIC_VAPID_PUBLIC_KEY   `npx web-push generate-vapid-keys`
 *   VAPID_PRIVATE_KEY              the private half — never change it casually:
 *                                  every saved subscription is tied to this pair
 *   VAPID_SUBJECT                  mailto: contact the push services may use
 *                                  (default: the shop contact email)
 */

export type PushPayload = {
    title: string;
    body: string;
    /** Page the tap opens — a path on the shop site, e.g. /portal/orders/123. */
    url: string;
    /** Same tag replaces an older notification instead of stacking. */
    tag?: string;
    /** What this announces (e.g. "voucher", id) — for the WhatsApp fallback check. */
    refType?: string;
    refId?: string;
};

export type PushResult = {
    /** PushMessage.id — poll its `shownAt`; null when nothing was sent. */
    messageId: string | null;
    /** Devices whose push service accepted the message. */
    reached: number;
    status: "sent" | "no-subscription" | "failed" | "not-configured";
};

let configured: boolean | null = null;

export function isPushConfigured(): boolean {
    if (configured !== null) return configured;
    const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    if (!publicKey || !privateKey) return (configured = false);
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || `mailto:${COMPANY_DETAILS.contact.email}`, publicKey, privateKey);
    return (configured = true);
}

/** Push to every device of one customer (Person.id). Never throws. */
export async function sendPushToPerson(personId: number, payload: PushPayload): Promise<PushResult> {
    if (!isPushConfigured()) return { messageId: null, reached: 0, status: "not-configured" };

    try {
        const subs = await prisma.pushSubscription.findMany({
            where: { personId },
            select: { id: true, endpoint: true, p256dh: true, auth: true },
        });
        if (subs.length === 0) return { messageId: null, reached: 0, status: "no-subscription" };

        const message = await prisma.pushMessage.create({
            data: {
                personId,
                title: payload.title,
                body: payload.body,
                url: payload.url,
                tag: payload.tag ?? null,
                refType: payload.refType ?? null,
                refId: payload.refId ?? null,
            },
            select: { id: true },
        });

        // The service worker gets everything it needs to show the notification
        // and to say "shown" for exactly this message.
        const body = JSON.stringify({
            id: message.id,
            title: payload.title,
            body: payload.body,
            url: payload.url,
            tag: payload.tag,
        });

        const dead: number[] = [];
        const outcomes = await Promise.all(
            subs.map(async (s) => {
                try {
                    // TTL 1 day: a phone that is off longer gets WhatsApp anyway.
                    await webpush.sendNotification(
                        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
                        body,
                        { TTL: 86_400, urgency: "high" }
                    );
                    return true;
                } catch (e) {
                    const code = (e as { statusCode?: number }).statusCode;
                    if (code === 404 || code === 410) dead.push(s.id);
                    return false;
                }
            })
        );
        const reached = outcomes.filter(Boolean).length;

        await Promise.all([
            prisma.pushMessage.update({ where: { id: message.id }, data: { reachedCount: reached } }),
            dead.length ? prisma.pushSubscription.deleteMany({ where: { id: { in: dead } } }) : null,
        ]);

        return { messageId: message.id, reached, status: reached > 0 ? "sent" : "failed" };
    } catch (e) {
        console.error("[push] send failed", e);
        return { messageId: null, reached: 0, status: "failed" };
    }
}
