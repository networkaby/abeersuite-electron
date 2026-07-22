import { NextResponse } from "next/server";
import { handleApiError } from "@/shared/lib/api";
import { requirePortalCustomer } from "@/shared/lib/auth/portalAuthGuard";
import { isOnlineGatewayEnabled } from "@/shared/lib/payments/activeOnlineGateway";
import { markOrderPaid } from "@/modules/order/lib/markOrderPaid";

// POST /api/shop/orders/[id]/demo-pay
//
// The DEMO payment gateway's "success signal" — the floating "Simulate payment
// success" button on the order confirmation page calls this. It stands in for a
// real PSP webhook: it marks an ONLINE order paid and advances it to Confirmed
// (which reserves stock + spawns the P8 delivery), letting the whole paid-order →
// fulfilment flow be demoed without a live gateway. Guarded so it ONLY works when
// the active online gateway is the demo provider — never on a real one.

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
    try {
        const auth = await requirePortalCustomer();
        if (auth.response) return auth.response;
        const { customerId } = auth;

        const { id } = await ctx.params;
        const ticketId = parseInt(id, 10);
        if (!Number.isFinite(ticketId)) return NextResponse.json({ error: "Invalid order" }, { status: 400 });

        // Only simulate when the demo gateway is enabled for online checkout.
        if (!(await isOnlineGatewayEnabled("demo"))) {
            return NextResponse.json({ error: "Demo payment is not enabled." }, { status: 400 });
        }

        const result = await markOrderPaid(ticketId, {
            paymentId: `DEMO-${ticketId}-${Date.now()}`,
            gatewayLabel: "demo",
            customerId,
        });
        if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
        return NextResponse.json({ paid: true, alreadyPaid: result.alreadyPaid ?? false, statusId: result.statusId });
    } catch (e) {
        return handleApiError(e, "Failed to simulate payment");
    }
}
