import { NextResponse } from "next/server";
import { handleApiError } from "@/shared/lib/api";
import { getPayableOnlineGateways } from "@/shared/lib/payments/activeOnlineGateway";
import { resolvePayOnDelivery } from "@/shared/lib/payments/payOnDeliveryMethod";

// Public storefront read: which payment rails the checkout may offer. Returns
// NON-SECRET display info only — no keys.
//   online         → every enabled online gateway with a working pay flow (0..n).
//   payOnDelivery  → our "pay later" rail; `availableHere` folds in the Active
//                    toggle + the area rule for the passed ?pincode=&state=.
// With no pincode, `availableHere` reflects only the Active state (optimistic).

export async function GET(req: Request) {
    try {
        const url = new URL(req.url);
        const pincode = url.searchParams.get("pincode")?.trim() || undefined;
        const state = url.searchParams.get("state")?.trim() || undefined;

        const [gateways, pod] = await Promise.all([
            getPayableOnlineGateways(),
            resolvePayOnDelivery(pincode, state),
        ]);
        return NextResponse.json({
            // Every online gateway with a working pay flow (may be more than one).
            online: gateways.map((g) => ({ provider: g.provider, displayName: g.displayName })),
            payOnDelivery: {
                active: pod.active,
                availableHere: pod.availableHere,
                displayName: pod.displayName,
            },
        });
    } catch (e) {
        return handleApiError(e, "Failed to read payment config");
    }
}
