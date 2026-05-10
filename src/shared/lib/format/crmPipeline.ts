import type { PrismaClient } from "@/generated/prisma/client";

/** Stable slug; id is P6 after seed but resolve by name for safety. */
export const CRM_PIPELINE_NAME = "crm-leads" as const;

export async function getCrmPipeline(prisma: PrismaClient) {
    return prisma.pipeline.findUnique({
        where: { name: CRM_PIPELINE_NAME },
        include: {
            statuses: { orderBy: { order: "asc" } },
        },
    });
}

export async function assertCrmStatus(
    prisma: PrismaClient,
    pipelineId: string,
    statusId: string
): Promise<{ ok: true } | { ok: false; message: string }> {
    const st = await prisma.ticketStatus.findUnique({
        where: { id: statusId },
        select: { id: true, pipelineId: true },
    });
    if (!st || st.pipelineId !== pipelineId) {
        return { ok: false, message: "Invalid status for CRM pipeline" };
    }
    return { ok: true };
}
