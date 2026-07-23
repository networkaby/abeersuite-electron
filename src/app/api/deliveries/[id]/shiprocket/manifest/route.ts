import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { shiprocketEnvReady, shiprocketPrintManifest } from "@/modules/delivery/lib/shiprocket";

// POST /api/deliveries/[id]/shiprocket/manifest — generate + fetch the pickup
// manifest PDF (the sheet the courier's pickup agent signs at handover) for
// this booked shipment. The client opens the returned URL to print.
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
    const { response } = await requireAuth();
    if (response) return response;

    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id) || id < 1) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    if (!shiprocketEnvReady()) {
        return NextResponse.json({ error: "Shiprocket is not connected." }, { status: 400 });
    }

    try {
        const del = await prisma.ticketDelivery.findUnique({
            where: { ticketId: id },
            select: { shipmentId: true, shiprocketOrderId: true, awb: true },
        });
        if (!del?.shipmentId || !del.awb || !del.shiprocketOrderId) {
            return NextResponse.json({ error: "Book the courier first — no shipment/AWB yet." }, { status: 400 });
        }
        const { manifestUrl } = await shiprocketPrintManifest(del.shipmentId, del.shiprocketOrderId);
        if (!manifestUrl) {
            return NextResponse.json({ error: "Shiprocket did not return a manifest URL — try again shortly." }, { status: 502 });
        }
        return NextResponse.json({ ok: true, manifestUrl });
    } catch (e) {
        return handleApiError(e, "Failed to fetch the manifest");
    }
}
