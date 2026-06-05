import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { updateTaskSchema } from "@/shared/lib/schemas/taskSchema";
import { buildTaskActor } from "@/modules/administration/lib/taskActor";

const ASSIGNED_POSITION_SELECT = {
    select: {
        id: true,
        title: true,
        branch: { select: { name: true } },
        department: { select: { name: true } },
        holders: { select: { user: { select: { id: true, name: true, avatarUrl: true, role: true } } } },
    },
} as const;

const TASK_SELECT = {
    id: true,
    title: true,
    description: true,
    category: true,
    priority: true,
    pipelineId: true,
    status: true,
    assignedPositionId: true,
    createdBy: true, // JSON actor snapshot
    dueDate: true,
    completedAt: true,
    order: true,
    createdAt: true,
    updatedAt: true,
    ticketStatus: { select: { id: true, label: true, color: true, order: true, isTerminal: true } },
    assignedPosition: ASSIGNED_POSITION_SELECT,
    comments: {
        orderBy: { createdAt: "asc" },
        select: {
            id: true,
            body: true,
            kind: true,
            createdAt: true,
            author: true, // JSON actor snapshot
        },
    },
    _count: { select: { comments: true } },
} as const;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.ADMINISTRATION_TASKS_VIEW);
    if (response) return response;
    const { id } = await params;
    try {
        const task = await prisma.task.findUnique({ where: { id }, select: TASK_SELECT });
        if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
        return NextResponse.json(task);
    } catch (e) {
        return handleApiError(e, "Failed to fetch task");
    }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { user, response } = await requirePermission(PERMISSIONS.ADMINISTRATION_TASKS_MANAGE);
    if (response) return response;
    const { id } = await params;
    try {
        const { data, error } = await validateRequest(req, updateTaskSchema);
        if (error) return error;

        const existing = await prisma.task.findUnique({
            where: { id },
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

        const task = await prisma.task.update({
            where: { id },
            data: {
                ...(data.title !== undefined ? { title: data.title } : {}),
                ...(data.description !== undefined ? { description: data.description ?? null } : {}),
                ...(data.category !== undefined ? { category: data.category ?? null } : {}),
                ...(data.priority !== undefined ? { priority: data.priority } : {}),
                ...(data.assignedPositionId !== undefined ? { assignedPositionId: data.assignedPositionId ?? null } : {}),
                ...(data.dueDate !== undefined ? { dueDate: data.dueDate ? new Date(data.dueDate) : null } : {}),
                ...(data.status !== undefined ? { status: data.status } : {}),
                ...(completedAt !== undefined ? { completedAt } : {}),
            },
            select: TASK_SELECT,
        });

        // Log status / assignment changes as SYSTEM activity entries.
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
            await prisma.taskComment.createMany({
                data: systemNotes.map((body) => ({ taskId: id, author, body, kind: "SYSTEM" as const })),
            });
        }

        return NextResponse.json(task);
    } catch (e) {
        return handleApiError(e, "Failed to update task");
    }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.ADMINISTRATION_TASKS_MANAGE);
    if (response) return response;
    const { id } = await params;
    try {
        const existing = await prisma.task.findUnique({ where: { id }, select: { id: true } });
        if (!existing) return NextResponse.json({ error: "Task not found" }, { status: 404 });
        await prisma.task.delete({ where: { id } });
        return NextResponse.json({ ok: true });
    } catch (e) {
        return handleApiError(e, "Failed to delete task");
    }
}
