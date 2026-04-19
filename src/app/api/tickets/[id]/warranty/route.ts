import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/permissions";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Params) {
    const { user, response } = await requirePermission("warranty:convert");
    if (response) return response;

    try {
        const { id } = await params;
        const ticketId = Number(id);
        const body = await req.json();

        const ticket = await prisma.ticket.findUnique({
            where: { id: ticketId },
            select: { isWarranty: true, warrantyStatus: true, subStatusId: true, ticketSubStatus: { select: { warrantyScope: true } } },
        });
        if (!ticket) return NextResponse.json({ error: "Not found" }, { status: 404 });

        const toWarranty: boolean = body.isWarranty ?? !ticket.isWarranty;
        const toStatus: string = body.warrantyStatus ?? (toWarranty ? "claimed" : "none");
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

        // Notify all R3 users (Front Desk) to call the customer
        const r3Users = await prisma.user.findMany({
            where: { role: "R3" },
            select: { id: true },
        });
        if (r3Users.length > 0) {
            const message = voidReason
                ? `Ticket #${ticketId}: Warranty voided (${voidReason}). Customer approval needed for paid repair.`
                : toWarranty
                ? `Ticket #${ticketId}: Confirmed under warranty. Inform customer — no charge.`
                : `Ticket #${ticketId}: Converted to non-warranty. Customer notification needed.`;

            await prisma.notification.createMany({
                data: r3Users.map((u) => ({
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
