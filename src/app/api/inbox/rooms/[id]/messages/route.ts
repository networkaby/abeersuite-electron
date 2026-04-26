import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth-guard";
import { createRoomMessage, getAccessibleRoom, markRoomRead } from "@/lib/inbox";
import { prisma } from "@/lib/prisma";

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

        const parsed = messageSchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid message payload" }, { status: 400 });
        }

        const message = await createRoomMessage({
            roomId: room.id,
            senderUserId: user.id,
            messageType: "USER",
            title: parsed.data.title || null,
            body: parsed.data.body,
        });

        await markRoomRead(user.id, room.id, message.createdAt);
        return NextResponse.json(message, { status: 201 });
    } catch (error) {
        console.error("[inbox room messages POST]", error);
        return NextResponse.json({ error: "Failed to send message" }, { status: 500 });
    }
}
