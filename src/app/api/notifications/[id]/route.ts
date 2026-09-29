import { requireAuth } from "@/shared/lib/auth/permissions";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { markRoomRead } from "@/modules/message/lib/inbox";
import { NextResponse } from "next/server";

export async function PATCH(
    _req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { user, response } = await requireAuth();
    if (response) return response;

    const { id } = await params;

    const message = await prisma.chatMessage.findFirst({
        where: {
            id: Number(id),
            room: { key: `system:${user.id}` },
        },
        select: { createdAt: true, roomId: true },
    });
    if (!message) {
        return NextResponse.json({ error: "Notification not found" }, { status: 404 });
    }

    await markRoomRead(user.id, message.roomId, message.createdAt);
    return NextResponse.json({ ok: true });
}
