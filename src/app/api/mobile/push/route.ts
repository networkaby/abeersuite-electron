import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { MOBILE_SCREENS, holdsScreen } from "@/modules/mobile/lib/mobileScreens";
import { PHONE_APP_HOME } from "@/shared/lib/device/phone";

/**
 * POST   /api/mobile/push — the staff phone app hands over its Firebase token
 *        each time it opens (StaffPushRegister). Saved only while the person
 *        holds the Inbox tick; without it the phone is forgotten instead, so a
 *        tick taken away stops the notifications the next time the app opens.
 * DELETE /api/mobile/push — forget this phone (sign-out).
 * Sending: push/staffPush.ts.
 */

const schema = z.object({ token: z.string().min(20).max(4096) });
const INBOX = MOBILE_SCREENS.find((s) => s.href === `${PHONE_APP_HOME}/inbox`)!;

export async function POST(req: Request) {
    const { user, response } = await requireAuth();
    if (response) return response;
    const { data, error } = await validateRequest(req, schema);
    if (error) return error;

    try {
        if (!holdsScreen(user.permissions, INBOX)) {
            await prisma.staffPushDevice.deleteMany({ where: { token: data.token } });
            return NextResponse.json({ ok: false });
        }
        const fields = {
            userId: Number(user.id),
            userAgent: req.headers.get("user-agent")?.slice(0, 300) ?? null,
            lastSeenAt: new Date(),
        };
        await prisma.staffPushDevice.upsert({ where: { token: data.token }, create: { token: data.token, ...fields }, update: fields });
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
        await prisma.staffPushDevice.deleteMany({ where: { token: data.token, userId: Number(user.id) } });
        return NextResponse.json({ ok: true });
    } catch (e) {
        return handleApiError(e, "Failed to turn off notifications");
    }
}
