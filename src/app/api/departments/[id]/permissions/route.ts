import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth, requireAnyPermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { getDepartmentPool } from "@/shared/lib/auth/departmentPool";
import { ensureCatalogPermissions } from "@/shared/lib/auth/ensurePermissions";
import { revokeRoleSessions } from "@/shared/lib/auth/revokeSessions";
import { expandSidebarModules } from "@/shared/lib/auth/departmentPool";
import { idsUnlockedByLinks } from "@/modules/admin/lib/roleMatrixConfig";

// GET — the department's permission pool (the Role Matrix authoring lens).
// For an all-access department, `isAllAccess: true` and `permissionIds: null`
// (the pool is "every permission", managed automatically).
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const { id } = await params;
        const pool = await getDepartmentPool(id);
        if (!pool) return NextResponse.json({ error: "Department not found" }, { status: 404 });
        return NextResponse.json(pool);
    } catch (e) {
        return handleApiError(e, "Failed to fetch department permission pool");
    }
}

const putSchema = z.object({
    permissionIds: z.array(z.string().trim().min(1)),
});

// PUT — full-replace the department's pool. Removing a permission cascade-strips
// it from the roles homed in this department (keeps the invariant "a role never
// grants outside its department pool"). A CLEAN removal: the action permissions a
// removed link had unlocked (create/edit/delete, extra toggles, module toggles)
// go with it unless a link still in the pool unlocks them too, and every affected
// role's sessions are revoked so holders lose the module on their next request,
// not at some later login. The response reports how many grants changed so the
// action is never silent. All-access pools are auto-managed and reject edits.
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requireAnyPermission(PERMISSIONS.DEPARTMENTS_EDIT);
    if (response) return response;
    try {
        const { id } = await params;
        const { data, error } = await validateRequest(req, putSchema);
        if (error) return error;

        const dept = await prisma.department.findUnique({
            where:  { id },
            select: { id: true, isAllAccess: true, permissionPool: { select: { permissionId: true } }, roles: { select: { id: true } } },
        });
        if (!dept) return NextResponse.json({ error: "Department not found" }, { status: 404 });
        if (dept.isAllAccess) {
            return NextResponse.json({ error: "This department is all-access — its pool is managed automatically and cannot be edited." }, { status: 409 });
        }

        const nextIds = [...new Set(data.permissionIds)];
        // A nav link added to the sidebar mints an id the DB may not have yet —
        // create such code-known rows now, so the save never trips on them.
        await ensureCatalogPermissions(nextIds);
        // Reject ids unknown to both code and DB so we 400 cleanly instead of hitting an FK error.
        if (nextIds.length) {
            const found = await prisma.permission.findMany({ where: { id: { in: nextIds } }, select: { id: true } });
            if (found.length !== nextIds.length) {
                const known = new Set(found.map(p => p.id));
                const unknown = nextIds.filter(p => !known.has(p));
                return NextResponse.json({ error: `Unknown permission(s): ${unknown.join(", ")}` }, { status: 400 });
            }
        }

        // Compare module-expanded sets, the same view the UI ticks against, so a
        // module ticked off strips every current link of it — not only the ones
        // that happened to be stored.
        const currentIds = new Set(expandSidebarModules(dept.permissionPool.map(p => p.permissionId)));
        const nextSet    = new Set(expandSidebarModules(nextIds));
        const removed    = [...currentIds].filter(p => !nextSet.has(p));
        // Action ids unlocked ONLY by the removed links (a link still pooled keeps
        // what it unlocks — e.g. a module toggle shared by two links).
        const stillUnlocked = idsUnlockedByLinks(nextSet);
        const dependents    = [...idsUnlockedByLinks(removed)].filter(id => !stillUnlocked.has(id));
        const toStrip       = [...new Set([...removed, ...dependents])];
        const roleIds    = dept.roles.map(r => r.id);

        const result = await prisma.$transaction(async (tx) => {
            await tx.departmentPermission.deleteMany({ where: { departmentId: id } });
            if (nextIds.length) {
                await tx.departmentPermission.createMany({
                    data: nextIds.map(permissionId => ({ departmentId: id, permissionId })),
                    skipDuplicates: true,
                });
            }
            // Cascade-strip removed permissions from roles homed in this department.
            let strippedGrants = 0;
            if (toStrip.length && roleIds.length) {
                const del = await tx.rolePermission.deleteMany({
                    where: { roleId: { in: roleIds }, permissionId: { in: toStrip } },
                });
                strippedGrants = del.count;
            }
            return { strippedGrants };
        });
        // Permissions ride the JWT — without this, holders keep the removed
        // module until they next sign in.
        if (result.strippedGrants > 0) {
            for (const roleId of roleIds) await revokeRoleSessions(roleId);
        }

        return NextResponse.json({
            success:        true,
            poolSize:       nextIds.length,
            removed:        removed.length,
            strippedDependents: dependents.length,
            strippedGrants: result.strippedGrants,
            affectedRoles:  roleIds.length,
        });
    } catch (e) {
        return handleApiError(e, "Failed to update department permission pool");
    }
}
