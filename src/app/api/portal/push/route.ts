import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { requirePortalCustomer } from "@/shared/lib/auth/portalAuthGuard";
import { FCM_PREFIX } from "@/shared/lib/push/fcm";

/**
 * POST   /api/portal/push — save this device's push subscription for the
 *        signed-in customer (the "Allow notifications" card).
 * DELETE /api/portal/push — forget it (notifications switched off).
 *
 * The endpoint is unique: a phone that changes hands (another customer signs
 * in on it) moves to the new customer instead of notifying both.
 *
 * The Android customer app sends `{ fcmToken }` instead (its Firebase install
 * token); it is kept in the same table as the address `fcm:<token>`, without
 * web-push keys (push/fcm.ts).
 */

const webSchema = z.object({
    endpoint: z.string().url().max(1000),
    keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
});
const appSchema = z.object({ fcmToken: z.string().min(20).max(4096) });
const subscribeSchema = z.union([webSchema, appSchema]);

const unsubscribeSchema = z.union([z.object({ endpoint: z.string().url().max(1000) }), appSchema]);

/** One stored address per device, whichever kind it is. */
const endpointOf = (d: { endpoint: string } | { fcmToken: string }) => ("fcmToken" in d ? `${FCM_PREFIX}${d.fcmToken}` : d.endpoint);

export async function POST(req: Request) {
    const { customerId, response } = await requirePortalCustomer();
    if (response) return response;

    const { data, error } = await validateRequest(req, subscribeSchema);
    if (error) return error;

    try {
        const endpoint = endpointOf(data);
        const fields = {
            personId: customerId,
            p256dh: "keys" in data ? data.keys.p256dh : "",
            auth: "keys" in data ? data.keys.auth : "",
            userAgent: req.headers.get("user-agent")?.slice(0, 300) ?? null,
            lastSeenAt: new Date(),
        };
        await prisma.pushSubscription.upsert({
            where: { endpoint },
            create: { endpoint, ...fields },
            update: fields,
        });
        return NextResponse.json({ ok: true });
    } catch (e) {
        return handleApiError(e, "Failed to turn on notifications");
    }
}

export async function DELETE(req: Request) {
    const { customerId, response } = await requirePortalCustomer();
    if (response) return response;

    const { data, error } = await validateRequest(req, unsubscribeSchema);
    if (error) return error;

    try {
        await prisma.pushSubscription.deleteMany({ where: { endpoint: endpointOf(data), personId: customerId } });
        return NextResponse.json({ ok: true });
    } catch (e) {
        return handleApiError(e, "Failed to turn off notifications");
    }
}
