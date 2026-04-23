import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth-guard";
import { z } from "zod";

const userRolesSchema = z.object({
    roleIds: z.array(z.string().trim().min(1)).min(1, "At least one role is required"),
    primaryRoleId: z.string().trim().min(1, "Primary role is required"),
});

export async function GET(
    _: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { response } = await requirePermission("users:manage");
    if (response) return response;
    try {
        const { id } = await params;
        const userRoles = await prisma.userRole.findMany({
            where: { userId: Number(id) },
            include: { role: true },
            orderBy: { isPrimary: "desc" },
        });
        return NextResponse.json(userRoles);
    } catch {
        return NextResponse.json({ error: "Failed to fetch user roles" }, { status: 500 });
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
        const parsed = userRolesSchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid user roles payload" }, { status: 400 });
        }
        const { roleIds, primaryRoleId } = parsed.data;
        if (!roleIds.includes(primaryRoleId)) {
            return NextResponse.json({ error: "primaryRoleId must be in roleIds" }, { status: 400 });
        }

        // Replace roles atomically
        await prisma.$transaction([
            prisma.userRole.deleteMany({ where: { userId } }),
            prisma.userRole.createMany({
                data: roleIds.map((roleId) => ({
                    userId,
                    roleId,
                    isPrimary: roleId === primaryRoleId,
                })),
            }),
            // Keep legacy User.role in sync with primary role
            prisma.user.update({ where: { id: userId }, data: { role: primaryRoleId } }),
        ]);

        return NextResponse.json({ success: true });
    } catch {
        return NextResponse.json({ error: "Failed to update user roles" }, { status: 500 });
    }
}
