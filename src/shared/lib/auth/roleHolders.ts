import { prisma } from "@/shared/lib/prisma/prismaClient";

/**
 * The users who CURRENTLY hold any of `roleIds`.
 *
 * A role reaches a user by two paths, and both count — the same union
 * `authorizeStaffCredentials` builds at login:
 *
 *   1. **Position appointment** — `userPositions[].position.roleTemplates[].roleId`.
 *      This is the canonical path. A user created the normal way starts with
 *      `User.role = null` and receives every duty this way.
 *   2. **`User.role`** — the manual override / cache column, populated only for
 *      users promoted directly (e.g. the bootstrap admin).
 *
 * Querying `User.role` alone — which is what `createSystemInboxNotifications` did
 * until 2026-09-04 — silently addressed nobody on a normally-seeded org, because
 * every Position-appointed user has `role = null`.
 */
export async function findUserIdsHoldingRoles(
    roleIds: string[],
    opts: { excludeUserId?: number | null } = {},
): Promise<number[]> {
    const distinct = [...new Set(roleIds.filter(Boolean))];
    if (distinct.length === 0) return [];

    const rows = await prisma.user.findMany({
        where: {
            OR: [
                { role: { in: distinct } },
                {
                    userPositions: {
                        some: { position: { roleTemplates: { some: { roleId: { in: distinct } } } } },
                    },
                },
            ],
            ...(opts.excludeUserId ? { id: { not: opts.excludeUserId } } : {}),
        },
        select: { id: true },
    });

    return rows.map((r) => r.id);
}
