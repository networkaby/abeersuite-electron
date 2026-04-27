import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth-guard";
import { z } from "zod";

const patchSchema = z.object({
    label: z.string().trim().min(1).optional(),
    order: z.coerce.number().int().nonnegative().optional(),
});

// PATCH /api/sub-status-groups/[id]
export async function PATCH(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { response } = await requirePermission("settings:statuses");
    if (response) return response;
    try {
        const { id } = await params;
        const parsed = patchSchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 });
        }
        const body = parsed.data;
        const updated = await prisma.subStatusGroup.update({
            where: { id },
            data: {
                ...(body.label !== undefined && { label: body.label }),
                ...(body.order !== undefined && { order: body.order }),
            },
        });
        return NextResponse.json(updated);
    } catch (error) {
        console.error(error);
        return NextResponse.json({ error: "Failed to update group" }, { status: 500 });
    }
}

// DELETE /api/sub-status-groups/[id]
export async function DELETE(
    _: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { response } = await requirePermission("settings:statuses");
    if (response) return response;
    try {
        const { id } = await params;
        const inUse = await prisma.ticketSubStatus.count({ where: { groupId: id } });
        if (inUse > 0) {
            return NextResponse.json(
                { error: `Cannot delete — ${inUse} sub-status(es) are assigned to this group.` },
                { status: 409 }
            );
        }
        await prisma.subStatusGroup.delete({ where: { id } });
        return NextResponse.json({ ok: true });
    } catch (error) {
        console.error(error);
        return NextResponse.json({ error: "Failed to delete group" }, { status: 500 });
    }
}
