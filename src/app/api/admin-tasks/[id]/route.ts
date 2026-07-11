import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireModuleAccess } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { updateTaskSchema } from "@/shared/lib/schemas/taskSchema";
import { buildTaskActor } from "@/modules/administration/lib/taskActor";
import { TASK_TICKET_SELECT, flattenTask } from "../route";

// Task + its comment timeline. Comments are TicketLog rows now (body ← note).
const TASK_DETAIL_SELECT = {
    ...TASK_TICKET_SELECT,
    logs: {
        orderBy: { createdAt: "asc" as const },
        select: { id: true, note: true, kind: true, createdAt: true, author: true },
    },
} as const;

type LogRow = { id: number; note: string | null; kind: string; createdAt: Date; author: unknown };

function flattenTaskDetail(t: { logs: LogRow[] } & Parameters<typeof flattenTask>[0]) {
    return {
        ...flattenTask(t),
        comments: t.logs.map((l) => ({ id: l.id, body: l.note, kind: l.kind, createdAt: l.createdAt, author: l.author })),
    };
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requireModuleAccess("administration");
    if (response) return response;
    const { id } = await params;
    try {
        const task = await prisma.ticket.findUnique({ where: { id: Number(id) }, select: TASK_DETAIL_SELECT });
        if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
        return NextResponse.json(flattenTaskDetail(task));
    } catch (e) {
        return handleApiError(e, "Failed to fetch task");
    }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { user, response } = await requireModuleAccess("administration");
    if (response) return response;
    const { id } = await params;
    const taskId = Number(id);
    try {
        const { data, error } = await validateRequest(req, updateTaskSchema);
        if (error) return error;

        const existing = await prisma.ticket.findUnique({
            where: { id: taskId },
            select: { id: true, pipelineId: true, status: true, assignedPositionId: true },
        });
        if (!existing) return NextResponse.json({ error: "Task not found" }, { status: 404 });

        // If the stage is changing, validate the target belongs to this pipeline
        // and decide whether the task is now complete (terminal stage).
        let completedAt: Date | null | undefined;
        let statusChangeNote: string | undefined;
        if (data.status && data.status !== existing.status) {
            const target = await prisma.ticketStatus.findFirst({
                where: { id: data.status, pipelineId: existing.pipelineId },
                select: { id: true, label: true, isTerminal: true },
            });
            if (!target) {
                return NextResponse.json(
                    { error: "Target stage is not part of this task's pipeline" },
                    { status: 400 },
                );
            }
            completedAt = target.isTerminal ? new Date() : null;
            statusChangeNote = `Moved to "${target.label}"`;
        }

        const positionChanging =
            data.assignedPositionId !== undefined &&
            data.assignedPositionId !== existing.assignedPositionId;

        // Resolve the target seat's title up-front for the SYSTEM activity note.
        let newPositionTitle: string | null = null;
        if (positionChanging && data.assignedPositionId) {
            const pos = await prisma.position.findUnique({
                where: { id: data.assignedPositionId },
                select: { title: true },
            });
            if (!pos) {
                return NextResponse.json({ error: "Assigned position not found" }, { status: 400 });
            }
            newPositionTitle = pos.title;
        }

        const task = await prisma.ticket.update({
            where: { id: taskId },
            data: {
                ...(data.title !== undefined ? { title: data.title } : {}),
                ...(data.description !== undefined ? { notes: data.description ?? null } : {}),
                ...(data.category !== undefined ? { category: data.category ?? null } : {}),
                ...(data.priority !== undefined ? { priority: data.priority } : {}),
                ...(data.assignedPositionId !== undefined ? { assignedPositionId: data.assignedPositionId ?? null } : {}),
                ...(data.dueDate !== undefined ? { dueAt: data.dueDate ? new Date(data.dueDate) : null } : {}),
                ...(data.status !== undefined ? { status: data.status } : {}),
                ...(completedAt !== undefined ? { closedAt: completedAt } : {}),
            },
            select: TASK_TICKET_SELECT,
        });

        // Log status / assignment changes as SYSTEM activity entries (TicketLog).
        const systemNotes: string[] = [];
        if (statusChangeNote) systemNotes.push(statusChangeNote);
        if (positionChanging) {
            systemNotes.push(
                data.assignedPositionId
                    ? `Assigned to ${newPositionTitle}`
                    : "Unassigned",
            );
        }
        if (systemNotes.length > 0) {
            const author = await buildTaskActor(user.id);
            await prisma.ticketLog.createMany({
                data: systemNotes.map((body) => ({ ticketId: taskId, author, note: body, kind: "SYSTEM" as const })),
            });
        }

        return NextResponse.json(flattenTask(task));
    } catch (e) {
        return handleApiError(e, "Failed to update task");
    }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requireModuleAccess("administration");
    if (response) return response;
    const { id } = await params;
    try {
        const existing = await prisma.ticket.findUnique({ where: { id: Number(id) }, select: { id: true } });
        if (!existing) return NextResponse.json({ error: "Task not found" }, { status: 404 });
        await prisma.ticket.delete({ where: { id: Number(id) } });
        return NextResponse.json({ ok: true });
    } catch (e) {
        return handleApiError(e, "Failed to delete task");
    }
}
