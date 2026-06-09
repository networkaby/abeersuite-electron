import { NextResponse } from "next/server";
import { handleApiError } from "@/shared/lib/api";
import { getActiveOnlineGateway } from "@/shared/lib/payments/activeOnlineGateway";

// Public storefront read: which online gateway (if any) is configured. Returns
// NON-SECRET display info only — no keys. Config-only this phase: the checkout
// shows "Pay online via <name>"; the live charge stays parked.

export async function GET() {
    try {
        const gw = await getActiveOnlineGateway();
        if (!gw) return NextResponse.json({ online: null });
        return NextResponse.json({
            online: { provider: gw.provider, displayName: gw.displayName },
        });
    } catch (e) {
        return handleApiError(e, "Failed to read payment config");
    }
}
