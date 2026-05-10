import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";

const patchSchema = z.object({
    label: z.string().trim().min(1).optional(),
    description: z.string().optional().nullable(),
    color: z.string().trim().optional(),
    isActive: z.boolean().optional(),
    order: z.coerce.number().int().nonnegative().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission("settings:statuses");
    if (response) return response;
    const { id } = await params;
    try {
        const parsed = patchSchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 });
        }
        const pipeline = await prisma.pipeline.update({
            where: { id },
            data: parsed.data,
        });
        return NextResponse.json(pipeline);
    } catch {
        return NextResponse.json({ error: "Failed to update pipeline" }, { status: 500 });
    }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission("settings:statuses");
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
    } catch {
        return NextResponse.json({ error: "Failed to delete pipeline" }, { status: 500 });
    }
}
