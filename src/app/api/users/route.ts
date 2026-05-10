import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { requireAuth, requirePermission } from "@/shared/lib/auth/permissions";
import { isStaffEmailDomainAllowed } from "@/shared/lib/auth/staffEmailAllowlist";
import { z } from "zod";

const createUserSchema = z.object({
    name:          z.string().trim().min(1, "Name is required"),
    email:         z.string().trim().email("Valid email is required"),
    password:      z.string().min(6, "Password must be at least 6 characters"),
    role:          z.string().trim().optional(),
    title:         z.string().trim().optional().nullable(),
    scope:         z.enum(["OWN", "TEAM", "DEPARTMENT", "BRANCH", "REGION", "ORG"]).optional(),
    departmentIds: z.array(z.string()).optional(),
    branchIds:     z.array(z.string()).optional(),
    managerId:     z.union([z.coerce.number().int().positive(), z.literal(""), z.null()]).optional(),
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
    avatarUrl:   true,
    userRole:    { select: { id: true, label: true, color: true, rank: true } },
    manager:     { select: { id: true, name: true } },
    departments: { select: { id: true, name: true } },
    branches:    { select: { id: true, name: true } },
} as const;

export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const users = await prisma.user.findMany({
            orderBy: { createdAt: "desc" },
            select: USER_SELECT,
        });
        return NextResponse.json(users);
    } catch {
        return NextResponse.json({ error: "Failed to fetch users" }, { status: 500 });
    }
}

export async function POST(req: Request) {
    const { user: caller, response } = await requirePermission("users:manage");
    if (response) return response;
    try {
        const parsed = createUserSchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid user payload" }, { status: 400 });
        }
        const body = parsed.data;

        if (!isStaffEmailDomainAllowed(body.email)) {
            return NextResponse.json(
                { error: "Email domain is not allowed for staff accounts" },
                { status: 400 }
            );
        }

        let primaryRole = body.role;
        if (!primaryRole) {
            const firstRole = await prisma.role.findFirst({ orderBy: { id: "asc" } });
            primaryRole = firstRole?.id || "R2";
        }

        if (!caller.permissions.includes("admin:bypass")) {
            const [targetRole, callerRole] = await Promise.all([
                prisma.role.findUnique({ where: { id: primaryRole }, select: { rank: true } }),
                prisma.role.findUnique({ where: { id: caller.primaryRole }, select: { rank: true } }),
            ]);
            if (targetRole && callerRole && targetRole.rank >= callerRole.rank) {
                return NextResponse.json(
                    { error: "You cannot assign a role equal to or above your own rank" },
                    { status: 403 }
                );
            }
        }

        const password = await bcrypt.hash(body.password, 10);
        const user = await prisma.user.create({
            data: {
                name:     body.name,
                email:    body.email,
                password,
                role:     primaryRole,
                title:    body.title ?? null,
                scope:    body.scope ?? "OWN",
                departments: body.departmentIds?.length
                    ? { connect: body.departmentIds.map(id => ({ id })) }
                    : undefined,
                branches: body.branchIds?.length
                    ? { connect: body.branchIds.map(id => ({ id })) }
                    : undefined,
                ...(body.managerId ? { managerId: Number(body.managerId) } : {}),
            },
            select: USER_SELECT,
        });

        return NextResponse.json(user);
    } catch {
        return NextResponse.json({ error: "Failed to create user" }, { status: 500 });
    }
}
