import "server-only";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { hasPermission, isAdmin, type ResolvedUser } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

/**
 * "Who can do this" on the Add / Edit Work form. Sets exactly which roles hold a
 * gated work's `work:<id>` permission — the same RolePermission rows the Role
 * page ticks, so both screens always agree. Only someone who can edit roles may
 * change it, so the work form can't be used to hand out access. Takes effect on
 * the holder's next login, like the Role page.
 */
export function canGrantWorkRoles(user: ResolvedUser): boolean {
    return isAdmin(user) || hasPermission(user, PERMISSIONS.ROLES_EDIT);
}

export async function setWorkRoles(permissionId: string, roleIds: string[]): Promise<void> {
    const wanted = [...new Set(roleIds)];
    await prisma.$transaction([
        prisma.rolePermission.deleteMany({
            where: { permissionId, ...(wanted.length ? { roleId: { notIn: wanted } } : {}) },
        }),
        prisma.rolePermission.createMany({
            data: wanted.map((roleId) => ({ roleId, permissionId })),
            skipDuplicates: true,
        }),
    ]);
}
