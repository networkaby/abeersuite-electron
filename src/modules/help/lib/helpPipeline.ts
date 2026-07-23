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

/** The terminal (Closed) stage of the Help Desk pipeline — where a closed / converted
 *  ticket lands. Falls back to the last stage if none is flagged terminal. */
export function helpClosedStage(
    statuses: { id: string; isTerminal: boolean; order: number }[],
): { id: string } | null {
    const terminal = statuses.filter((s) => s.isTerminal).sort((a, b) => a.order - b.order)[0];
    return terminal ?? statuses[statuses.length - 1] ?? null;
}
