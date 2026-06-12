import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";

type Params = { params: Promise<{ id: string }> };

const warrantySchema = z.object({
    isWarranty: z.boolean().optional(),
    warrantyStatus: z.enum(["NONE", "ACTIVE", "VOID", "CLAIMED"]).optional(),
    voidReason: z.string().trim().optional().nullable(),
    warrantyRef: z.string().trim().optional().nullable(),
    purchaseDate: z.string().trim().optional().nullable(),
    note: z.string().optional().nullable(),
});

export async function POST(req: Request, { params }: Params) {
    // TODO(rbac): was requirePermission(WARRANTY_CONVERT) — open to all staff for now.
    const { user, response } = await requireAuth();
    if (response) return response;

    try {
        const { id } = await params;
        const ticketId = Number(id);
        const { data, error } = await validateRequest(req, warrantySchema);
        if (error) return error;
        const body = data;

        const ticket = await prisma.ticket.findUnique({
            where: { id: ticketId },
            select: { isWarranty: true, warrantyStatus: true, workerId: true, ticketWorker: { select: { warrantyScope: true } } },
        });
        if (!ticket) return NextResponse.json({ error: "Not found" }, { status: 404 });

        const toWarranty: boolean = body.isWarranty ?? !ticket.isWarranty;
        const toStatus = body.warrantyStatus ?? (toWarranty ? "CLAIMED" : "NONE");
        const voidReason: string | null = body.voidReason ?? null;

        // Clear worker if it won't apply to the new warranty state
        let clearWorker = false;
        if (ticket.workerId && ticket.ticketWorker) {
            const scope = ticket.ticketWorker.warrantyScope;
            if (scope !== "any") {
                const scopeMatchesWarranty = scope === "warranty_only" && !toWarranty;
                const scopeMatchesNonWarranty = scope === "non_warranty_only" && toWarranty;
                if (scopeMatchesWarranty || scopeMatchesNonWarranty) {
                    clearWorker = true;
                }
            }
        }

        // Pick bridge worker: SS36 for void, SS37 for warranty confirmation
        const bridgeWorkerId = voidReason ? "SS36" : (toWarranty ? "SS37" : null);

        const updated = await prisma.ticket.update({
            where: { id: ticketId },
            data: {
                isWarranty: toWarranty,
                warrantyStatus: toStatus,
                voidReason: voidReason,
                warrantyRef: body.warrantyRef ?? undefined,
                purchaseDate: body.purchaseDate ? new Date(body.purchaseDate) : undefined,
                ...(clearWorker || bridgeWorkerId ? { workerId: bridgeWorkerId } : {}),
            },
        });

        // Record the change in TicketLog (who / why / when)
        const logNote = voidReason
            ? `Warranty voided: ${voidReason}${body.note ? ` — ${body.note}` : ""}`
            : toWarranty
            ? `Converted to warranty${body.note ? ` — ${body.note}` : ""}`
            : `Converted to paid repair${body.note ? ` — ${body.note}` : ""}`;

        await prisma.ticketLog.create({
            data: {
                ticketId,
                status:     updated.status,
                note:       logNote,
                userId:     user.id,
                visibility: "INTERNAL",
            },
        });

        return NextResponse.json(updated);
    } catch (e) {
        return handleApiError(e, "Failed to convert warranty status");
    }
}
