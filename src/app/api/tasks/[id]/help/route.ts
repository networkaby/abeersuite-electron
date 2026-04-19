import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth-guard";
import type { Session } from "next-auth";

// POST /api/tasks/[id]/help  — log assistance without ownership transfer
export async function POST(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { response, session } = await requirePermission("tasks:pickup") as
        { response: null; session: Session } | { response: NextResponse; session: null };
    if (response) return response;

    const userId = Number((session.user as { id?: string }).id);
    const { id } = await params;
    const taskId = Number(id);
    const body = await req.json().catch(() => ({})) as { note?: string };

    try {
        const task = await prisma.task.findUnique({ where: { id: taskId }, select: { id: true } });
        if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });

        await prisma.taskLog.create({
            data: { taskId, action: "helped", note: body.note ?? null, byUserId: userId },
        });

        return NextResponse.json({ ok: true });
    } catch (error) {
        console.error(error);
        return NextResponse.json({ error: "Failed to log help" }, { status: 500 });
    }
}
