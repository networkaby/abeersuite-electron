import { prisma } from "@/shared/lib/prisma/prismaClient";
import { Prisma } from "@/generated/prisma/client";

/**
 * Frozen audit snapshot of *who* performed an action, stored as a JSON column
 * (NOT a User FK). Lets ownership ride a Position while the action history still
 * survives staff turnover / renames. Shared by the Administration work board
 * (`Task.createdBy` / `TaskComment.author`) and the Deals module (`Deal.createdBy` /
 * `DealActivity.author`).
 */
export interface ActorSnapshot {
    userId: number;
    userName: string;
    avatarUrl?: string | null;
    positionId?: string | null;
    positionTitle?: string | null;
}

/**
 * Build an `ActorSnapshot` for the given user, captured with their first
 * position appointment (for display: "Akram · Branch Manager").
 *
 * Server-only (uses prisma). Returns a Prisma-JSON-compatible value so it drops
 * straight into a `Json` column.
 */
export async function buildActorSnapshot(userId: number): Promise<Prisma.InputJsonValue> {
    const u = await prisma.user.findUnique({
        where: { id: userId },
        select: {
            id: true,
            name: true,
            avatarUrl: true,
            userPositions: {
                take: 1,
                select: { position: { select: { id: true, title: true } } },
            },
        },
    });
    const pos = u?.userPositions[0]?.position ?? null;
    const actor: ActorSnapshot = {
        userId,
        userName: u?.name ?? `User #${userId}`,
        avatarUrl: u?.avatarUrl ?? null,
        positionId: pos?.id ?? null,
        positionTitle: pos?.title ?? null,
    };
    return actor as unknown as Prisma.InputJsonValue;
}
