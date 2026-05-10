import type { PrismaClient } from "@/generated/prisma/client";

export const REPAIR_PIPELINE_NAME = "service" as const;

export async function getRepairPipeline(prisma: PrismaClient) {
    return prisma.pipeline.findUnique({
        where: { name: REPAIR_PIPELINE_NAME },
        select: { id: true, label: true, color: true },
    });
}
