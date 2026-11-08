import "server-only";
import webpush from "web-push";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { PHONE_APP_HOME } from "@/shared/lib/device/phone";
import { isFcmConfigured, sendFcm } from "@/shared/lib/push/fcm";
import { isWebPushConfigured } from "@/shared/lib/push/sendPush";

/**
 * Staff notifications — customer WhatsApp messages, and reminders such as a post
 * due to be shared (pushNoticesToStaff). They reach staff even
 * with the app or tab closed. Devices are StaffPushDevice rows, saved by
 * POST /api/mobile/push, two kinds:
 *  - the Android staff app (phone-app/): FCM data message, NsMessagingService draws it;
 *  - a browser (office site, POS, phone Chrome): web push, public/sw.js draws it.
 * The desktop app (Electron) has no web push; it hides to the tray instead of
 * quitting, so its open page's popup + Windows notification cover it.
 *
 * Who: the same rule the popup starts with (MessageAlertPopup) — a chat nobody
 * has replied to goes to every registered device; a claimed chat to its owner
 * and helpers only. The popup's 10-minute hand-back to everyone is not repeated
 * here (it would need a timer); the next customer message, or the popup, covers it.
 * A device is registered only by someone holding the Inbox tick, re-checked each
 * time the app opens; a sign-out or role change (User.tokensValidFrom) silences it.
 */

export type InboundForPush = { phone: string; name: string; text: string };

const PHONE_UA = /Android|iPhone|iPad|Mobile/i;

/** Where a tap lands: the phone app's Inbox on a phone, CRM → Messages on a PC. */
function chatUrl(phone: string, fcm: boolean, userAgent: string | null): string {
    return fcm || PHONE_UA.test(userAgent ?? "") ? `${PHONE_APP_HOME}/inbox?phone=${phone}` : `/office/crm/messages?phone=${phone}`;
}

type Device = { id: number; token: string; p256dh: string | null; auth: string | null; userAgent: string | null };

/** "dead" = the device is gone (uninstalled, unsubscribed): drop it. */
async function sendTo(d: Device, data: Record<string, string>): Promise<"sent" | "dead" | "failed"> {
    if (!d.p256dh || !d.auth) return sendFcm(d.token, data);
    if (!isWebPushConfigured()) return "failed";
    try {
        await webpush.sendNotification({ endpoint: d.token, keys: { p256dh: d.p256dh, auth: d.auth } }, JSON.stringify(data), {
            TTL: 86_400,
            urgency: "high",
        });
        return "sent";
    } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        return code === 404 || code === 410 ? "dead" : "failed";
    }
}

type LiveDevice = Device & { userId: number };

/** Registered devices whose owner has not been signed out since they last opened the app. */
async function liveStaffDevices(): Promise<LiveDevice[]> {
    const devices = await prisma.staffPushDevice.findMany({
        select: {
            id: true, token: true, p256dh: true, auth: true, userAgent: true, userId: true, lastSeenAt: true,
            user: { select: { tokensValidFrom: true } },
        },
    });
    return devices.filter((d) => !d.user.tokensValidFrom || d.user.tokensValidFrom < d.lastSeenAt);
}

async function dropDead(ids: number[]): Promise<void> {
    if (ids.length) await prisma.staffPushDevice.deleteMany({ where: { id: { in: ids } } });
}

/** Never throws — the webhook must always answer Meta 200. */
export async function pushInboundToStaff(items: InboundForPush[]): Promise<void> {
    if (!items.length || !(isFcmConfigured() || isWebPushConfigured())) return;
    try {
        const live = await liveStaffDevices();
        if (!live.length) return;

        // Newest message per customer only — one notification per chat.
        const byPhone = new Map(items.map((i) => [i.phone, i]));
        const claims = await prisma.messageClaim.findMany({
            where: { phone: { in: [...byPhone.keys()] } },
            select: { phone: true, ownerUserId: true, helperUserIds: true },
        });
        const claimOf = new Map(claims.map((c) => [c.phone, new Set([c.ownerUserId, ...c.helperUserIds])]));

        const dead: number[] = [];
        await Promise.all(
            [...byPhone.values()].flatMap((m) => {
                const people = claimOf.get(m.phone);
                return live
                    .filter((d) => !people || people.has(d.userId))
                    .map(async (d) => {
                        const out = await sendTo(d, {
                            title: `WhatsApp · ${m.name}`,
                            body: m.text.slice(0, 200),
                            url: chatUrl(m.phone, !d.p256dh, d.userAgent),
                            tag: `wa-${m.phone}`,
                        });
                        if (out === "dead") dead.push(d.id);
                    });
            }),
        );
        await dropDead(dead);
    } catch (e) {
        console.error("[staff-push] send failed", e);
    }
}

export type StaffNotice = { title: string; body: string; url: string; tag: string };

/**
 * One notice to every registered staff device — for reminders that are nobody's
 * chat (a post due to be shared) — or, with `userIds`, only to those people's
 * devices (a ticket assigned to their seat). `url` is an office path; the phone
 * app opens it in its browser view. Returns how many devices took it. Never throws.
 */
export async function pushNoticesToStaff(notices: StaffNotice[], userIds?: number[]): Promise<number> {
    if (!notices.length || !(isFcmConfigured() || isWebPushConfigured())) return 0;
    try {
        const only = userIds ? new Set(userIds) : null;
        const live = (await liveStaffDevices()).filter((d) => !only || only.has(d.userId));
        const dead: number[] = [];
        let sent = 0;
        await Promise.all(
            notices.flatMap((n) =>
                live.map(async (d) => {
                    const out = await sendTo(d, { ...n, body: n.body.slice(0, 200) });
                    if (out === "sent") sent++;
                    if (out === "dead") dead.push(d.id);
                }),
            ),
        );
        await dropDead([...new Set(dead)]);
        return sent;
    } catch (e) {
        console.error("[staff-push] notice send failed", e);
        return 0;
    }
}
