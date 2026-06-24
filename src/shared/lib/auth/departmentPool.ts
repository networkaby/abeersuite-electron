import { prisma } from "@/shared/lib/prisma/prismaClient";

/**
 * A department's permission "pool" — the authoring lens used by the Role Matrix.
 * Roles homed in the department may only be granted permissions from this pool.
 *
 * This is an AUTHORING-time concept only; it never participates in runtime
 * permission checks (those resolve from positions → roles → grants in
 * `authorizeStaff.ts`).
 */
export interface DepartmentPool {
    departmentId: string;
    isAllAccess:  boolean;
    /** Permission ids in the pool. `null` when `isAllAccess` — the pool is *every* permission. */
    permissionIds: string[] | null;
}

/** Resolve a department's effective pool. Returns `null` if the department doesn't exist. */
export async function getDepartmentPool(departmentId: string): Promise<DepartmentPool | null> {
    const dept = await prisma.department.findUnique({
        where:  { id: departmentId },
        select: { id: true, isAllAccess: true, permissionPool: { select: { permissionId: true } } },
    });
    if (!dept) return null;
    return {
        departmentId:  dept.id,
        isAllAccess:   dept.isAllAccess,
        permissionIds: dept.isAllAccess ? null : dept.permissionPool.map(p => p.permissionId),
    };
}

/** Does a department's pool contain a permission? All-access pools contain everything. */
export function poolHasPermission(pool: DepartmentPool, permissionId: string): boolean {
    return pool.isAllAccess || (pool.permissionIds?.includes(permissionId) ?? false);
}
