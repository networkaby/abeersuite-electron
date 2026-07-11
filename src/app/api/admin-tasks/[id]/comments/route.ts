import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireModuleAccess } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { createTaskCommentSchema } from "@/shared/lib/schemas/taskSchema";
import { buildTaskActor } from "@/modules/administration/lib/taskActor";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    // Any viewer of the board may comment.
    const { user, response } = await requireModuleAccess("administration");
    if (response) return response;
    const { id } = await params;
    try {
        const { data, error } = await validateRequest(req, createTaskCommentSchema);
        if (error) return error;

        const taskId = Number(id);
        const task = await prisma.ticket.findUnique({ where: { id: taskId }, select: { id: true } });
        if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });

        // A task comment is a TicketLog (body → note).
        const comment = await prisma.ticketLog.create({
            data: { ticketId: taskId, author: await buildTaskActor(user.id), note: data.body, kind: "COMMENT" },
            select: {
                id: true,
                note: true,
                kind: true,
                createdAt: true,
                author: true, // JSON actor snapshot
            },
        });
        return NextResponse.json({ ...comment, body: comment.note, note: undefined }, { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to add comment");
    }
}
