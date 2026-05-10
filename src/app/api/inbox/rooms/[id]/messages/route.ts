import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { getAccessibleRoom, markRoomRead } from "@/modules/message/lib/inbox";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { validateRequest } from "@/shared/lib/api";

const messageSchema = z.object({
    body: z.string().trim().min(1, "Message is required"),
    title: z.string().trim().optional(),
});

export async function GET(
    _req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { user, response } = await requireAuth();
    if (response) return response;

    try {
        const { id } = await params;
        const room = await getAccessibleRoom(user, id);
        if (!room) {
            return NextResponse.json({ error: "Room not found" }, { status: 404 });
        }

        const messages = await prisma.chatMessage.findMany({
            where: { roomId: room.id },
            orderBy: { createdAt: "asc" },
            include: {
                senderUser: { select: { id: true, name: true, role: true } },
            },
        });

        await markRoomRead(user.id, room.id);
        return NextResponse.json(messages);
    } catch (error) {
        console.error("[inbox room messages GET]", error);
        return NextResponse.json({ error: "Failed to load messages" }, { status: 500 });
    }
}

export async function POST(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { user, response } = await requireAuth();
    if (response) return response;

    try {
        const { id } = await params;
        const room = await getAccessibleRoom(user, id);
        if (!room) {
            return NextResponse.json({ error: "Room not found" }, { status: 404 });
        }
        if (room.type === "SYSTEM_INBOX") {
            return NextResponse.json({ error: "Cannot post to system inbox" }, { status: 403 });
        }

        const { data, error } = await validateRequest(req, messageSchema);

        if (error) return error;

        const [message] = await Promise.all([
            prisma.chatMessage.create({
                data: {
                    roomId: room.id,
                    senderUserId: user.id,
                    messageType: "USER",
                    title: data.title || null,
                    body: data.body,
                },
                include: { senderUser: { select: { id: true, name: true, role: true } } },
            }),
            prisma.chatRoom.update({
                where: { id: room.id },
                data: { updatedAt: new Date() },
            }),
        ]);

        await markRoomRead(user.id, room.id, message.createdAt);
        return NextResponse.json(message, { status: 201 });
    } catch (error) {
        console.error("[inbox room messages POST]", error);
        return NextResponse.json({ error: "Failed to send message" }, { status: 500 });
    }
}
