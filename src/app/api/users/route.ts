import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { requireAuth, requirePermission } from "@/lib/auth-guard";
import { z } from "zod";

const createUserSchema = z.object({
    name: z.string().trim().min(1, "Name is required"),
    email: z.string().trim().email("Valid email is required"),
    password: z.string().min(6, "Password must be at least 6 characters"),
    role: z.string().trim().optional(),
    managerId: z.union([z.coerce.number().int().positive(), z.literal(""), z.null()]).optional(),
});

export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const users = await prisma.user.findMany({
            orderBy: { createdAt: "desc" },
            select: {
                id: true,
                name: true,
                email: true,
                role: true,
                managerId: true,
                createdAt: true,
                userRole: { select: { label: true, color: true } },
                userRoles: {
                    orderBy: { isPrimary: "desc" },
                    include: { role: { select: { id: true, label: true, color: true } } },
                },
                manager: { select: { id: true, name: true } },
            },
        });
        return NextResponse.json(users);
    } catch {
        return NextResponse.json({ error: "Failed to fetch users" }, { status: 500 });
    }
}

export async function POST(req: Request) {
    const { response } = await requirePermission("users:manage");
    if (response) return response;
    try {
        const parsed = createUserSchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid user payload" }, { status: 400 });
        }
        const body = parsed.data;
        const password = await bcrypt.hash(body.password, 10);
        
        let primaryRole: string = body.role;
        if (!primaryRole) {
            const firstRole = await prisma.role.findFirst({ orderBy: { id: "asc" } });
            primaryRole = firstRole?.id || "R2";
        }

        const user = await prisma.$transaction(async (tx) => {
            const created = await tx.user.create({
                data: {
                    name: body.name,
                    email: body.email,
                    password,
                    role: primaryRole,
                    ...(body.managerId ? { managerId: Number(body.managerId) } : {}),
                },
                select: { id: true, name: true, email: true, role: true, createdAt: true, userRole: { select: { label: true, color: true } } },
            });
            await tx.userRole.create({ data: { userId: created.id, roleId: primaryRole, isPrimary: true } });
            return created;
        });

        return NextResponse.json(user);
    } catch {
        return NextResponse.json({ error: "Failed to create user" }, { status: 500 });
    }
}
