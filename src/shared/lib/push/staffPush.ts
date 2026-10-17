import "server-only";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { PHONE_APP_HOME } from "@/shared/lib/device/phone";
import { isFcmConfigured, sendFcm } from "@/shared/lib/push/fcm";

/**
 * Staff phone app notifications — a customer's WhatsApp message reaches the
 * phones of staff who may answer it, even with the app closed. FCM data
 * messages to the Android shell (phone-app/, NsStaffMessagingService draws them);
 * devices are StaffPushDevice rows, saved by POST /api/mobile/push.
 *
 * Who: the same rule the popup starts with (MessageAlertPopup) — a chat nobody
 * has replied to goes to every registered phone; a claimed chat to its owner and
 * helpers only. The popup's 10-minute hand-back to everyone is not repeated here
 * (it would need a timer); the next customer message, or the popup, covers it.
 * A phone is registered only by someone holding the Inbox tick, re-checked every
 * time the app opens; a sign-out or role change (User.tokensValidFrom) silences it.
 */

export type InboundForPush = { phone: string; name: string; text: string };

/** Never throws — the webhook must always answer Meta 200. */
export async function pushInboundToStaff(items: InboundForPush[]): Promise<void> {
    if (!items.length || !isFcmConfigured()) return;
    try {
        const devices = await prisma.staffPushDevice.findMany({
            select: { id: true, token: true, userId: true, lastSeenAt: true, user: { select: { tokensValidFrom: true } } },
        });
        const live = devices.filter((d) => !d.user.tokensValidFrom || d.user.tokensValidFrom < d.lastSeenAt);
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
                        const out = await sendFcm(d.token, {
                            title: `WhatsApp · ${m.name}`,
                            body: m.text.slice(0, 200),
                            url: `${PHONE_APP_HOME}/inbox?phone=${m.phone}`,
                            tag: `wa-${m.phone}`,
                        });
                        if (out === "dead") dead.push(d.id);
                    });
            }),
        );
        if (dead.length) await prisma.staffPushDevice.deleteMany({ where: { id: { in: dead } } });
    } catch (e) {
        console.error("[staff-push] send failed", e);
    }
}
