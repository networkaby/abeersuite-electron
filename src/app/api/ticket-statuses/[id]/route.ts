import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";

type Params = { params: Promise<{ id: string }> };

const ticketStatusPatchSchema = z.object({
    label: z.string().trim().min(1).optional(),
    color: z.string().trim().min(1).optional(),
    order: z.coerce.number().int().nonnegative().optional(),
    isTerminal: z.boolean().optional(),
    isEntryPoint: z.boolean().optional(),
    allowedRoles: z.array(z.string().trim()).optional(),
    notifyRoles: z.array(z.string().trim()).optional(),
    actionLabel: z.string().optional().nullable(),
    warrantyScope: z.enum(["any", "warranty_only", "non_warranty_only"]).optional(),
});

export async function PATCH(req: Request, { params }: Params) {
    const { response } = await requirePermission("settings:statuses");
    if (response) return response;
    try {
        const { id } = await params;
        const parsed = ticketStatusPatchSchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid status payload" }, { status: 400 });
        }
        const body = parsed.data;

        const status = await prisma.ticketStatus.update({
            where: { id },
            data: {
                label: body.label !== undefined ? body.label : undefined,
                color: body.color !== undefined ? body.color : undefined,
                order: body.order !== undefined ? Number(body.order) : undefined,
                isTerminal: body.isTerminal !== undefined ? body.isTerminal : undefined,
                isEntryPoint: body.isEntryPoint !== undefined ? body.isEntryPoint : undefined,
                allowedRoles: body.allowedRoles !== undefined ? body.allowedRoles : undefined,
                notifyRoles: body.notifyRoles !== undefined ? body.notifyRoles : undefined,
                actionLabel: "actionLabel" in body ? (body.actionLabel ?? null) : undefined,
                warrantyScope: body.warrantyScope !== undefined ? body.warrantyScope : undefined,
            },
        });
        return NextResponse.json(status);
    } catch {
        return NextResponse.json({ error: "Failed to update status" }, { status: 500 });
    }
}

export async function DELETE(_: Request, { params }: Params) {
    const { response } = await requirePermission("settings:statuses");
    if (response) return response;
    try {
        const { id } = await params;

        const inUse = await prisma.ticket.count({ where: { status: id } });
        if (inUse > 0) {
            return NextResponse.json(
                { error: `Cannot delete: ${inUse} ticket(s) currently use this status.` },
                { status: 400 }
            );
        }

        // Transitions cascade automatically via ON DELETE CASCADE
        await prisma.ticketStatus.delete({ where: { id } });
        return NextResponse.json({ success: true });
    } catch {
        return NextResponse.json({ error: "Failed to delete status" }, { status: 500 });
    }
}
