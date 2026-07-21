import { NextResponse } from "next/server";
import { handleApiError } from "@/shared/lib/api";
import {
    loadDeliveryMethod,
    ownBoyAllNeighbourhoods,
    type OwnBoyConfig,
} from "@/modules/delivery/lib/deliveryMethods";

// Public storefront read: our local delivery boy's neighbourhood coverage for a
// pincode → { localities: { locality: [neighbourhoods] } }. Drives the linked
// "Locality / area" + "Neighbourhood" dropdowns at checkout. Empty map = the
// local boy doesn't serve this pincode (so no local-delivery option is offered).

export async function GET(_req: Request, ctx: { params: Promise<{ pincode: string }> }) {
    const { pincode } = await ctx.params;
    if (!/^\d{6}$/u.test(pincode)) {
        return NextResponse.json({ ok: false, localities: {} });
    }
    try {
        const method = await loadDeliveryMethod("OWN_BOY");
        const cfg = (method?.configJson ?? {}) as OwnBoyConfig;
        // Union of coverage across all vehicles (Bike/Car/…) for this pincode.
        const out = ownBoyAllNeighbourhoods(cfg, pincode);
        return NextResponse.json({ ok: Object.keys(out).length > 0, localities: out });
    } catch (e) {
        return handleApiError(e, "Failed to load local coverage");
    }
}
