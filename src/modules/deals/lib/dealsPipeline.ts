import type { PrismaClient, Prisma } from "@/generated/prisma/client";

/** Stable slug; id is P6 after seed but resolve by name for safety. */
export const DEALS_PIPELINE_NAME = "deals" as const;

/**
 * Find the most recent OPEN (non-terminal) deal for a party, so a repeat signal
 * (e.g. another POS estimate for the same customer) appends to the live deal
 * instead of spawning a duplicate. Returns null when the party is anonymous or
 * has no open deal. Terminal stages (Won / Lost) are excluded via
 * `ticketStatus.isTerminal`, so we don't reopen a closed deal.
 */
export async function findOpenDealForParty(
    db: PrismaClient | Prisma.TransactionClient,
    party: { personId?: number | null; companyId?: number | null },
): Promise<{ id: number } | null> {
    if (party.personId == null && party.companyId == null) return null;
    return db.deal.findFirst({
        where: {
            ...(party.personId != null ? { personId: party.personId } : {}),
            ...(party.companyId != null ? { companyId: party.companyId } : {}),
            ticketStatus: { isTerminal: false },
        },
        orderBy: { createdAt: "desc" },
        select: { id: true },
    });
}

export async function getDealsPipeline(prisma: PrismaClient) {
    return prisma.pipeline.findUnique({
        where: { name: DEALS_PIPELINE_NAME },
        include: {
            statuses: { orderBy: { order: "asc" } },
        },
    });
}

export async function assertDealStatus(
    prisma: PrismaClient,
    pipelineId: string,
    statusId: string
): Promise<{ ok: true } | { ok: false; message: string }> {
    const st = await prisma.ticketStatus.findUnique({
        where: { id: statusId },
        select: { id: true, pipelineId: true },
    });
    if (!st || st.pipelineId !== pipelineId) {
        return { ok: false, message: "Invalid status for Deals pipeline" };
    }
    return { ok: true };
}
