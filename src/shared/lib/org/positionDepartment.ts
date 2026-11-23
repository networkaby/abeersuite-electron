import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/shared/lib/prisma/prismaClient";

type DbClient = Prisma.TransactionClient | typeof prisma;

/**
 * A position's department is picked by hand. It must be a department of the
 * position's own branch (or a cross-branch one with no branch). Returns an
 * error message, or null when the pair is fine.
 *
 * Role templates no longer decide the department — the role's home department
 * is only the Role Matrix authoring lens (see rbac.prisma), and the Positions
 * form filters roles by department NAME, since every branch has its own row.
 */
export async function checkPositionDepartment(
    departmentId: string | null | undefined,
    branchId: string | null | undefined,
    client: DbClient = prisma,
): Promise<string | null> {
    if (!departmentId) return null;
    const dept = await client.department.findUnique({
        where:  { id: departmentId },
        select: { branchId: true },
    });
    if (!dept) return "Department not found";
    if (dept.branchId && dept.branchId !== (branchId ?? null)) {
        return "That department belongs to another branch";
    }
    return null;
}
