import type { PrismaClient } from "@/generated/prisma/client";
import bcrypt from "bcryptjs";
import { isStaffEmailDomainAllowed } from "@/lib/auth/staff-email-allowlist";

export type StaffAuthUser = {
    id: string;
    name: string;
    email: string;
    role: string;
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

    const inheritedRoleIds = user.posts
        .map((up) => up.post.roleTemplateId)
        .filter((id): id is string => Boolean(id));
    const roles = [...new Set([user.role, ...inheritedRoleIds])];
    const primaryRole = user.role;

    const effective = new Set<string>();
    for (const rp of user.userRole.permissions) {
        const permId = rp.permission?.id;
        if (permId) effective.add(permId);
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

    return {
        id: String(user.id),
        name: user.name,
        email: user.email,
        role: primaryRole,
        roles,
        permissions: [...effective],
        rank: user.userRole.rank,
        scope: user.scope,
        roleLabel: user.userRole.label,
        roleColor: user.userRole.color,
        departmentIds: user.departments.map((d) => d.id),
        branchIds: user.branches.map((b) => b.id),
        title: user.title ?? undefined,
        avatarUrl: user.avatarUrl ?? undefined,
        kind: "staff",
    };
}
