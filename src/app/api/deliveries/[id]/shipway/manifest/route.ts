import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { shipwayEnvReady, shipwayCreateManifest } from "@/modules/delivery/lib/shipway";

// POST /api/deliveries/[id]/shipway/manifest — create the pickup manifest for
// this booked Shipway shipment. Shipway's API returns a manifest ID only (no
// print URL) — the PDF is downloaded from the Shipway panel.
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
    const { response } = await requireAuth();
    if (response) return response;

    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id) || id < 1) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    if (!(await shipwayEnvReady())) {
        return NextResponse.json({ error: "Shipway is not connected." }, { status: 400 });
    }

    try {
        const del = await prisma.ticketDelivery.findUnique({
            where: { ticketId: id },
            select: { shipmentId: true, awb: true },
        });
        // shipmentId holds the pushed Shipway order id ("WEB-<orderId>").
        if (!del?.shipmentId || !del.awb) {
            return NextResponse.json({ error: "Book the courier first — no shipment/AWB yet." }, { status: 400 });
        }
        const result = await shipwayCreateManifest([del.shipmentId]);
        return NextResponse.json({ ok: true, ...result });
    } catch (e) {
        return handleApiError(e, "Failed to create the manifest");
    }
}
