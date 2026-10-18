import type { PrismaClient } from "@/generated/prisma/client";

/** Stable slug; id is P2 after seed but resolve by name for safety. */
export const HELP_PIPELINE_NAME = "help-desk" as const;

/** The front-desk Help Desk pipeline (flavour "help") + its stages, order-sorted. */
export async function getHelpPipeline(prisma: PrismaClient) {
    return prisma.pipeline.findUnique({
        where: { name: HELP_PIPELINE_NAME },
        include: { statuses: { orderBy: { order: "asc" } } },
    });
}
