import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { isStaffEmailDomainAllowed } from "@/shared/lib/auth/staffEmailAllowlist";
import { z } from "zod";

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
    departments: { select: { id: true, name: true } },
    branches:    { select: { id: true, name: true } },
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
        return NextResponse.json(user);
    } catch {
        return NextResponse.json({ error: "Failed to fetch user" }, { status: 500 });
    }
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
    departmentIds: z.array(z.string()).optional(),
    branchIds:     z.array(z.string()).optional(),
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
    departments: { select: { id: true, name: true } },
    branches:    { select: { id: true, name: true } },
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
    const isAdmin = caller.permissions.includes("users:manage") || caller.permissions.includes("admin:bypass");

    if (!isSelf && !isAdmin) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    try {
        const parsed = userUpdateSchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 });
        }
        const body = parsed.data;

        if (body.email !== undefined && !isStaffEmailDomainAllowed(body.email)) {
            return NextResponse.json(
                { error: "Email domain is not allowed for staff accounts" },
                { status: 400 }
            );
        }

        // Rank guard when an admin changes someone's role
        if (body.role && isAdmin && !caller.permissions.includes("admin:bypass")) {
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

        const data: Parameters<typeof prisma.user.update>[0]["data"] = {
            name:      body.name,
            email:     body.email,
            title:     body.title     ?? null,
            avatarUrl: body.avatarUrl ?? null,
            coverUrl:  body.coverUrl  ?? null,
            phone:     body.phone     ?? null,
            bio:       body.bio       ?? null,
            linkedIn:  body.linkedIn  ?? null,
            twitter:   body.twitter   ?? null,
            instagram: body.instagram ?? null,
            facebook:  body.facebook  ?? null,
            birthday:  body.birthday  ? new Date(body.birthday) : null,
        };

        if (body.password) data.password = await bcrypt.hash(body.password, 10);

        // Admin-only fields
        if (isAdmin) {
            if (body.role      !== undefined) data.role      = body.role;
            if (body.scope     !== undefined) data.scope     = body.scope;
            if (body.managerId !== undefined) data.managerId = body.managerId ? Number(body.managerId) : null;
            if (body.departmentIds !== undefined) data.departments = { set: body.departmentIds.map(id => ({ id })) };
            if (body.branchIds    !== undefined) data.branches    = { set: body.branchIds.map(id => ({ id })) };
        }

        const user = await prisma.user.update({ where: { id: userId }, data, select: PUT_SELECT });
        return NextResponse.json(user);
    } catch {
        return NextResponse.json({ error: "Failed to update user" }, { status: 500 });
    }
}

export async function DELETE(
    _: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { user: caller, response } = await requireAuth();
    if (response) return response;
    if (!caller.permissions.includes("users:manage") && !caller.permissions.includes("admin:bypass")) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    try {
        const { id } = await params;
        const userId = Number(id);
        if (Number.isNaN(userId)) return NextResponse.json({ error: "Invalid user id" }, { status: 400 });

        const userWithRelations = await prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, _count: { select: { ownedTickets: true, ticketLogs: true } } },
        });
        if (!userWithRelations) return NextResponse.json({ error: "User not found" }, { status: 404 });
        if (userWithRelations._count.ownedTickets > 0 || userWithRelations._count.ticketLogs > 0) {
            return NextResponse.json(
                { error: "Cannot delete user because linked tickets or ticket logs exist. Reassign records first." },
                { status: 400 }
            );
        }

        await prisma.user.delete({ where: { id: userId } });
        return NextResponse.json({ success: true });
    } catch {
        return NextResponse.json({ error: "Failed to delete user" }, { status: 500 });
    }
}
