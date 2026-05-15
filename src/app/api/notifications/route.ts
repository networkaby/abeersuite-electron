import { prisma } from "@/shared/lib/prisma/prismaClient";
import { ensureCoreRoomsForUser, markRoomRead } from "@/modules/message/lib/inbox";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";

export async function GET() {
    const { user, response } = await requireAuth();
    if (response) return response;

    await ensureCoreRoomsForUser({ id: user.id, roles: user.roles });
    const room = await prisma.chatRoom.findUnique({
        where: { key: `system:${user.id}` },
        include: {
            members: {
                where: { userId: user.id },
                select: { lastReadAt: true },
            },
            messages: {
                orderBy: { createdAt: "desc" },
                take: 25,
            },
        },
    });

    const lastReadAt = room?.members[0]?.lastReadAt ?? null;
    const notifications = (room?.messages ?? []).map((message) => ({
        id: message.id,
        message: message.title ? `${message.title}: ${message.body}` : message.body,
        type: message.messageType,
        read: lastReadAt ? message.createdAt <= lastReadAt : false,
        createdAt: message.createdAt,
        link: message.link,
    }));

    return NextResponse.json(notifications);
}

export async function PATCH() {
    const { user, response } = await requireAuth();
    if (response) return response;

    const room = await prisma.chatRoom.findUnique({
        where: { key: `system:${user.id}` },
        select: { id: true },
    });
    if (!room) return NextResponse.json({ ok: true });

    await markRoomRead(user.id, room.id);
    return NextResponse.json({ ok: true });
}
