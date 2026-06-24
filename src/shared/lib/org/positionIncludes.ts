/** Shared Prisma include for position reads (list, detail, users). */
export const POSITION_INCLUDE = {
    branch:     { select: { id: true, name: true } },
    department: { select: { id: true, name: true } },
    parent:     { select: { id: true, title: true } },
    roleTemplates: {
        orderBy: { roleId: "asc" as const },
        include: {
            role: {
                select: {
                    id: true,
                    label: true,
                    color: true,
                    rank: true,
                    departmentId: true,
                    department: { select: { id: true, name: true } },
                },
            },
        },
    },
    holders: {
        select: {
            createdAt: true,
            user: {
                select: {
                    id: true,
                    name: true,
                    avatarUrl: true,
                    role: true,
                    title: true,
                    userRole: { select: { label: true, color: true } },
                },
            },
        },
    },
    _count: { select: { children: true } },
} as const;

export type PositionWithIncludes = {
    roleTemplates: { role: { id: string; label: string; color: string } }[];
};

/** Flatten join rows to a plain role array for API responses. */
export function flattenPositionRoles<T extends PositionWithIncludes>(position: T) {
    const { roleTemplates, ...rest } = position;
    return {
        ...rest,
        roleTemplates: roleTemplates.map((row) => row.role),
    };
}
