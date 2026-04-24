import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth-guard";
import { z } from "zod";

const userRoleSchema = z.object({
    roleId: z.string().trim().min(1, "Role is required"),
});

export async function GET(
    _: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { response } = await requirePermission("users:manage");
    if (response) return response;
    try {
        const { id } = await params;
        const user = await prisma.user.findUnique({
            where: { id: Number(id) },
            select: {
                id: true,
                role: true,
                userRole: true,
            },
        });
        if (!user) {
            return NextResponse.json({ error: "User not found" }, { status: 404 });
        }
        return NextResponse.json({
            roleId: user.role,
            role: user.userRole,
        });
    } catch {
        return NextResponse.json({ error: "Failed to fetch user role" }, { status: 500 });
    }
}

export async function PUT(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { response } = await requirePermission("users:manage");
    if (response) return response;
    try {
        const { id } = await params;
        const userId = Number(id);
        const parsed = userRoleSchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid user role payload" }, { status: 400 });
        }
        const { roleId } = parsed.data;

        await prisma.user.update({ where: { id: userId }, data: { role: roleId } });

        return NextResponse.json({ success: true });
    } catch {
        return NextResponse.json({ error: "Failed to update user role" }, { status: 500 });
    }
}
