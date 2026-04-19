import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth-guard";

export async function PATCH(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { response } = await requirePermission("roles:manage");
    if (response) return response;
    try {
        const { id } = await params;
        const body = await req.json();
        const role = await prisma.role.update({
            where: { id },
            data: {
                ...(body.label && { label: body.label }),
                ...(body.color && { color: body.color }),
            },
        });
        return NextResponse.json(role);
    } catch {
        return NextResponse.json({ error: "Failed to update role" }, { status: 500 });
    }
}

export async function DELETE(
    _: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { response } = await requirePermission("roles:manage");
    if (response) return response;
    try {
        const { id } = await params;
        const role = await prisma.role.findUnique({ where: { id }, select: { isSystem: true } });
        if (!role) return NextResponse.json({ error: "Role not found" }, { status: 404 });
        if (role.isSystem) {
            return NextResponse.json({ error: "Cannot delete a system role" }, { status: 400 });
        }
        await prisma.role.delete({ where: { id } });
        return NextResponse.json({ success: true });
    } catch {
        return NextResponse.json({ error: "Failed to delete role" }, { status: 500 });
    }
}
