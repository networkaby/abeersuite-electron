import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { handleApiError } from "@/shared/lib/api";
import { requirePortalCustomer } from "@/shared/lib/auth/portalAuthGuard";
import { getActiveOnlineGateway } from "@/shared/lib/payments/activeOnlineGateway";
import { createSystemInboxNotifications } from "@/modules/message/lib/inbox";
import { writeOrderStatus, resolveOrderStatus } from "@/modules/order/lib/orderAdapter";
import { ORDER_STAGE } from "@/modules/order/lib/orderPipeline";
import { reserveOrder } from "@/modules/order/lib/reservation";
import { spawnDelivery } from "@/modules/delivery/lib/delivery";

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

        // Only simulate when the active online gateway is the demo provider.
        const gateway = await getActiveOnlineGateway();
        if (!gateway || gateway.provider !== "demo") {
            return NextResponse.json({ error: "Demo payment is not enabled." }, { status: 400 });
        }

        const order = await prisma.ticketOrder.findUnique({
            where: { ticketId },
            select: { ticketId: true, personId: true, paymentMethod: true, legacyStatus: true, totalPaise: true, shippingChargePaise: true },
        });
        if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
        if (order.personId !== customerId) {
            return NextResponse.json({ error: "This order is not yours." }, { status: 403 });
        }
        if (order.paymentMethod !== "ONLINE") {
            return NextResponse.json({ error: "This order is not an online-payment order." }, { status: 400 });
        }
        // Idempotent: a second click just reports the already-paid state.
        if (order.legacyStatus === "PAID" || order.legacyStatus !== "PENDING_PAYMENT") {
            return NextResponse.json({ paid: true, alreadyPaid: true, statusId: null });
        }

        await prisma.ticketOrder.update({
            where: { ticketId },
            data: {
                legacyStatus: "PAID",
                paidAt: new Date(),
                razorpayPaymentId: `DEMO-${ticketId}-${Date.now()}`,
            },
        });

        // Advance P7 New → Confirmed (reserve stock + spawn the delivery). Best-effort:
        // the order is already marked paid; a hiccup here must not fail the call.
        let statusId: string | null = null;
        try {
            const ref = { source: "shop" as const, id: ticketId };
            const current = await resolveOrderStatus(ref);
            if (current && current.statusId !== ORDER_STAGE.CONFIRMED) {
                const allowed = await prisma.statusTransition.findFirst({
                    where: { fromStatusId: current.statusId ?? ORDER_STAGE.NEW, toStatusId: ORDER_STAGE.CONFIRMED },
                    select: { id: true },
                });
                if (allowed) {
                    await writeOrderStatus(ref, ORDER_STAGE.CONFIRMED);
                    await reserveOrder(ref);
                    await spawnDelivery(ref);
                    statusId = ORDER_STAGE.CONFIRMED;
                }
            }
        } catch (e) {
            console.error("[demo-pay] confirm hooks failed for order", ticketId, e);
        }

        const grand = (order.totalPaise ?? 0) + (order.shippingChargePaise ?? 0);
        await createSystemInboxNotifications({
            roleIds: ["R1", "R2"],
            title: `Shop order #${ticketId} paid (demo)`,
            body: `₹ ${(grand / 100).toFixed(2)} received via the demo gateway.`,
            link: `/office/ecommerce/orders/${ticketId}`,
        });

        return NextResponse.json({ paid: true, statusId });
    } catch (e) {
        return handleApiError(e, "Failed to simulate payment");
    }
}
