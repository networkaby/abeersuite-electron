import { prisma } from "@/shared/lib/prisma/prismaClient";

/**
 * The entry worker for a main status = the one hand-picked on that status
 * (`TicketStatus.startWorkerId`), auto-applied when a ticket enters the status.
 * This replaces the old global "lowest-order entry-point wins" heuristic, which
 * picked the wrong worker when one applied to several statuses.
 *
 * Returns the worker `{ id, label }` to auto-apply when a ticket enters
 * `statusId`, or `null` if none is configured.
 */
export async function findEntryWorker(
    statusId: string
): Promise<{ id: string; label: string } | null> {
    const status = await prisma.ticketStatus.findUnique({
        where: { id: statusId },
        select: { startWorker: { select: { id: true, label: true } } },
    });
    return status?.startWorker ?? null;
}
