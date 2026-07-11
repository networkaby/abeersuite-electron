import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAnyPermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { pickDefined } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { getDepartmentPool } from "@/shared/lib/auth/departmentPool";
import { revokeRoleSessions } from "@/shared/lib/auth/revokeSessions";

export async function GET(
    _: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { response } = await requireAnyPermission(
        PERMISSIONS.ROLES_CREATE, PERMISSIONS.ROLES_EDIT_ORG, PERMISSIONS.ROLES_DELETE_ORG,
    );
    if (response) return response;
    try {
        const { id } = await params;
        const role = await prisma.role.findUnique({
            where: { id },
            include: {
                permissions: { include: { permission: true } },
                department: {
                    select: {
                        id: true, name: true, isAllAccess: true,
                        permissionPool: { select: { permissionId: true } },
                    },
                },
                _count: { select: { users: true } },
            },
        });
        if (!role) return NextResponse.json({ error: "Role not found" }, { status: 404 });
        return NextResponse.json(role);
    } catch (e) {
        return handleApiError(e, "Failed to fetch role");
    }
}

const rolePatchSchema = z.object({
    label:        z.string().trim().min(1).optional(),
    color:        z.string().trim().min(1).optional(),
    rank:         z.coerce.number().int().min(0).max(100).optional(),
    // Moving a role to another department re-homes its authoring lens. Grants
    // that fall outside the new department's pool are stripped to keep the
    // invariant (a role never grants outside its department pool).
    departmentId: z.string().trim().min(1).optional(),
});

export async function PATCH(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { response } = await requireAnyPermission(PERMISSIONS.ROLES_EDIT_ORG);
    if (response) return response;
    try {
        const { id } = await params;
        const { data, error } = await validateRequest(req, rolePatchSchema);
        if (error) return error;
        const body = data;

        // When re-homing the role to a new department, strip grants outside the
        // new pool (all-access pools contain everything → nothing stripped).
        if (body.departmentId) {
            const pool = await getDepartmentPool(body.departmentId);
            if (!pool) return NextResponse.json({ error: "Department not found" }, { status: 400 });
            if (!pool.isAllAccess) {
                const allowed = pool.permissionIds ?? [];
                // Empty pool → strip everything (Prisma `notIn: []` is unreliable, so branch).
                if (allowed.length > 0) {
                    await prisma.rolePermission.deleteMany({
                        where: { roleId: id, permissionId: { notIn: allowed } },
                    });
                } else {
                    await prisma.rolePermission.deleteMany({ where: { roleId: id } });
                }
            }
        }

        const role = await prisma.role.update({
            where: { id },
            data: pickDefined({
                label:        body.label,
                color:        body.color,
                rank:         body.rank,
                departmentId: body.departmentId,
            }),
            include: { department: { select: { id: true, name: true, isAllAccess: true } } },
        });
        // Rank / department (and possibly stripped grants) ride the JWT — revoke
        // holders' sessions so the change is live on their next request.
        if (body.rank !== undefined || body.departmentId !== undefined) {
            await revokeRoleSessions(id);
        }
        return NextResponse.json(role);
    } catch (e) {
        return handleApiError(e, "Failed to update role");
    }
}

export async function DELETE(
    _: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { response } = await requireAnyPermission(PERMISSIONS.ROLES_DELETE_ORG);
    if (response) return response;
    try {
        const { id } = await params;
        const role = await prisma.role.findUnique({ where: { id }, select: { isSystem: true } });
        if (!role) return NextResponse.json({ error: "Role not found" }, { status: 404 });
        if (role.isSystem) {
            return NextResponse.json({ error: "Cannot delete a system role" }, { status: 400 });
        }
        await prisma.role.delete({ where: { id } });
        return NextResponse.json({ success: true });
    } catch (e) {
        return handleApiError(e, "Failed to delete role");
    }
}
