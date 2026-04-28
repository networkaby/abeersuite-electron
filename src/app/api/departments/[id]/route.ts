import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth-guard";
import { z } from "zod";

const updateSchema = z.object({
    name:        z.string().trim().min(1).optional(),
    description: z.string().trim().optional().nullable(),
    branchId:    z.string().trim().optional().nullable(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission("settings:manage");
    if (response) return response;
    try {
        const { id } = await params;
        const parsed = updateSchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 });
        }
        const department = await prisma.department.update({
            where: { id },
            data: parsed.data,
            include: { branch: { select: { id: true, name: true } } },
        });
        return NextResponse.json(department);
    } catch {
        return NextResponse.json({ error: "Failed to update department" }, { status: 500 });
    }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission("settings:manage");
    if (response) return response;
    try {
        const { id } = await params;
        const dept = await prisma.department.findUnique({
            where: { id },
            include: { _count: { select: { users: true } } },
        });
        if (!dept) return NextResponse.json({ error: "Department not found" }, { status: 404 });
        if (dept._count.users > 0) {
            return NextResponse.json({ error: "Cannot delete department with assigned users. Reassign users first." }, { status: 400 });
        }
        await prisma.department.delete({ where: { id } });
        return NextResponse.json({ success: true });
    } catch {
        return NextResponse.json({ error: "Failed to delete department" }, { status: 500 });
    }
}
