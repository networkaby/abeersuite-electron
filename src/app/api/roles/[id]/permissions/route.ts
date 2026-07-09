import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAnyPermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { getDepartmentPool } from "@/shared/lib/auth/departmentPool";
import { revokeRoleSessions } from "@/shared/lib/auth/revokeSessions";
import { SIDEBAR_MODULES } from "@/shared/lib/auth/sidebarModules";

// Permissions the Role editor assigns role-direct, never department-pooled:
// Works (`work:*`), POS operations (`pos:*` — vouchers + shift/till), and the
// links of non-pooled sidebar modules (Workspace: `ui:sidebar:workspace:*`). The
// editor offers these OUTSIDE the department lens, so the pool invariant below
// must not strip them. Derived from the sidebar's single source so it can't drift.
const UNPOOLED_SIDEBAR_IDS = new Set(
    SIDEBAR_MODULES.filter((m) => !m.pooled).flatMap((m) => m.childPermissionIds),
);
const isUnpooled = (id: string): boolean =>
    id.startsWith("work:") || id.startsWith("pos:") || UNPOOLED_SIDEBAR_IDS.has(id);

const rolePermissionsSchema = z.object({
    permissionIds: z.array(z.string().trim()),
});

export async function PUT(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { response } = await requireAnyPermission(PERMISSIONS.ROLES_EDIT_ORG, PERMISSIONS.ROLES_MANAGE);
    if (response) return response;
    try {
        const { id: roleId } = await params;
        const { data, error } = await validateRequest(req, rolePermissionsSchema);
        if (error) return error;

        const role = await prisma.role.findUnique({ where: { id: roleId }, select: { departmentId: true } });
        if (!role) return NextResponse.json({ error: "Role not found" }, { status: 404 });

        // Enforce the department-pool invariant: a role may only grant *pooled*
        // permissions from its department's pool. Two carve-outs:
        //   • already-granted-but-out-of-pool ids are NOT re-persisted (the editor
        //     re-sends them so nothing is hidden — the filter drops them so the role
        //     can't drift outside its pool);
        //   • role-direct categories the editor offers OUTSIDE the pool lens (Works,
        //     POS, Workspace links — see `isUnpooled`) are always allowed, else they
        //     could never be saved for a non-all-access department.
        // All-access departments pool everything (`isAllAccess` / null ids) → no filtering.
        const pool = await getDepartmentPool(role.departmentId);
        const allowed = pool && !pool.isAllAccess ? new Set(pool.permissionIds ?? []) : null;
        const permissionIds = allowed
            ? data.permissionIds.filter((id) => allowed.has(id) || isUnpooled(id))
            : data.permissionIds;

        // Replace full permission set for this role
        await prisma.rolePermission.deleteMany({ where: { roleId } });
        if (permissionIds.length > 0) {
            await prisma.rolePermission.createMany({
                data: permissionIds.map((permissionId) => ({ roleId, permissionId })),
                skipDuplicates: true,
            });
        }
        // The role's grants changed — every holder's JWT is now stale; revoke so
        // they pick up the new set on next login.
        await revokeRoleSessions(roleId);
        return NextResponse.json({ success: true });
    } catch (e) {
        return handleApiError(e, "Failed to update role permissions");
    }
}
