import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth, requireModuleAccess } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { createTaskRecurrenceSchema } from "@/shared/lib/schemas/taskRecurrenceSchema";
import { buildTaskActor } from "@/modules/administration/lib/taskActor";
import { runTaskRecurrences, nextDueAt } from "@/modules/administration/lib/runTaskRecurrences";

/** Recurring tasks ride the same Administration pipeline as one-off tasks. */
const ADMIN_PIPELINE_ID = "P4";

const ASSIGNED_POSITION_SELECT = {
    select: {
        id: true,
        title: true,
        branch: { select: { name: true } },
        department: { select: { name: true } },
        holders: { select: { user: { select: { id: true, name: true, avatarUrl: true, role: true } } } },
    },
} as const;

export const RECURRENCE_SELECT = {
    id: true,
    title: true,
    notes: true, // → description
    category: true,
    priority: true,
    pipelineId: true,
    assignedPositionId: true,
    unit: true,
    every: true,
    totalCount: true,
    anchorAt: true,
    lastOccurrenceNo: true,
    leadDays: true,
    isActive: true,
    endedAt: true,
    amountPaise: true,
    accountId: true,
    createdBy: true,
    createdAt: true,
    updatedAt: true,
    assignedPosition: ASSIGNED_POSITION_SELECT,
    _count: { select: { tickets: true } },
} as const;

type RecurrenceRow = {
    id: number; title: string; notes: string | null; category: string | null;
    priority: string; pipelineId: string; assignedPositionId: string | null;
    unit: string; every: number; totalCount: number | null; anchorAt: Date;
    lastOccurrenceNo: number; leadDays: number; isActive: boolean; endedAt: Date | null;
    amountPaise: number | null; accountId: number | null; createdBy: unknown;
    createdAt: Date; updatedAt: Date; assignedPosition: unknown;
    _count: { tickets: number };
};

// `description` mirrors the one-off task DTO (description ← notes) so both
// dialogs speak the same field names. `nextDueAt` is computed here so the UI
// never re-implements the interval math.
export function flattenRecurrence(r: RecurrenceRow) {
    return {
        id: r.id, title: r.title, description: r.notes, category: r.category,
        priority: r.priority, pipelineId: r.pipelineId,
        assignedPositionId: r.assignedPositionId, assignedPosition: r.assignedPosition,
        unit: r.unit, every: r.every, totalCount: r.totalCount, anchorAt: r.anchorAt,
        lastOccurrenceNo: r.lastOccurrenceNo, leadDays: r.leadDays,
        isActive: r.isActive, endedAt: r.endedAt,
        amountPaise: r.amountPaise, accountId: r.accountId,
        createdBy: r.createdBy, createdAt: r.createdAt, updatedAt: r.updatedAt,
        nextDueAt: r.endedAt ? null : nextDueAt(r),
        generatedCount: r._count.tickets,
    };
}

export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        // Sweep first so the list shows a truthful progress + next-due.
        // Best-effort: generation must never 500 the page.
        await runTaskRecurrences().catch(() => { });
        const rows = await prisma.taskRecurrence.findMany({
            orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
            select: RECURRENCE_SELECT,
        });
        return NextResponse.json(rows.map(flattenRecurrence));
    } catch (e) {
        return handleApiError(e, "Failed to fetch recurring tasks");
    }
}

export async function POST(req: Request) {
    const { user, response } = await requireModuleAccess("administration");
    if (response) return response;
    try {
        const { data, error } = await validateRequest(req, createTaskRecurrenceSchema);
        if (error) return error;

        const created = await prisma.taskRecurrence.create({
            data: {
                title: data.title,
                notes: data.description ?? null,
                category: data.category ?? null,
                priority: data.priority ?? "MEDIUM",
                pipelineId: data.pipelineId ?? ADMIN_PIPELINE_ID,
                assignedPositionId: data.assignedPositionId ?? null,
                unit: data.unit,
                every: data.every,
                totalCount: data.totalCount ?? null,
                anchorAt: new Date(data.anchorAt),
                leadDays: data.leadDays,
                amountPaise: data.amountPaise ?? null,
                accountId: data.accountId ?? null,
                createdBy: await buildTaskActor(user.id),
            },
            select: RECURRENCE_SELECT,
        });

        // Materialise anything already due (e.g. a back-dated first instalment)
        // so the board reflects the new recurrence immediately.
        await runTaskRecurrences().catch(() => { });

        return NextResponse.json(flattenRecurrence(created), { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to create recurring task");
    }
}
