import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth-guard";

export async function PUT(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { response } = await requirePermission("roles:manage");
    if (response) return response;
    try {
        const { id: roleId } = await params;
        const { permissionIds }: { permissionIds: string[] } = await req.json();

        // Replace full permission set for this role
        await prisma.userRolePermission.deleteMany({ where: { roleId } });
        if (permissionIds.length > 0) {
            await prisma.userRolePermission.createMany({
                data: permissionIds.map((permissionId) => ({ roleId, permissionId })),
                skipDuplicates: true,
            });
        }
        return NextResponse.json({ success: true });
    } catch {
        return NextResponse.json({ error: "Failed to update role permissions" }, { status: 500 });
    }
}
