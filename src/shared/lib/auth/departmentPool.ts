import { prisma } from "@/shared/lib/prisma/prismaClient";
import { SIDEBAR_MODULES } from "./sidebarModules";

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
        permissionIds: dept.isAllAccess ? null : expandSidebarModules(dept.permissionPool.map(p => p.permissionId)),
    };
}

/**
 * Sidebar pooling is MODULE-level, not link-level. The Departments page only ever
 * ticks a whole module (every `ui:sidebar:<module>:*` link at once), so "any link
 * of a module is stored" means "the department has that module". Expand that to
 * every CURRENT link of the module from code, so a page added to the sidebar
 * after the pool was last saved is inside the pool automatically — the module
 * chip stays ticked and the Role page offers the new link with no re-save.
 * Vouchers and loose permissions pass through untouched.
 */
export function expandSidebarModules(storedIds: string[]): string[] {
    const stored = new Set(storedIds);
    for (const m of SIDEBAR_MODULES) {
        if (!m.pooled) continue;
        if (m.childPermissionIds.some(id => stored.has(id))) {
            for (const id of m.childPermissionIds) stored.add(id);
        }
    }
    return [...stored];
}
