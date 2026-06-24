import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/shared/lib/prisma/prismaClient";

type DbClient = Prisma.TransactionClient | typeof prisma;

/**
 * A Position's department is derived from its role templates — each role carries
 * a home department (`Role.departmentId`). When all roles agree, that department
 * wins; when they differ, the highest-rank role's home department is used.
 * A role-less seat has no department.
 */
export async function resolvePositionDepartmentId(
    roleIds: string[],
    client: DbClient = prisma,
): Promise<string | null> {
    const uniqueRoleIds = [...new Set(roleIds.filter(Boolean))];
    if (uniqueRoleIds.length === 0) return null;

    const roles = await client.role.findMany({
        where:  { id: { in: uniqueRoleIds } },
        select: { departmentId: true, rank: true },
    });
    if (roles.length === 0) return null;

    const deptIds = [...new Set(roles.map((r) => r.departmentId))];
    if (deptIds.length === 1) return deptIds[0]!;

    const top = roles.reduce((best, r) => (r.rank > best.rank ? r : best), roles[0]!);
    return top.departmentId;
}
