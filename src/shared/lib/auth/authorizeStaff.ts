import type { PrismaClient } from "@/generated/prisma/client";
import bcrypt from "bcryptjs";
import { isStaffEmailDomainAllowed } from "@/shared/lib/auth/staffEmailAllowlist";

export type StaffAuthUser = {
    id: string;
    name: string;
    email: string;
    /** Primary role, derived from the highest-rank Post the user holds.
     * Null when the user has no Post appointments (no operational authority). */
    role: string | null;
    roles: string[];
    permissions: string[];
    rank: number;
    scope: string;
    roleLabel?: string;
    roleColor?: string;
    departmentIds: string[];
    branchIds: string[];
    title?: string;
    avatarUrl?: string;
    kind: "staff";
};

export async function authorizeStaffCredentials(
    prisma: PrismaClient,
    email: string,
    password: string
): Promise<StaffAuthUser | null> {
    if (!isStaffEmailDomainAllowed(email)) return null;

    const user = await prisma.user.findUnique({
        where: { email },
        include: {
            userRole: {
                include: {
                    permissions: { include: { permission: true } },
                },
            },
            posts: {
                include: {
                    post: {
                        include: {
                            roleTemplate: {
                                include: {
                                    permissions: { include: { permission: true } },
                                },
                            },
                        },
                    },
                },
            },
            departments: { select: { id: true } },
            branches: { select: { id: true } },
        },
    });

    if (!user) return null;

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) return null;

    // Roles flow from Post appointments. `User.role` is a manual override / cache
    // (e.g. promoted admins); it's included in the union when present.
    const postRoleIds = user.posts
        .map((up) => up.post.roleTemplateId)
        .filter((id): id is string => Boolean(id));
    const allRoles = new Set<string>(postRoleIds);
    if (user.role) allRoles.add(user.role);
    const roles = [...allRoles];

    // Effective permissions = union of grants from User.role (if any) + every
    // held Post's roleTemplate, then ±UserPermission overrides.
    const effective = new Set<string>();
    if (user.userRole) {
        for (const rp of user.userRole.permissions) {
            const permId = rp.permission?.id;
            if (permId) effective.add(permId);
        }
    }
    for (const userPost of user.posts) {
        const templatePerms = userPost.post.roleTemplate?.permissions ?? [];
        for (const rp of templatePerms) {
            const permId = rp.permission?.id;
            if (permId) effective.add(permId);
        }
    }

    const now = new Date();
    const overrides = await prisma.userPermission.findMany({
        where: {
            userId: user.id,
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        select: { permissionId: true, type: true },
    });
    for (const o of overrides) {
        if (o.type === "GRANT") effective.add(o.permissionId);
        else effective.delete(o.permissionId);
    }

    // Rank = max rank across user's role + every held Post's roleTemplate.
    let rank = user.userRole?.rank ?? 0;
    for (const up of user.posts) {
        const r = up.post.roleTemplate?.rank ?? 0;
        if (r > rank) rank = r;
    }

    // Surface metadata for the highest-rank source for UI badges.
    let roleLabel: string | undefined = user.userRole?.label;
    let roleColor: string | undefined = user.userRole?.color;
    if (!roleLabel) {
        // No direct user role — pick the highest-rank Post role template.
        let best: { rank: number; label?: string; color?: string } | null = null;
        for (const up of user.posts) {
            const rt = up.post.roleTemplate;
            if (rt && (!best || rt.rank > best.rank)) {
                best = { rank: rt.rank, label: rt.label, color: rt.color };
            }
        }
        roleLabel = best?.label;
        roleColor = best?.color;
    }

    // Branches + departments come from User M2M today; Post-derived widening
    // will replace these once the model migrates fully.
    const branchIds = user.branches.map((b) => b.id);
    const departmentIds = user.departments.map((d) => d.id);

    return {
        id: String(user.id),
        name: user.name,
        email: user.email,
        role: user.role,
        roles,
        permissions: [...effective],
        rank,
        scope: user.scope,
        roleLabel,
        roleColor,
        departmentIds,
        branchIds,
        title: user.title ?? undefined,
        avatarUrl: user.avatarUrl ?? undefined,
        kind: "staff",
    };
}
