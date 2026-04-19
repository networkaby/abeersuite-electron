import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth-guard";
import type { Session } from "next-auth";

// POST /api/tasks/[id]/pickup
export async function POST(
    _: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { response, session } = await requirePermission("tasks:pickup") as
        { response: null; session: Session } | { response: NextResponse; session: null };
    if (response) return response;

    const userId = Number((session.user as { id?: string }).id);
    const { id } = await params;
    const taskId = Number(id);

    try {
        const task = await prisma.task.findUnique({
            where: { id: taskId },
            select: { assignedToId: true, pickedUpById: true, status: true },
        });

        if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
        if (task.pickedUpById) return NextResponse.json({ error: "Already picked up" }, { status: 409 });
        if (task.status === "done" || task.status === "cancelled") {
            return NextResponse.json({ error: "Task is already closed" }, { status: 409 });
        }

        await prisma.task.update({
            where: { id: taskId },
            data: { pickedUpById: userId, pickedUpAt: new Date(), status: "in_progress" },
        });

        await prisma.taskLog.create({
            data: { taskId, action: "picked_up", byUserId: userId },
        });

        return NextResponse.json({ ok: true });
    } catch (error) {
        console.error(error);
        return NextResponse.json({ error: "Failed to pick up task" }, { status: 500 });
    }
}
