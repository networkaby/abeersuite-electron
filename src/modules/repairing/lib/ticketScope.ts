import type { Prisma } from "@/generated/prisma/client";
import type { ResolvedUser } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

type ScopeLevel = "own" | "department" | "branch" | "org";

const SCOPE_ORDER: ScopeLevel[] = ["own", "department", "branch", "org"];

function highestScopeFromPermissions(permissions: string[]): ScopeLevel | null {
    if (permissions.includes(PERMISSIONS.ADMIN_BYPASS)) return "org";
    if (permissions.includes("tickets:view")) return "org";

    const scoped = SCOPE_ORDER.filter((scope) => permissions.includes(`tickets:view:${scope}`));
    if (scoped.length === 0) return null;
    return scoped[scoped.length - 1] ?? null;
}

function ownVisibility(userId: number): Prisma.TicketWhereInput {
    return {
        OR: [
            // "who created" — the actor snapshot's userId (there's no owner FK anymore).
            { createdBy: { path: ["userId"], equals: userId } },
            { participants: { some: { userId, removedAt: null } } },
        ],
    };
}

export function buildTicketReadScopeWhere(user: ResolvedUser): Prisma.TicketWhereInput | undefined {
    const scope = highestScopeFromPermissions(user.permissions);

    // Backward compatibility: until scoped grants are assigned, keep legacy visibility.
    if (!scope || scope === "org") return undefined;

    const own = ownVisibility(user.id);

    if (scope === "own") {
        return own;
    }

    if (scope === "department") {
        if (user.departmentIds.length === 0) return own;
        // Match tickets whose participants hold a Position scoped to one of the
        // caller's departments (owner-based scoping retired with primaryOwner).
        const inDept = { userPositions: { some: { position: { departmentId: { in: user.departmentIds } } } } };
        return {
            OR: [
                own,
                { participants: { some: { removedAt: null, user: inDept } } },
            ],
        };
    }

    // scope === "branch"
    if (user.branchIds.length === 0) return own;
    // Match tickets whose participants hold a Position scoped to one of the caller's branches.
    const inBranch = { userPositions: { some: { position: { branchId: { in: user.branchIds } } } } };
    return {
        OR: [
            own,
            { participants: { some: { removedAt: null, user: inBranch } } },
        ],
    };
}

