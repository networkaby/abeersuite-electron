import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth-guard";

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
        const { roleIds, primaryRoleId }: { roleIds: string[]; primaryRoleId: string } = await req.json();

        if (!roleIds.length || !primaryRoleId) {
            return NextResponse.json({ error: "roleIds and primaryRoleId are required" }, { status: 400 });
        }
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
