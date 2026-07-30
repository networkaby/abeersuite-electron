import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth, requireModuleAccess, requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { updateTaskRecurrenceSchema } from "@/shared/lib/schemas/taskRecurrenceSchema";
import { runTaskRecurrences } from "@/modules/administration/lib/runTaskRecurrences";
import { RECURRENCE_SELECT, flattenRecurrence } from "../route";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requireAuth();
    if (response) return response;
    const { id } = await params;
    try {
        const row = await prisma.taskRecurrence.findUnique({
            where: { id: Number(id) },
            select: RECURRENCE_SELECT,
        });
        if (!row) return NextResponse.json({ error: "Recurring task not found" }, { status: 404 });
        return NextResponse.json(flattenRecurrence(row));
    } catch (e) {
        return handleApiError(e, "Failed to fetch recurring task");
    }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requireModuleAccess("administration");
    if (response) return response;
    const { id } = await params;
    const recurrenceId = Number(id);
    try {
        const { data, error } = await validateRequest(req, updateTaskRecurrenceSchema);
        if (error) return error;

        const existing = await prisma.taskRecurrence.findUnique({
            where: { id: recurrenceId },
            select: {
                id: true, lastOccurrenceNo: true, unit: true, every: true,
                anchorAt: true, isActive: true, totalCount: true, endedAt: true,
            },
        });
        if (!existing) return NextResponse.json({ error: "Recurring task not found" }, { status: 404 });

        // The schedule is the anchor of every occurrence already generated —
        // changing it after the fact would silently reinterpret history (which
        // month was "#3"?). Once generation has started, the schedule is frozen.
        const scheduleChanging =
            (data.unit !== undefined && data.unit !== existing.unit) ||
            (data.every !== undefined && data.every !== existing.every) ||
            (data.anchorAt !== undefined && new Date(data.anchorAt).getTime() !== existing.anchorAt.getTime());
        if (scheduleChanging && existing.lastOccurrenceNo > 0) {
            return NextResponse.json(
                {
                    error: "Tasks have already been generated, so the repeat schedule cannot be changed. "
                        + "Stop this one and create a new recurring task instead.",
                },
                { status: 400 },
            );
        }

        // Shrinking the count to at-or-below what is already generated finishes the
        // run here and now — otherwise it would sit "active" for ever producing
        // nothing. Raising it again on a finished one reopens it.
        const nextTotal = data.totalCount !== undefined ? data.totalCount ?? null : existing.totalCount;
        const reached = nextTotal !== null && existing.lastOccurrenceNo >= nextTotal;
        const endedAt = reached
            ? existing.endedAt ?? new Date()
            : existing.endedAt !== null ? null : undefined;

        const updated = await prisma.taskRecurrence.update({
            where: { id: recurrenceId },
            data: {
                ...(endedAt !== undefined ? { endedAt } : {}),
                ...(data.title !== undefined ? { title: data.title } : {}),
                ...(data.description !== undefined ? { notes: data.description ?? null } : {}),
                ...(data.category !== undefined ? { category: data.category ?? null } : {}),
                ...(data.priority !== undefined ? { priority: data.priority } : {}),
                ...(data.assignedPositionId !== undefined ? { assignedPositionId: data.assignedPositionId ?? null } : {}),
                ...(data.unit !== undefined ? { unit: data.unit } : {}),
                ...(data.every !== undefined ? { every: data.every } : {}),
                ...(data.totalCount !== undefined ? { totalCount: data.totalCount ?? null } : {}),
                ...(data.anchorAt !== undefined ? { anchorAt: new Date(data.anchorAt) } : {}),
                ...(data.leadDays !== undefined ? { leadDays: data.leadDays } : {}),
                ...(data.amountPaise !== undefined ? { amountPaise: data.amountPaise ?? null } : {}),
                ...(data.accountId !== undefined ? { accountId: data.accountId ?? null } : {}),
                ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
            },
            select: RECURRENCE_SELECT,
        });

        // Resuming a paused (or reopened) recurrence should catch up straight away.
        if ((data.isActive === true && !existing.isActive) || (existing.endedAt !== null && !reached)) {
            await runTaskRecurrences().catch(() => { });
        }

        return NextResponse.json(flattenRecurrence(updated));
    } catch (e) {
        return handleApiError(e, "Failed to update recurring task");
    }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    // Delete needs the delete rung, not just the module's sidebar link.
    const { response } = await requirePermission(PERMISSIONS.TASKS_DELETE);
    if (response) return response;
    const { id } = await params;
    try {
        const existing = await prisma.taskRecurrence.findUnique({
            where: { id: Number(id) },
            select: { id: true, _count: { select: { tickets: true } } },
        });
        if (!existing) return NextResponse.json({ error: "Recurring task not found" }, { status: 404 });

        // Ticket.recurrenceId is onDelete: SetNull — the tasks already generated
        // stay on the board as history, they just stop showing the repeat chip.
        await prisma.taskRecurrence.delete({ where: { id: Number(id) } });
        return NextResponse.json({ ok: true, keptTasks: existing._count.tickets });
    } catch (e) {
        return handleApiError(e, "Failed to delete recurring task");
    }
}
