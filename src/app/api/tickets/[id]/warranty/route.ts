import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth-guard";
import { z } from "zod";

type Params = { params: Promise<{ id: string }> };

const warrantySchema = z.object({
    isWarranty: z.boolean().optional(),
    warrantyStatus: z.string().trim().optional(),
    voidReason: z.string().trim().optional().nullable(),
    warrantyRef: z.string().trim().optional().nullable(),
    purchaseDate: z.string().trim().optional().nullable(),
    note: z.string().optional().nullable(),
});

export async function POST(req: Request, { params }: Params) {
    const { user, response } = await requirePermission("warranty:convert");
    if (response) return response;

    try {
        const { id } = await params;
        const ticketId = Number(id);
        const parsed = warrantySchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid warranty payload" }, { status: 400 });
        }
        const body = parsed.data;

        const ticket = await prisma.ticket.findUnique({
            where: { id: ticketId },
            select: { isWarranty: true, warrantyStatus: true, subStatusId: true, ticketSubStatus: { select: { warrantyScope: true } } },
        });
        if (!ticket) return NextResponse.json({ error: "Not found" }, { status: 404 });

        const toWarranty: boolean = body.isWarranty ?? !ticket.isWarranty;
        const toStatus: string = body.warrantyStatus ?? (toWarranty ? "CLAIMED" : "NONE");
        const voidReason: string | null = body.voidReason ?? null;

        // Clear sub-status if it won't apply to the new warranty state
        let clearSubStatus = false;
        if (ticket.subStatusId && ticket.ticketSubStatus) {
            const scope = ticket.ticketSubStatus.warrantyScope;
            if (scope !== "any") {
                const scopeMatchesWarranty = scope === "warranty_only" && !toWarranty;
                const scopeMatchesNonWarranty = scope === "non_warranty_only" && toWarranty;
                if (scopeMatchesWarranty || scopeMatchesNonWarranty) {
                    clearSubStatus = true;
                }
            }
        }

        // Pick bridge sub-status: SS36 for void, SS37 for warranty confirmation
        const bridgeSubStatusId = voidReason ? "SS36" : (toWarranty ? "SS37" : null);

        const updated = await prisma.ticket.update({
            where: { id: ticketId },
            data: {
                isWarranty: toWarranty,
                warrantyStatus: toStatus,
                voidReason: voidReason,
                warrantyRef: body.warrantyRef ?? undefined,
                purchaseDate: body.purchaseDate ? new Date(body.purchaseDate) : undefined,
                ...(clearSubStatus || bridgeSubStatusId ? { subStatusId: bridgeSubStatusId } : {}),
            },
        });

        await prisma.warrantyLog.create({
            data: {
                ticketId,
                fromWarranty: ticket.isWarranty,
                toWarranty,
                fromStatus: ticket.warrantyStatus,
                toStatus,
                voidReason: voidReason,
                note: body.note ?? null,
                changedById: user.id,
            },
        });

        // Notify all Front Desk users to call the customer
        // We find users who have the role R3 or permissions that match
        const frontDeskUsers = await prisma.user.findMany({
            where: { role: "R3" },
            select: { id: true },
        });
        if (frontDeskUsers.length > 0) {
            const message = voidReason
                ? `Ticket #${ticketId}: Warranty voided (${voidReason}). Customer approval needed for paid repair.`
                : toWarranty
                ? `Ticket #${ticketId}: Confirmed under warranty. Inform customer — no charge.`
                : `Ticket #${ticketId}: Converted to non-warranty. Customer notification needed.`;

            await prisma.notification.createMany({
                data: frontDeskUsers.map((u) => ({
                    userId: u.id,
                    ticketId,
                    message,
                    type: "warranty",
                })),
                skipDuplicates: true,
            });
        }

        return NextResponse.json(updated);
    } catch (e) {
        console.error(e);
        return NextResponse.json({ error: "Failed to convert warranty status" }, { status: 500 });
    }
}
