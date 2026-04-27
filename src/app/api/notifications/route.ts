import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ensureCoreRoomsForUser, markRoomRead } from "@/modules/message/lib/inbox";
import { NextResponse } from "next/server";

export async function GET() {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const sessionUser = session.user as {
        id?: string;
        role?: string;
        roles?: string[];
    };
    const userId = Number(sessionUser.id ?? "0");
    const roles = sessionUser.roles ?? (sessionUser.role ? [sessionUser.role] : []);

    await ensureCoreRoomsForUser({ id: userId, roles });
    const room = await prisma.chatRoom.findUnique({
        where: { key: `system:${userId}` },
        include: {
            members: {
                where: { userId },
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
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const userId = Number((session.user as { id?: string }).id ?? "0");
    const room = await prisma.chatRoom.findUnique({
        where: { key: `system:${userId}` },
        select: { id: true },
    });
    if (!room) return NextResponse.json({ ok: true });

    await markRoomRead(userId, room.id);
    return NextResponse.json({ ok: true });
}
