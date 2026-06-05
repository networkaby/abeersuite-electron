import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { createTaskCommentSchema } from "@/shared/lib/schemas/taskSchema";
import { buildTaskActor } from "@/modules/administration/lib/taskActor";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    // Any viewer of the board may comment.
    const { user, response } = await requirePermission(PERMISSIONS.ADMINISTRATION_TASKS_VIEW);
    if (response) return response;
    const { id } = await params;
    try {
        const { data, error } = await validateRequest(req, createTaskCommentSchema);
        if (error) return error;

        const task = await prisma.task.findUnique({ where: { id }, select: { id: true } });
        if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });

        const comment = await prisma.taskComment.create({
            data: { taskId: id, author: await buildTaskActor(user.id), body: data.body, kind: "COMMENT" },
            select: {
                id: true,
                body: true,
                kind: true,
                createdAt: true,
                author: true, // JSON actor snapshot
            },
        });
        return NextResponse.json(comment, { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to add comment");
    }
}
