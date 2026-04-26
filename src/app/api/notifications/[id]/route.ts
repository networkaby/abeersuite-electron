import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { markRoomRead } from "@/lib/inbox";
import { NextResponse } from "next/server";

export async function PATCH(
    _req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const userId = Number((session.user as { id?: string }).id ?? "0");
    const { id } = await params;

    const message = await prisma.chatMessage.findFirst({
        where: {
            id: Number(id),
            room: { key: `system:${userId}` },
        },
        select: { createdAt: true, roomId: true },
    });
    if (!message) {
        return NextResponse.json({ error: "Notification not found" }, { status: 404 });
    }

    await markRoomRead(userId, message.roomId, message.createdAt);
    return NextResponse.json({ ok: true });
}
