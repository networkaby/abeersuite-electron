import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";

// PATCH /api/deliveries/[id] — update carrier / AWB / tracking / amounts.
// Every dispatch option is a "carrier", including the in-house boy and pickup.
const CARRIERS = ["SHIPROCKET", "CUSTOM", "OWN_BOY", "PICKUP"];

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requireAuth();
    if (response) return response;

    const id = Number((await params).id);
    if (!Number.isInteger(id) || id < 1) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    try {
        const body = (await req.json()) as {
            carrier?: string | null; awb?: string | null; trackingUrl?: string | null;
            chargeToCustomerPaise?: number; costToCarrierPaise?: number;
        };
        const data: Record<string, unknown> = {};
        if (body.carrier !== undefined) {
            if (body.carrier && !CARRIERS.includes(body.carrier)) {
                return NextResponse.json({ error: "Unknown carrier" }, { status: 400 });
            }
            data.carrier = body.carrier || null;
        }
        if (body.awb !== undefined) data.awb = body.awb?.trim() || null;
        if (body.trackingUrl !== undefined) data.trackingUrl = body.trackingUrl?.trim() || null;
        if (body.chargeToCustomerPaise !== undefined) data.chargeToCustomerPaise = Math.max(0, Math.round(Number(body.chargeToCustomerPaise) || 0));
        if (body.costToCarrierPaise !== undefined) data.costToCarrierPaise = Math.max(0, Math.round(Number(body.costToCarrierPaise) || 0));

        if (Object.keys(data).length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

        // Carrier / AWB / tracking / amounts live on the TicketDelivery detail (keyed
        // by ticketId — the delivery's id is its Ticket id).
        const updated = await prisma.ticketDelivery.update({
            where: { ticketId: id },
            data,
            select: { ticketId: true, carrier: true, awb: true, trackingUrl: true, chargeToCustomerPaise: true, costToCarrierPaise: true },
        });
        return NextResponse.json({ ...updated, id: updated.ticketId });
    } catch (e) {
        return handleApiError(e, "Failed to update delivery");
    }
}
