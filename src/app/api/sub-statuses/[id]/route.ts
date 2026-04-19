import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth-guard";

// DELETE /api/sub-statuses/[id]
export async function DELETE(
    _: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { response } = await requireRole("R1");
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
    const { response } = await requireRole("R1");
    if (response) return response;
    try {
        const { id } = await params;
        const body = await req.json();

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
                ...("triggerMap"    in body && { triggerMap:    body.triggerMap }),
                ...("actionLabel"  in body && { actionLabel:   body.actionLabel ?? null }),
                ...("warrantyScope" in body && { warrantyScope: body.warrantyScope }),
            },
        });

        return NextResponse.json(updated);
    } catch (error) {
        console.error(error);
        return NextResponse.json({ error: "Failed to update sub-status" }, { status: 500 });
    }
}
