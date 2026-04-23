import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth-guard";
import { z } from "zod";

const rolePermissionsSchema = z.object({
    permissionIds: z.array(z.string().trim()),
});

export async function PUT(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { response } = await requirePermission("roles:manage");
    if (response) return response;
    try {
        const { id: roleId } = await params;
        const parsed = rolePermissionsSchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid role permissions payload" }, { status: 400 });
        }
        const { permissionIds } = parsed.data;

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
