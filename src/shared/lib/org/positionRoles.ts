import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { resolvePositionDepartmentId } from "@/shared/lib/org/positionDepartment";

type DbClient = Prisma.TransactionClient | typeof prisma;

/** Replace all role templates on a position and re-derive departmentId. */
export async function syncPositionRoles(
    client: DbClient,
    positionId: string,
    roleIds: string[],
): Promise<string | null> {
    const uniqueRoleIds = [...new Set(roleIds.filter(Boolean))];
    await client.positionRole.deleteMany({ where: { positionId } });
    if (uniqueRoleIds.length > 0) {
        await client.positionRole.createMany({
            data: uniqueRoleIds.map((roleId) => ({ positionId, roleId })),
            skipDuplicates: true,
        });
    }
    const departmentId = await resolvePositionDepartmentId(uniqueRoleIds, client);
    await client.position.update({
        where: { id: positionId },
        data:  { departmentId },
    });
    return departmentId;
}
