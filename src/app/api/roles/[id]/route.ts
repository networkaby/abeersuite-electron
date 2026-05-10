import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";

export async function GET(
    _: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { response } = await requirePermission("roles:manage");
    if (response) return response;
    try {
        const { id } = await params;
        const role = await prisma.role.findUnique({
            where: { id },
            include: {
                permissions: { include: { permission: true } },
                _count: { select: { users: true } },
            },
        });
        if (!role) return NextResponse.json({ error: "Role not found" }, { status: 404 });
        return NextResponse.json(role);
    } catch (e) {
        return handleApiError(e, "Failed to fetch role");
    }
}

const rolePatchSchema = z.object({
    label: z.string().trim().min(1).optional(),
    color: z.string().trim().min(1).optional(),
    rank:  z.coerce.number().int().min(0).max(100).optional(),
});

export async function PATCH(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { response } = await requirePermission("roles:manage");
    if (response) return response;
    try {
        const { id } = await params;
        const { data, error } = await validateRequest(req, rolePatchSchema);
        if (error) return error;
        const body = data;
        const role = await prisma.role.update({
            where: { id },
            data: {
                ...(body.label !== undefined && { label: body.label }),
                ...(body.color !== undefined && { color: body.color }),
                ...(body.rank  !== undefined && { rank:  body.rank  }),
            },
        });
        return NextResponse.json(role);
    } catch (e) {
        return handleApiError(e, "Failed to update role");
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
    } catch (e) {
        return handleApiError(e, "Failed to delete role");
    }
}
