import { prisma } from "@/shared/lib/prisma/prismaClient";

/**
 * The entry sub-status for a main status = the lowest-order sub-status that has
 * an entry-point transition (`SubStatusTransition` with `fromSubStatusId: null`)
 * AND is applicable to that status. This is the one the settings UI badges as
 * "Auto-applied on entry".
 *
 * Returns the sub-status `{ id, label }` to auto-apply when a ticket enters
 * `statusId`, or `null` if none is configured.
 */
export async function findEntrySubStatus(
    statusId: string
): Promise<{ id: string; label: string } | null> {
    const entryRows = await prisma.subStatusTransition.findMany({
        where: { fromSubStatusId: null, to: { applicableStatusIds: { has: statusId } } },
        include: { to: { select: { id: true, label: true, order: true } } },
    });
    const entrySub = entryRows.map((r) => r.to).sort((a, b) => a.order - b.order)[0];
    return entrySub ? { id: entrySub.id, label: entrySub.label } : null;
}
