import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth, requireModuleAccess } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
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

// A task is a bare Ticket (flavour "task", no detail). We flatten the core Ticket back
// to the old flat Task shape (description ← notes, dueDate ← dueAt, completedAt ←
// closedAt, order ← sortOrder, comments ← logs) so the task board keeps its contract.
export const TASK_TICKET_SELECT = {
    id: true,
    title: true,
    notes: true,      // → description
    category: true,
    priority: true,
    pipelineId: true,
    status: true,
    assignedPositionId: true,
    createdBy: true,  // JSON actor snapshot
    dueAt: true,      // → dueDate
    closedAt: true,   // → completedAt
    sortOrder: true,  // → order
    createdAt: true,
    updatedAt: true,
    ticketStatus: { select: { id: true, label: true, color: true, order: true, isTerminal: true } },
    assignedPosition: ASSIGNED_POSITION_SELECT,
    _count: { select: { logs: true } },
} as const;

type TaskTicketRow = {
    id: number; title: string | null; notes: string | null; category: string | null;
    priority: string; pipelineId: string | null; status: string; assignedPositionId: string | null;
    createdBy: unknown; dueAt: Date | null; closedAt: Date | null; sortOrder: number;
    createdAt: Date; updatedAt: Date; ticketStatus: unknown; assignedPosition: unknown;
    _count: { logs: number };
};

export function flattenTask(t: TaskTicketRow) {
    return {
        id: t.id, title: t.title, description: t.notes, category: t.category, priority: t.priority,
        pipelineId: t.pipelineId, status: t.status, assignedPositionId: t.assignedPositionId,
        assignedPosition: t.assignedPosition, createdBy: t.createdBy,
        dueDate: t.dueAt, completedAt: t.closedAt, order: t.sortOrder,
        createdAt: t.createdAt, updatedAt: t.updatedAt, ticketStatus: t.ticketStatus,
        _count: { comments: t._count.logs },
    };
}

export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const { searchParams } = new URL(req.url);
        const pipelineId = searchParams.get("pipelineId") ?? ADMIN_PIPELINE_ID;
        const tasks = await prisma.ticket.findMany({
            where: { pipelineId },
            orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
            select: TASK_TICKET_SELECT,
        });
        return NextResponse.json(tasks.map(flattenTask));
    } catch (e) {
        return handleApiError(e, "Failed to fetch tasks");
    }
}

export async function POST(req: Request) {
    const { user, response } = await requireModuleAccess("administration");
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

        const task = await prisma.ticket.create({
            data: {
                title: data.title,
                notes: data.description ?? null,
                category: data.category ?? null,
                priority: data.priority ?? "MEDIUM",
                pipelineId,
                status: entry.id,
                assignedPositionId: data.assignedPositionId ?? null,
                dueAt: data.dueDate ? new Date(data.dueDate) : null,
                createdBy: await buildTaskActor(user.id),
            },
            select: TASK_TICKET_SELECT,
        });
        return NextResponse.json(flattenTask(task), { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to create task");
    }
}
