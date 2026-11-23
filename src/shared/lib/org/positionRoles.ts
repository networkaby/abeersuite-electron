import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/shared/lib/prisma/prismaClient";

type DbClient = Prisma.TransactionClient | typeof prisma;

/** Replace all role templates on a position. The department is left alone — it is picked by hand. */
export async function syncPositionRoles(
    client: DbClient,
    positionId: string,
    roleIds: string[],
): Promise<void> {
    const uniqueRoleIds = [...new Set(roleIds.filter(Boolean))];
    await client.positionRole.deleteMany({ where: { positionId } });
    if (uniqueRoleIds.length > 0) {
        await client.positionRole.createMany({
            data: uniqueRoleIds.map((roleId) => ({ positionId, roleId })),
            skipDuplicates: true,
        });
    }
}
