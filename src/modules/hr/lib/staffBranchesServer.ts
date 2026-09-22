import "server-only";

import { prisma } from "@/shared/lib/prisma/prismaClient";

/**
 * Which branches a person belongs to — through the seats they hold
 * (UserPosition → Position.branchId), the same rule /api/branches counts by.
 * A seat with no branch is org-wide and names none. A person with no seats
 * belongs to no branch, so only the org-wide holidays reach them.
 *
 * Read for the holiday rule (`holidayApplies` in attendanceCalendar.ts): a
 * holiday with a branch is a holiday for that branch's people and nobody else.
 */

/** The `select` that brings a user's branch ids in on a User query. */
export const USER_BRANCHES_SELECT = {
    userPositions: { select: { position: { select: { branchId: true } } } },
} as const;

type WithPositions = { userPositions: { position: { branchId: string | null } }[] };

/** Distinct branch ids off a User row read with USER_BRANCHES_SELECT. */
export function branchIdsFrom(u: WithPositions): string[] {
    return [...new Set(u.userPositions.map((p) => p.position.branchId).filter((b): b is string => !!b))];
}

/** One person's branch ids, when the caller has no User row in hand. */
export async function userBranchIds(userId: number): Promise<string[]> {
    const rows = await prisma.userPosition.findMany({
        where: { userId },
        select: { position: { select: { branchId: true } } },
    });
    return branchIdsFrom({ userPositions: rows });
}
