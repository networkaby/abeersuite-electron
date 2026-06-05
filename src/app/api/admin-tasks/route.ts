import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { createTaskSchema } from "@/shared/lib/schemas/taskSchema";
import { buildTaskActor } from "@/modules/administration/lib/taskActor";

/** Administration work board rides the seeded internal-management pipeline. */
const ADMIN_PIPELINE_ID = "P4";

/** Position the task is assigned to + its current live holders (resolved via
 *  UserPosition), so the board can show who'll actually do the work. */
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
    _count: { select: { comments: true } },
} as const;

export async function GET(req: Request) {
    const { response } = await requirePermission(PERMISSIONS.ADMINISTRATION_TASKS_VIEW);
    if (response) return response;
    try {
        const { searchParams } = new URL(req.url);
        const pipelineId = searchParams.get("pipelineId") ?? ADMIN_PIPELINE_ID;
        const tasks = await prisma.task.findMany({
            where: { pipelineId },
            orderBy: [{ order: "asc" }, { createdAt: "desc" }],
            select: TASK_SELECT,
        });
        return NextResponse.json(tasks);
    } catch (e) {
        return handleApiError(e, "Failed to fetch tasks");
    }
}

export async function POST(req: Request) {
    const { user, response } = await requirePermission(PERMISSIONS.ADMINISTRATION_TASKS_MANAGE);
    if (response) return response;
    try {
        const { data, error } = await validateRequest(req, createTaskSchema);
        if (error) return error;

        const pipelineId = data.pipelineId ?? ADMIN_PIPELINE_ID;

        // New tasks land on the pipeline's entry-point stage (e.g. P4 → "Open").
        const entry = await prisma.ticketStatus.findFirst({
            where: { pipelineId, isEntryPoint: true },
            orderBy: { order: "asc" },
            select: { id: true },
        });
        if (!entry) {
            return NextResponse.json(
                { error: `Pipeline "${pipelineId}" has no entry-point stage configured` },
                { status: 400 },
            );
        }

        const task = await prisma.task.create({
            data: {
                title: data.title,
                description: data.description ?? null,
                category: data.category ?? null,
                priority: data.priority ?? "MEDIUM",
                pipelineId,
                status: entry.id,
                assignedPositionId: data.assignedPositionId ?? null,
                dueDate: data.dueDate ? new Date(data.dueDate) : null,
                createdBy: await buildTaskActor(user.id),
            },
            select: TASK_SELECT,
        });
        return NextResponse.json(task, { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to create task");
    }
}
