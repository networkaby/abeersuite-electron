import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { handleApiError } from "@/shared/lib/api";

/**
 * "I have looked at the Work Inbox now." WorkInboxBoard posts this on mount, which
 * resets the sidebar badge's `new` half — work arriving after this instant is new again.
 */
export async function POST() {
    const { user, response } = await requireAuth();
    if (response) return response;

    try {
        await prisma.user.update({
            where: { id: user.id },
            data: { workInboxSeenAt: new Date() },
        });
        return NextResponse.json({ ok: true });
    } catch (e) {
        return handleApiError(e, "Failed to mark work inbox seen");
    }
}
