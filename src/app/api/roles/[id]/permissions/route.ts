import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAnyPermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { getDepartmentPool } from "@/shared/lib/auth/departmentPool";
import { revokeRoleSessions } from "@/shared/lib/auth/revokeSessions";

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

        // Enforce the department-pool invariant: a role may only grant permissions
        // inside its department's pool. The Role editor already offers pooled ids
        // only, but it also re-sends any already-granted permission (so nothing is
        // silently hidden) — without this filter those out-of-pool grants would be
        // re-persisted, letting the role drift outside its pool. All-access
        // departments pool everything (`isAllAccess` / null ids) → no filtering.
        const pool = await getDepartmentPool(role.departmentId);
        const allowed = pool && !pool.isAllAccess ? new Set(pool.permissionIds ?? []) : null;
        const permissionIds = allowed ? data.permissionIds.filter((id) => allowed.has(id)) : data.permissionIds;

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
