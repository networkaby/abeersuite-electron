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

// ── Overdue notices: who sees a status' work-less overdue tickets ─────────────
// A status is restricted only while its `status-overdue:<id>` permission row
// exists. No roles ticked → the row is deleted → everyone sees them, as before.
const OVERDUE_PREFIX = "status-overdue:";
export const overduePermissionId = (statusId: string) => `${OVERDUE_PREFIX}${statusId}`;

export async function setOverdueRoles(statusId: string, statusLabel: string, roleIds: string[]): Promise<void> {
    const permissionId = overduePermissionId(statusId);
    if (roleIds.length === 0) {
        await prisma.permission.deleteMany({ where: { id: permissionId } }); // grants cascade
        return;
    }
    await prisma.permission.upsert({
        where:  { id: permissionId },
        update: { label: `Overdue: ${statusLabel}`, module: "tickets" },
        create: { id: permissionId, label: `Overdue: ${statusLabel}`, module: "tickets", description: `See overdue ${statusLabel} tickets in the Work Inbox.` },
    });
    await setWorkRoles(permissionId, roleIds);
}

/** Status ids whose overdue notices are limited to ticked roles. One small query per request. */
export async function restrictedOverdueStatusIds(): Promise<Set<string>> {
    const rows = await prisma.permission.findMany({ where: { id: { startsWith: OVERDUE_PREFIX } }, select: { id: true } });
    return new Set(rows.map((r) => r.id.slice(OVERDUE_PREFIX.length)));
}

export function passesOverdueGate(user: ResolvedUser, statusId: string | null, restricted: Set<string>): boolean {
    if (!statusId || !restricted.has(statusId)) return true;
    return hasPermission(user, overduePermissionId(statusId));
}
