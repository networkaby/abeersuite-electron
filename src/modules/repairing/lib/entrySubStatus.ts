import { prisma } from "@/shared/lib/prisma/prismaClient";

/**
 * The entry sub-status for a main status = the one hand-picked on that status
 * (`TicketStatus.startSubStatusId`), auto-applied when a ticket enters the status.
 * This replaces the old global "lowest-order entry-point wins" heuristic, which
 * picked the wrong sub-status when one applied to several statuses.
 *
 * Returns the sub-status `{ id, label }` to auto-apply when a ticket enters
 * `statusId`, or `null` if none is configured.
 */
export async function findEntrySubStatus(
    statusId: string
): Promise<{ id: string; label: string } | null> {
    const status = await prisma.ticketStatus.findUnique({
        where: { id: statusId },
        select: { startSubStatus: { select: { id: true, label: true } } },
    });
    return status?.startSubStatus ?? null;
}
