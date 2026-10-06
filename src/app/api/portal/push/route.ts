import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { requirePortalCustomer } from "@/shared/lib/auth/portalAuthGuard";

/**
 * POST   /api/portal/push — save this device's push subscription for the
 *        signed-in customer (the "Allow notifications" card).
 * DELETE /api/portal/push — forget it (notifications switched off).
 *
 * The endpoint is unique: a phone that changes hands (another customer signs
 * in on it) moves to the new customer instead of notifying both.
 */

const subscribeSchema = z.object({
    endpoint: z.string().url().max(1000),
    keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
});

const unsubscribeSchema = z.object({ endpoint: z.string().url().max(1000) });

export async function POST(req: Request) {
    const { customerId, response } = await requirePortalCustomer();
    if (response) return response;

    const { data, error } = await validateRequest(req, subscribeSchema);
    if (error) return error;

    try {
        const fields = {
            personId: customerId,
            p256dh: data.keys.p256dh,
            auth: data.keys.auth,
            userAgent: req.headers.get("user-agent")?.slice(0, 300) ?? null,
            lastSeenAt: new Date(),
        };
        await prisma.pushSubscription.upsert({
            where: { endpoint: data.endpoint },
            create: { endpoint: data.endpoint, ...fields },
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
        await prisma.pushSubscription.deleteMany({ where: { endpoint: data.endpoint, personId: customerId } });
        return NextResponse.json({ ok: true });
    } catch (e) {
        return handleApiError(e, "Failed to turn off notifications");
    }
}
