import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { MOBILE_SCREENS, holdsScreen } from "@/modules/mobile/lib/mobileScreens";
import { PHONE_APP_HOME } from "@/shared/lib/device/phone";

/**
 * POST   /api/mobile/push — a staff device hands over where to reach it, each
 *        time the app / site opens: the Android staff app its Firebase token
 *        `{ token }` (StaffPushRegister), a browser its web push subscription
 *        `{ endpoint, keys }` (StaffWebPush). Saved only while the person holds
 *        the Inbox tick (the phone Inbox or CRM → Messages); without it the
 *        device is forgotten instead, so a tick taken away stops notifications
 *        the next time they open the app.
 * DELETE /api/mobile/push — forget this device.
 * Under /api/mobile so a phone-only session may call it. Sending: push/staffPush.ts.
 */

const appSchema = z.object({ token: z.string().min(20).max(4096) });
const webSchema = z.object({
    endpoint: z.string().url().max(1000),
    keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
});
const schema = z.union([appSchema, webSchema]);
const INBOX = MOBILE_SCREENS.find((s) => s.href === `${PHONE_APP_HOME}/inbox`)!;

const tokenOf = (d: z.infer<typeof schema>) => ("token" in d ? d.token : d.endpoint);

export async function POST(req: Request) {
    const { user, response } = await requireAuth();
    if (response) return response;
    const { data, error } = await validateRequest(req, schema);
    if (error) return error;

    try {
        const token = tokenOf(data);
        if (!holdsScreen(user.permissions, INBOX)) {
            await prisma.staffPushDevice.deleteMany({ where: { token } });
            return NextResponse.json({ ok: false });
        }
        const fields = {
            userId: Number(user.id),
            p256dh: "keys" in data ? data.keys.p256dh : null,
            auth: "keys" in data ? data.keys.auth : null,
            userAgent: req.headers.get("user-agent")?.slice(0, 300) ?? null,
            lastSeenAt: new Date(),
        };
        await prisma.staffPushDevice.upsert({ where: { token }, create: { token, ...fields }, update: fields });
        return NextResponse.json({ ok: true });
    } catch (e) {
        return handleApiError(e, "Failed to turn on notifications");
    }
}

export async function DELETE(req: Request) {
    const { user, response } = await requireAuth();
    if (response) return response;
    const { data, error } = await validateRequest(req, schema);
    if (error) return error;

    try {
        await prisma.staffPushDevice.deleteMany({ where: { token: tokenOf(data), userId: Number(user.id) } });
        return NextResponse.json({ ok: true });
    } catch (e) {
        return handleApiError(e, "Failed to turn off notifications");
    }
}
