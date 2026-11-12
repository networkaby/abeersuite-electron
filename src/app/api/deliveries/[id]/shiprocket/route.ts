import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { shiprocketEnvReady } from "@/modules/delivery/lib/shiprocket";
import { pushDeliveryToShiprocket } from "@/modules/delivery/lib/shiprocketFulfil";

// POST /api/deliveries/[id]/shiprocket — create the Shiprocket shipment for this
// delivery: create order → assign AWB → schedule pickup → fetch label, then stamp
// the AWB/tracking back on and move the delivery to "Carrier Assigned".
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
    const { response } = await requireAuth();
    if (response) return response;

    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id) || id < 1) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    if (!(await shiprocketEnvReady())) {
        return NextResponse.json(
            { error: "Shiprocket is not connected. Set SHIPROCKET_EMAIL / SHIPROCKET_PASSWORD in the environment." },
            { status: 400 }
        );
    }

    try {
        const result = await pushDeliveryToShiprocket(id);
        return NextResponse.json({ ok: true, ...result });
    } catch (e) {
        return handleApiError(e, "Failed to push to Shiprocket");
    }
}
