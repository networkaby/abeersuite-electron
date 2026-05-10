import type { Prisma } from "@/generated/prisma/client";
import type { ResolvedUser } from "@/shared/lib/auth/authGuard";

type ScopeLevel = "own" | "department" | "branch" | "org";

const SCOPE_ORDER: ScopeLevel[] = ["own", "department", "branch", "org"];

function highestScopeFromPermissions(permissions: string[]): ScopeLevel | null {
    if (permissions.includes("admin:bypass")) return "org";
    if (permissions.includes("tickets:view")) return "org";

    const scoped = SCOPE_ORDER.filter((scope) => permissions.includes(`tickets:view:${scope}`));
    if (scoped.length === 0) return null;
    return scoped[scoped.length - 1] ?? null;
}

function ownVisibility(userId: number): Prisma.TicketWhereInput {
    return {
        OR: [
            { primaryOwnerId: userId },
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
        return {
            OR: [
                own,
                { primaryOwner: { departments: { some: { id: { in: user.departmentIds } } } } },
                { participants: { some: { removedAt: null, user: { departments: { some: { id: { in: user.departmentIds } } } } } } },
            ],
        };
    }

    // scope === "branch"
    if (user.branchIds.length === 0) return own;
    return {
        OR: [
            own,
            { primaryOwner: { branches: { some: { id: { in: user.branchIds } } } } },
            { participants: { some: { removedAt: null, user: { branches: { some: { id: { in: user.branchIds } } } } } } },
        ],
    };
}

