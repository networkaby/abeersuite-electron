import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { checkTeamFile, getAccessibleRoom, markRoomRead, teamFilePrefix, withTeamFileLinks } from "@/modules/message/lib/inbox";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";

// A message is text, a file (uploaded first via ../upload-url), or both.
const messageSchema = z.object({
    body: z.string().trim().default(""),
    title: z.string().trim().optional(),
    file: z.object({
        key: z.string().min(1).max(300),
        type: z.string().trim().max(150),
        name: z.string().trim().min(1).max(200),
        size: z.number().int().positive(),
    }).optional(),
}).refine((d) => d.body || d.file, { message: "Message is required" });

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
        return NextResponse.json(messages.map(withTeamFileLinks));
    } catch (e) {
        return handleApiError(e, "Failed to load messages");
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
        const file = data.file;
        if (file) {
            // Only a key this room's upload-url handed out — never another room's file.
            if (!file.key.startsWith(teamFilePrefix(room.id))) return NextResponse.json({ error: "Bad file" }, { status: 400 });
            const bad = checkTeamFile(file.name, file.size);
            if (bad) return NextResponse.json({ error: bad }, { status: 400 });
        }

        const [message] = await Promise.all([
            prisma.chatMessage.create({
                data: {
                    roomId: room.id,
                    senderUserId: user.id,
                    messageType: "USER",
                    title: data.title || null,
                    body: data.body,
                    mediaKey: file?.key ?? null,
                    mediaType: file?.type || null,
                    fileName: file?.name ?? null,
                    mediaSize: file?.size ?? null,
                },
                include: { senderUser: { select: { id: true, name: true, role: true } } },
            }),
            prisma.chatRoom.update({
                where: { id: room.id },
                data: { updatedAt: new Date() },
            }),
        ]);

        await markRoomRead(user.id, room.id, message.createdAt);
        return NextResponse.json(withTeamFileLinks(message), { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to send message");
    }
}
