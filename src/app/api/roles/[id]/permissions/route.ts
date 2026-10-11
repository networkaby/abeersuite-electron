import { prisma, prismaAuthoritative } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAnyPermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { ensureCatalogPermissions } from "@/shared/lib/auth/ensurePermissions";
import { revokeRoleSessions } from "@/shared/lib/auth/revokeSessions";

const rolePermissionsSchema = z.object({
    permissionIds: z.array(z.string().trim()),
});

export async function PUT(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { response } = await requireAnyPermission(PERMISSIONS.ROLES_EDIT);
    if (response) return response;
    try {
        const { id: roleId } = await params;
        const { data, error } = await validateRequest(req, rolePermissionsSchema);
        if (error) return error;

        const role = await prismaAuthoritative.role.findUnique({ where: { id: roleId }, select: { id: true } });
        if (!role) return NextResponse.json({ error: "Role not found" }, { status: 404 });

        // NO department-pool filter here, on purpose. A department's pool is an
        // AUTHORING LENS only — it decides which modules the Role page offers for
        // ticking, nothing more. It is not a second gate: whatever the editor
        // offered and the user ticked is persisted as sent. (Taking a module OUT of
        // a department still strips the grants — that cascade lives in the
        // Departments save, `PUT /api/departments/[id]/permissions`, which is where
        // a pool change belongs.)
        const sentIds = data.permissionIds;

        // The editor's checkboxes are built from CODE (SIDEBAR_MODULES / the matrix
        // config), so a nav link added mints an id the DB has not been seeded with
        // yet. Create such code-known rows now, so the tick is kept, not dropped.
        await ensureCatalogPermissions(sentIds);
        // Drop ids with no Permission row even after that (unknown to code too —
        // e.g. a label renamed without a pinned `sidebarKey`). Sending one would
        // fail the createMany on a foreign key.
        const known = await prismaAuthoritative.permission.findMany({
            where: { id: { in: sentIds } },
            select: { id: true },
        });
        const knownIds = new Set(known.map((p) => p.id));
        const permissionIds = sentIds.filter((id) => knownIds.has(id));
        // Tell the editor what was NOT persisted, so it can warn instead of
        // toasting "saved" while a tick silently vanishes on reload. One bucket
        // now: unseeded (no Permission row in DB, and none in code to mint from).
        const unseeded = sentIds.filter((id) => !knownIds.has(id));

        // Replace full permission set for this role — atomically, so a rejected id
        // can never leave the role emptied by the delete half of the swap.
        await prisma.$transaction(async (tx) => {
            await tx.rolePermission.deleteMany({ where: { roleId } });
            if (permissionIds.length > 0) {
                await tx.rolePermission.createMany({
                    data: permissionIds.map((permissionId) => ({ roleId, permissionId })),
                    skipDuplicates: true,
                });
            }
        });
        // The role's grants changed — every holder's JWT is now stale; revoke so
        // they pick up the new set on next login.
        await revokeRoleSessions(roleId);
        return NextResponse.json({ success: true, dropped: { unseeded } });
    } catch (e) {
        return handleApiError(e, "Failed to update role permissions");
    }
}
