/**
 * The one staff-list shape — shared by /api/users (Admin → Users) and
 * /api/hr/staff (HR & People → Staff Directory), so the two lists can never
 * describe the same person differently.
 *
 * A User's seats (positions) come through the UserPosition junction; the
 * shaper flattens them to `positions: [...]` and derives `branches` /
 * `departments` from them, which is the field shape every client has always
 * read. The HR profile rides along as `staffProfile` — null until HR has saved
 * something about the person.
 */

import type { Prisma } from "@/generated/prisma/client";

export const STAFF_USER_SELECT = {
    id:          true,
    name:        true,
    email:       true,
    role:        true,
    title:       true,
    scope:       true,
    createdAt:   true,
    managerId:   true,
    avatarUrl:   true,
    phone:       true,
    userRole:    { select: { id: true, label: true, color: true, rank: true } },
    manager:     { select: { id: true, name: true } },
    userPositions: {
        select: {
            position: {
                select: {
                    id:           true,
                    title:        true,
                    branch:       { select: { id: true, name: true } },
                    department:   { select: { id: true, name: true } },
                    roleTemplates: {
                        orderBy: { roleId: "asc" as const },
                        include: {
                            role: { select: { id: true, label: true, color: true } },
                        },
                    },
                },
            },
        },
    },
    staffProfile: {
        select: {
            staffCode:        true,
            joinedOn:         true,
            leftOn:           true,
            employmentType:   true,
            weeklyOff:        true,
            ledgerAccountId:  true,
        },
    },
} satisfies Prisma.UserSelect;

export type StaffUserRow = Prisma.UserGetPayload<{ select: typeof STAFF_USER_SELECT }>;

export type StaffPosition = {
    id: string;
    title: string;
    branch: { id: string; name: string } | null;
    department: { id: string; name: string } | null;
    roleTemplates: { id: string; label: string; color: string }[];
};

export function shapeStaffUser(u: StaffUserRow) {
    const { userPositions, ...rest } = u;
    // Flatten the UserPosition junction so the client gets `positions: [...]`
    // directly (cleaner than `userPositions: [{ position: {...} }]`).
    const positions: StaffPosition[] = userPositions.map((up) => {
        const { roleTemplates, ...pos } = up.position;
        return { ...pos, roleTemplates: roleTemplates.map((row) => row.role) };
    });
    // Derive `branches`/`departments` from the user's positions so callers
    // that used to read these arrays off User keep working.
    const branchMap = new Map<string, { id: string; name: string }>();
    const deptMap   = new Map<string, { id: string; name: string }>();
    for (const p of positions) {
        if (p.branch)     branchMap.set(p.branch.id, p.branch);
        if (p.department) deptMap.set(p.department.id, p.department);
    }
    return {
        ...rest,
        positions,
        branches:    [...branchMap.values()],
        departments: [...deptMap.values()],
    };
}

export type StaffUser = ReturnType<typeof shapeStaffUser>;
