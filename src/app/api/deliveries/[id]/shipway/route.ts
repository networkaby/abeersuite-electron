import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { shipwayEnvReady } from "@/modules/delivery/lib/shipway";
import { pushDeliveryToShipway } from "@/modules/delivery/lib/shipwayFulfil";

// POST /api/deliveries/[id]/shipway — book the Shipway shipment for this
// delivery: one push creates the order + assigns the AWB on the chosen carrier
// + returns the label, then a best-effort pickup request; the AWB/tracking are
// stamped back on and the delivery moves to "Carrier Assigned". Mirrors the
// Shiprocket route at ../shiprocket.
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
    const { response } = await requireAuth();
    if (response) return response;

    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id) || id < 1) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    if (!(await shipwayEnvReady())) {
        return NextResponse.json(
            { error: "Shipway is not connected. Set SHIPWAY_USERNAME / SHIPWAY_LICENSE in the environment." },
            { status: 400 }
        );
    }

    try {
        const result = await pushDeliveryToShipway(id);
        return NextResponse.json({ ok: true, ...result });
    } catch (e) {
        return handleApiError(e, "Failed to push to Shipway");
    }
}
