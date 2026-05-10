import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";

const updateSchema = z.object({
    name:     z.string().trim().min(1).optional(),
    address:  z.string().trim().optional().nullable(),
    phone:    z.string().trim().optional().nullable(),
    isActive: z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission("settings:manage");
    if (response) return response;
    try {
        const { id } = await params;
        const { data, error } = await validateRequest(req, updateSchema);
        if (error) return error;
        const branch = await prisma.branch.update({ where: { id }, data: data });
        return NextResponse.json(branch);
    } catch {
        return NextResponse.json({ error: "Failed to update branch" }, { status: 500 });
    }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission("settings:manage");
    if (response) return response;
    try {
        const { id } = await params;
        const branch = await prisma.branch.findUnique({
            where: { id },
            include: { _count: { select: { users: true } } },
        });
        if (!branch) return NextResponse.json({ error: "Branch not found" }, { status: 404 });
        if (branch._count.users > 0) {
            return NextResponse.json({ error: "Cannot delete branch with assigned users. Reassign users first." }, { status: 400 });
        }
        await prisma.branch.delete({ where: { id } });
        return NextResponse.json({ success: true });
    } catch {
        return NextResponse.json({ error: "Failed to delete branch" }, { status: 500 });
    }
}
