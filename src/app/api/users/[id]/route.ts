import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { requireAuth, requirePermission } from "@/lib/auth-guard";
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
    userRole:    { select: { id: true, label: true, color: true, rank: true, permissions: { select: { permission: true } } } },
    manager:     { select: { id: true, name: true, title: true, role: true, userRole: { select: { label: true, color: true } } } },
    reports:     { select: { id: true, name: true, title: true, role: true, userRole: { select: { label: true, color: true } } } },
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
    name:          z.string().trim().min(1, "Name is required"),
    email:         z.string().trim().email("Valid email is required"),
    role:          z.string().trim().min(1).optional(),
    title:         z.string().trim().optional().nullable(),
    scope:         z.enum(["OWN", "TEAM", "DEPARTMENT", "BRANCH", "REGION", "ORG"]).optional(),
    departmentIds: z.array(z.string()).optional(),
    branchIds:     z.array(z.string()).optional(),
    managerId:     z.union([z.coerce.number().int().positive(), z.literal(""), z.null()]).optional(),
    password:      z.string().min(6).optional().or(z.literal("")),
});

const USER_SELECT = {
    id:          true,
    name:        true,
    email:       true,
    role:        true,
    title:       true,
    scope:       true,
    createdAt:   true,
    managerId:   true,
    userRole:    { select: { id: true, label: true, color: true, rank: true } },
    manager:     { select: { id: true, name: true } },
    departments: { select: { id: true, name: true } },
    branches:    { select: { id: true, name: true } },
} as const;

export async function PUT(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { user: caller, response } = await requirePermission("users:manage");
    if (response) return response;
    try {
        const { id } = await params;
        const parsed = userUpdateSchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid user payload" }, { status: 400 });
        }
        const body = parsed.data;

        if (body.role && !caller.permissions.includes("admin:bypass")) {
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

        const userId = Number(id);
        const data: Parameters<typeof prisma.user.update>[0]["data"] = {
            name:  body.name,
            email: body.email,
            title: body.title ?? null,
            ...(body.role      !== undefined && { role:      body.role }),
            ...(body.scope     !== undefined && { scope:     body.scope }),
            ...(body.managerId !== undefined && { managerId: body.managerId ? Number(body.managerId) : null }),
            ...(body.departmentIds !== undefined && { departments: { set: body.departmentIds.map(id => ({ id })) } }),
            ...(body.branchIds    !== undefined && { branches:    { set: body.branchIds.map(id => ({ id })) } }),
        };
        if (body.password) data.password = await bcrypt.hash(body.password, 10);

        const user = await prisma.user.update({
            where: { id: userId },
            data,
            select: USER_SELECT,
        });

        return NextResponse.json(user);
    } catch {
        return NextResponse.json({ error: "Failed to update user" }, { status: 500 });
    }
}

export async function DELETE(
    _: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { response } = await requirePermission("users:manage");
    if (response) return response;
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
