import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { isStaffEmailDomainAllowed } from "@/shared/lib/auth/staffEmailAllowlist";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

const PROFILE_SELECT = {
    id:          true,
    name:        true,
    email:       true,
    title:       true,
    role:        true,
    scope:       true,
    createdAt:   true,
    managerId:   true,
    // public profile fields
    avatarUrl:   true,
    coverUrl:    true,
    phone:       true,
    birthday:    true,
    bio:         true,
    linkedIn:    true,
    twitter:     true,
    instagram:   true,
    facebook:    true,
    userRole:    { select: { id: true, label: true, color: true, rank: true, permissions: { select: { permission: true } } } },
    manager:     { select: { id: true, name: true, title: true, role: true, avatarUrl: true, userRole: { select: { label: true, color: true } } } },
    reports:     { select: { id: true, name: true, title: true, role: true, avatarUrl: true, userRole: { select: { label: true, color: true } } } },
    userPositions: {
        select: {
            position: {
                select: {
                    id: true, title: true,
                    branch:     { select: { id: true, name: true } },
                    department: { select: { id: true, name: true } },
                },
            },
        },
    },
} as const;

export async function GET(
    _: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const { id } = await params;
        const userId = Number(id);
        if (Number.isNaN(userId)) return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
        const user = await prisma.user.findUnique({ where: { id: userId }, select: PROFILE_SELECT });
        if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });
        return NextResponse.json(shapeUser(user));
    } catch (e) {
        return handleApiError(e, "Failed to fetch user");
    }
}

// Flatten `userPositions` and derive `branches`/`departments` from the user's
// Position assignments so the client UI keeps the legacy field shape.
function shapeUser<T extends { userPositions: { position: { id: string; title: string; branch: { id: string; name: string } | null; department: { id: string; name: string } | null } }[] }>(u: T) {
    const branchMap = new Map<string, { id: string; name: string }>();
    const deptMap   = new Map<string, { id: string; name: string }>();
    for (const up of u.userPositions) {
        if (up.position.branch)     branchMap.set(up.position.branch.id, up.position.branch);
        if (up.position.department) deptMap.set(up.position.department.id, up.position.department);
    }
    const { userPositions, ...rest } = u;
    return {
        ...rest,
        positions:   userPositions.map(up => up.position),
        branches:    [...branchMap.values()],
        departments: [...deptMap.values()],
    };
}

const userUpdateSchema = z.object({
    // personal (self or admin)
    name:          z.string().trim().min(1, "Name is required"),
    email:         z.string().trim().email("Valid email is required"),
    title:         z.string().trim().optional().nullable(),
    password:      z.string().min(6).optional().or(z.literal("")),
    avatarUrl:     z.string().url().optional().nullable(),
    coverUrl:      z.string().url().optional().nullable(),
    phone:         z.string().trim().optional().nullable(),
    birthday:      z.string().optional().nullable(),
    bio:           z.string().trim().max(500).optional().nullable(),
    linkedIn:      z.string().trim().optional().nullable(),
    twitter:       z.string().trim().optional().nullable(),
    instagram:     z.string().trim().optional().nullable(),
    facebook:      z.string().trim().optional().nullable(),
    // admin-only
    role:          z.string().trim().min(1).optional(),
    scope:         z.enum(["OWN", "TEAM", "DEPARTMENT", "BRANCH", "REGION", "ORG"]).optional(),
    managerId:     z.union([z.coerce.number().int().positive(), z.literal(""), z.null()]).optional(),
});

const PUT_SELECT = {
    id:          true,
    name:        true,
    email:       true,
    role:        true,
    title:       true,
    scope:       true,
    createdAt:   true,
    managerId:   true,
    avatarUrl:   true,
    coverUrl:    true,
    phone:       true,
    birthday:    true,
    bio:         true,
    linkedIn:    true,
    twitter:     true,
    instagram:   true,
    facebook:    true,
    userRole:    { select: { id: true, label: true, color: true, rank: true, permissions: { select: { permission: true } } } },
    manager:     { select: { id: true, name: true, title: true, role: true, avatarUrl: true, userRole: { select: { label: true, color: true } } } },
    reports:     { select: { id: true, name: true, title: true, role: true, avatarUrl: true, userRole: { select: { label: true, color: true } } } },
    userPositions: {
        select: {
            position: {
                select: {
                    id: true, title: true,
                    branch:     { select: { id: true, name: true } },
                    department: { select: { id: true, name: true } },
                },
            },
        },
    },
} as const;

