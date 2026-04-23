import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth-guard";
import { z } from "zod";

const subStatusPatchSchema = z.object({
    label: z.string().trim().min(1).optional(),
    color: z.string().trim().min(1).optional(),
    group: z.string().trim().min(1).optional(),
    order: z.coerce.number().int().nonnegative().optional(),
    applicableStatusIds: z.array(z.string().trim()).optional(),
    allowedRoles: z.array(z.string().trim()).optional(),
    notifyRoles: z.array(z.string().trim()).optional(),
    triggerMap: z.record(z.string(), z.string()).optional(),
    actionLabel: z.string().optional().nullable(),
    warrantyScope: z.enum(["any", "warranty_only", "non_warranty_only"]).optional(),
    handoffRole: z.string().optional().nullable(),
    autoRevertOnClear: z.boolean().optional(),
});

// DELETE /api/sub-statuses/[id]
export async function DELETE(
    _: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { response } = await requirePermission("settings:statuses");
    if (response) return response;
    try {
        const { id } = await params;

        const inUse = await prisma.ticket.count({ where: { subStatusId: id } });
        if (inUse > 0) {
            return NextResponse.json(
                { error: `Cannot delete — ${inUse} ticket(s) currently use this sub-status.` },
                { status: 409 }
            );
        }

        await prisma.ticketSubStatus.delete({ where: { id } });
        return NextResponse.json({ ok: true });
    } catch (error) {
        console.error(error);
        return NextResponse.json({ error: "Failed to delete sub-status" }, { status: 500 });
    }
}

// PATCH /api/sub-statuses/[id]
export async function PATCH(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { response } = await requirePermission("settings:statuses");
    if (response) return response;
    try {
        const { id } = await params;
        const parsed = subStatusPatchSchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid sub-status payload" }, { status: 400 });
        }
        const body = parsed.data;

        const updated = await prisma.ticketSubStatus.update({
            where: { id },
            data: {
                ...(body.label !== undefined              && { label: body.label }),
                ...(body.color !== undefined              && { color: body.color }),
                ...(body.group !== undefined              && { group: body.group }),
                ...(body.order !== undefined              && { order: body.order }),
                ...(body.applicableStatusIds !== undefined && { applicableStatusIds: body.applicableStatusIds }),
                ...(body.allowedRoles !== undefined       && { allowedRoles: body.allowedRoles }),
                ...(body.notifyRoles !== undefined        && { notifyRoles: body.notifyRoles }),
                ...("triggerMap"         in body && { triggerMap:        body.triggerMap }),
                ...("actionLabel"        in body && { actionLabel:       body.actionLabel ?? null }),
                ...("warrantyScope"      in body && { warrantyScope:     body.warrantyScope }),
                ...("handoffRole"        in body && { handoffRole:       body.handoffRole ?? null }),
                ...("autoRevertOnClear"  in body && { autoRevertOnClear: body.autoRevertOnClear }),
            },
        });

        return NextResponse.json(updated);
    } catch (error) {
        console.error(error);
        return NextResponse.json({ error: "Failed to update sub-status" }, { status: 500 });
    }
}
