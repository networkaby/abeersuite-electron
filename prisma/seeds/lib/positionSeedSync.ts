import type { PrismaClient } from "../../../src/generated/prisma/client";

/** Upsert a position row and replace its role-template links (seed scripts). */
export async function upsertPositionWithRoles(
    prisma: PrismaClient,
    data: {
        id: string;
        title: string;
        branchId: string | null;
        departmentId?: string | null;
        roleTemplateIds: string[];
    },
) {
    const roleIds = [...new Set(data.roleTemplateIds.filter(Boolean))];
    let departmentId = data.departmentId ?? null;

    if (roleIds.length > 0) {
        const roles = await prisma.role.findMany({
            where:  { id: { in: roleIds } },
            select: { departmentId: true, rank: true },
        });
        const deptIds = [...new Set(roles.map((r) => r.departmentId))];
        if (deptIds.length === 1) departmentId = deptIds[0]!;
        else if (roles.length > 0) {
            departmentId = roles.reduce((best, r) => (r.rank > best.rank ? r : best)).departmentId;
        }
    } else if (data.departmentId === undefined) {
        departmentId = null;
    }

    await prisma.position.upsert({
        where:  { id: data.id },
        update: { title: data.title, branchId: data.branchId, departmentId },
        create: { id: data.id, title: data.title, branchId: data.branchId, departmentId },
    });
    await prisma.positionRole.deleteMany({ where: { positionId: data.id } });
    if (roleIds.length > 0) {
        await prisma.positionRole.createMany({
            data: roleIds.map((roleId) => ({ positionId: data.id, roleId })),
            skipDuplicates: true,
        });
    }
}
