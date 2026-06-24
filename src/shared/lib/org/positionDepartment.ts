import { prisma } from "@/shared/lib/prisma/prismaClient";

/**
 * A Position's department is derived from its role template — a role already
 * carries its home department (`Role.departmentId`), so the position inherits it.
 * The position never picks a department independently (that would let position
 * and role disagree). A role-less seat has no department.
 *
 * @returns the departmentId to persist on the position, or `null`.
 */
export async function resolvePositionDepartmentId(
    roleTemplateId: string | null | undefined,
): Promise<string | null> {
    if (!roleTemplateId) return null;
    const role = await prisma.role.findUnique({
        where:  { id: roleTemplateId },
        select: { departmentId: true },
    });
    return role?.departmentId ?? null;
}
