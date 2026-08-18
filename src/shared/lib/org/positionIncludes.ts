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

/**
 * The light shape a position PICKER needs — the filter dropdowns on Contacts,
 * Reconnect, Deals, Help, Administration and Recurring.
 *
 * Deliberately NOT `POSITION_INCLUDE`: those screens draw a list of names, and
 * loading role templates, holders and child counts to fill a <select> is work
 * nobody reads. Six pages each ran their own copy of this query with two
 * slightly different selects; this is the single shape all of them share —
 * `departmentName` is simply ignored by the ones that only show a branch.
 */
export const POSITION_PICKER_SELECT = {
    id:         true,
    title:      true,
    branch:     { select: { name: true } },
    department: { select: { name: true } },
} as const;

export type PositionPickerOption = {
    id:             string;
    title:          string;
    branchName:     string | null;
    departmentName: string | null;
};

export function toPositionPickerOption(row: {
    id: string;
    title: string;
    branch: { name: string } | null;
    department: { name: string } | null;
}): PositionPickerOption {
    return {
        id:             row.id,
        title:          row.title,
        branchName:     row.branch?.name ?? null,
        departmentName: row.department?.name ?? null,
    };
}

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
