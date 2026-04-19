import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { requireAuth, requirePermission } from "@/lib/auth-guard";

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
        const body = await req.json();
        const password = await bcrypt.hash(body.password, 10);
        const primaryRole: string = body.role || "R2";

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
