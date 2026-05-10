import type { PrismaClient } from "@/generated/prisma/client";

export const ORDERS_PIPELINE_NAME = "sales-orders" as const;

/** Status label that triggers auto-invoice creation. */
export const CONFIRMED_STATUS_LABEL = "Confirmed" as const;

export async function getOrdersPipeline(prisma: PrismaClient) {
    return prisma.pipeline.findUnique({
        where: { name: ORDERS_PIPELINE_NAME },
        include: {
            statuses: { orderBy: { order: "asc" } },
        },
    });
}

export async function assertOrdersStatus(
    prisma: PrismaClient,
    pipelineId: string,
    statusId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
    const st = await prisma.ticketStatus.findUnique({
        where: { id: statusId },
        select: { id: true, pipelineId: true },
    });
    if (!st || st.pipelineId !== pipelineId) {
        return { ok: false, message: "Invalid status for Sales Orders pipeline" };
    }
    return { ok: true };
}
