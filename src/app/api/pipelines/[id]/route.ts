import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

const patchSchema = z.object({
    label: z.string().trim().min(1).optional(),
    description: z.string().optional().nullable(),
    color: z.string().trim().optional(),
    isActive: z.boolean().optional(),
    order: z.coerce.number().int().nonnegative().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);
    if (response) return response;
    const { id } = await params;
    try {
        const { data, error } = await validateRequest(req, patchSchema);
        if (error) return error;
        const pipeline = await prisma.pipeline.update({
            where: { id },
            data: data,
        });
        return NextResponse.json(pipeline);
    } catch (e) {
        return handleApiError(e, "Failed to update pipeline");
    }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);
    if (response) return response;
    const { id } = await params;
    try {
        const pipeline = await prisma.pipeline.findUnique({
            where: { id },
            include: { _count: { select: { tickets: true } } },
        });
        if (!pipeline) return NextResponse.json({ error: "Pipeline not found" }, { status: 404 });
        if (pipeline.isDefault) return NextResponse.json({ error: "Cannot delete the default pipeline" }, { status: 400 });
        if (pipeline._count.tickets > 0) {
            return NextResponse.json({ error: `Cannot delete: ${pipeline._count.tickets} ticket(s) use this pipeline` }, { status: 400 });
        }
        await prisma.pipeline.delete({ where: { id } });
        return NextResponse.json({ ok: true });
    } catch (e) {
        return handleApiError(e, "Failed to delete pipeline");
    }
}