export async function PUT(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { user: caller, response } = await requireAuth();
    if (response) return response;

    const { id } = await params;
    const userId = Number(id);
    if (Number.isNaN(userId)) return NextResponse.json({ error: "Invalid user id" }, { status: 400 });

    const isSelf  = caller.id === userId;
    // Editing another user needs users:edit:org (or the users:manage umbrella / bypass).
    const isAdmin = caller.permissions.includes(PERMISSIONS.USERS_EDIT_ORG)
        || caller.permissions.includes(PERMISSIONS.USERS_MANAGE)
        || caller.permissions.includes(PERMISSIONS.ADMIN_BYPASS);

    if (!isSelf && !isAdmin) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    try {
        const { data, error } = await validateRequest(req, userUpdateSchema);
        if (error) return error;
        const body = data;

        if (body.email !== undefined && !isStaffEmailDomainAllowed(body.email)) {
            return NextResponse.json(
                { error: "Email domain is not allowed for staff accounts" },
                { status: 400 }
            );
        }

        // Rank guard when an admin changes someone's role
        if (body.role && isAdmin && !caller.permissions.includes(PERMISSIONS.ADMIN_BYPASS)) {
            const [targetRole, callerRole] = await Promise.all([
                prisma.role.findUnique({ where: { id: body.role }, select: { rank: true } }),
                prisma.role.findUnique({ where: { id: caller.primaryRole }, select: { rank: true } }),
            ]);
            if (targetRole && callerRole && targetRole.rank >= callerRole.rank) {
                return NextResponse.json(
                    { error: "You cannot assign a role equal to or above your own rank" },
                    { status: 403 }
                );
            }
        }

        // Build the update payload by only including fields the caller
        // actually sent. The identity form sends just name/email/password;
        // wiping every other profile field on each save would be a bug.
        const updateData: Parameters<typeof prisma.user.update>[0]["data"] = {
            name:  body.name,
            email: body.email,
        };
        if (body.title     !== undefined) updateData.title     = body.title;
        if (body.avatarUrl !== undefined) updateData.avatarUrl = body.avatarUrl;
        if (body.coverUrl  !== undefined) updateData.coverUrl  = body.coverUrl;
        if (body.phone     !== undefined) updateData.phone     = body.phone;
        if (body.bio       !== undefined) updateData.bio       = body.bio;
        if (body.linkedIn  !== undefined) updateData.linkedIn  = body.linkedIn;
        if (body.twitter   !== undefined) updateData.twitter   = body.twitter;
        if (body.instagram !== undefined) updateData.instagram = body.instagram;
        if (body.facebook  !== undefined) updateData.facebook  = body.facebook;
        if (body.birthday  !== undefined) updateData.birthday  = body.birthday ? new Date(body.birthday) : null;

        if (body.password) updateData.password = await bcrypt.hash(body.password, 10);

        // Admin-only fields
        if (isAdmin) {
            if (body.role      !== undefined) updateData.role      = body.role;
            if (body.scope     !== undefined) updateData.scope     = body.scope;
            if (body.managerId !== undefined) updateData.managerId = body.managerId ? Number(body.managerId) : null;
        }

        const user = await prisma.user.update({ where: { id: userId }, data: updateData, select: PUT_SELECT });
        return NextResponse.json(shapeUser(user));
    } catch (e) {
        return handleApiError(e, "Failed to update user");
    }
}

export async function DELETE(
    _: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { user: caller, response } = await requireAuth();
    if (response) return response;
    // Deleting a user needs users:delete:org (or the users:manage umbrella / bypass).
    if (!caller.permissions.includes(PERMISSIONS.USERS_DELETE_ORG)
        && !caller.permissions.includes(PERMISSIONS.USERS_MANAGE)
        && !caller.permissions.includes(PERMISSIONS.ADMIN_BYPASS)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    try {
        const { id } = await params;
        const userId = Number(id);
        if (Number.isNaN(userId)) return NextResponse.json({ error: "Invalid user id" }, { status: 400 });

        // Tickets + logs no longer hold a User FK (ownership is a createdBy snapshot,
        // log author is JSON). The surviving User FKs are the ticket participant links.
        const userWithRelations = await prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, _count: { select: { participantAdded: true, participantEntries: true } } },
        });
        if (!userWithRelations) return NextResponse.json({ error: "User not found" }, { status: 404 });
        if (userWithRelations._count.participantAdded > 0 || userWithRelations._count.participantEntries > 0) {
            return NextResponse.json(
                { error: "Cannot delete user because they're linked as a ticket participant. Reassign records first." },
                { status: 400 }
            );
        }

        await prisma.user.delete({ where: { id: userId } });
        return NextResponse.json({ success: true });
    } catch (e) {
        return handleApiError(e, "Failed to delete user");
    }
}
