import { prisma } from "@/shared/lib/prisma/prismaClient";

/**
 * A Position's department is derived from its role template — a role already
 * carries its home department (`Role.departmentId`), so the position inherits it.
 * The position never picks a department independently (that would let position
 * and role disagree).
 *
 * Only a role-less seat (no `roleTemplateId`) may keep a manually-supplied
 * department, for org-chart placement until a role is attached.
 *
 * @returns the departmentId to persist on the position, or `null`.
 */
export async function resolvePositionDepartmentId(
    roleTemplateId: string | null | undefined,
    fallbackDepartmentId: string | null | undefined,
): Promise<string | null> {
    if (roleTemplateId) {
        const role = await prisma.role.findUnique({
            where:  { id: roleTemplateId },
            select: { departmentId: true },
        });
        return role?.departmentId ?? null;
    }
    return fallbackDepartmentId ?? null;
}
