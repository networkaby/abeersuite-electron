import { prisma, prismaWhereSaved } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth, hasPermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { buildActorSnapshot } from "@/shared/lib/auth/actorSnapshot";
import { z } from "zod";

// Dev-only manual override — a raw escape hatch for a stuck ticket. Unlike the
// normal worker/status routes this does NO routing: no triggerMap, no entry
// worker, no retry schedule, no autoAdvance. It just slams the ticket onto the
// chosen (status, worker) pair so a developer/admin can unstick a pipeline that
// has no configured route out. Gated on admin:bypass / settings:manage (same as
// the dev context panel on the ticket page).
const overrideSchema = z.object({
    // At least one of these must be present (enforced below).
    status: z.string().trim().min(1).optional(),
    // null = clear the worker; omitted = leave it unchanged.
    workerId: z.string().trim().min(1).nullable().optional(),
});

export async function PATCH(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { user, response } = await requireAuth();
        if (response) return response;
        if (!hasPermission(user, PERMISSIONS.ADMIN_BYPASS) && !hasPermission(user, PERMISSIONS.SETTINGS_MANAGE)) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        const { id } = await params;
        const ticketId = Number(id);

        const { data, error } = await validateRequest(req, overrideSchema);
        if (error) return error;
        const { status, workerId } = data;
        if (status === undefined && workerId === undefined) {
            return NextResponse.json({ error: "Nothing to override — provide a status and/or worker" }, { status: 400 });
        }

        const ticket = await prismaWhereSaved().ticket.findUnique({
            where: { id: ticketId },
            select: { id: true, status: true, workerId: true },
        });
        if (!ticket) return NextResponse.json({ error: "Ticket not found" }, { status: 404 });

        // Resolve labels (and validate existence) for the audit log.
        const newStatusId = status ?? ticket.status;
        const targetStatus = await prisma.ticketStatus.findUnique({
            where: { id: newStatusId },
            select: { label: true },
        });
        if (!targetStatus) return NextResponse.json({ error: "Status not found" }, { status: 404 });

        const newWorkerId = workerId === undefined ? ticket.workerId : workerId;
        let workerLabel: string | null = null;
        if (newWorkerId) {
            const w = await prisma.ticketWorker.findUnique({
                where: { id: newWorkerId },
                select: { label: true },
            });
            if (!w) return NextResponse.json({ error: "Worker not found" }, { status: 404 });
            workerLabel = w.label;
        }

        const author = await buildActorSnapshot(user.id);
        await prisma.$transaction(async (tx) => {
            // Raw set + clear the work-runtime: snooze + retry counters. Unsticks a
            // ticket frozen "in progress" and shows the landed worker as a fresh To-do.
            await tx.ticket.update({
                where: { id: ticketId },
                data: {
                    status: newStatusId,
                    workerId: newWorkerId,
                    wakeAt: null,
                    retryCount: 0,
                    retryKeyId: null,
                    updatedAt: new Date(),
                },
            });
            await tx.ticketLog.create({
                data: {
                    ticketId,
                    status: newStatusId,
                    workerId: newWorkerId,
                    note: `⚙ Manual override (dev) — ${targetStatus.label}${workerLabel ? ` › ${workerLabel}` : " (no worker)"}`,
                    author,
                },
            });
        });

        return NextResponse.json({ ok: true });
    } catch (e) {
        return handleApiError(e, "Failed to override ticket");
    }
}
