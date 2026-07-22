import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { getActiveOnlineGateways } from "@/shared/lib/payments/activeOnlineGateway";
import { cashfreeCreds, getCashfreeOrder } from "@/shared/lib/payments/cashfree";
import { markOrderPaid } from "@/modules/order/lib/markOrderPaid";

// Cashfree redirects the customer here (GET) after payment. We confirm the order's
// status server-side (querying Cashfree — never trusting the redirect), then mark
// the order paid and 303-redirect to the order page (?pay=failed on any failure).

function backToOrder(req: Request, ticketId: number | null, failed: boolean): NextResponse {
    const origin = new URL(req.url).origin;
    const path = ticketId ? `/shop/order/${ticketId}${failed ? "?pay=failed" : ""}` : "/shop";
    return NextResponse.redirect(new URL(path, origin), 303);
}

export async function GET(req: Request) {
    const url = new URL(req.url);
    const ticketId = Number(url.searchParams.get("ticketId"));
    if (!Number.isInteger(ticketId) || ticketId < 1) return backToOrder(req, null, true);

    const creds = cashfreeCreds();
    if (!creds) return backToOrder(req, ticketId, true);

    const order = await prisma.ticketOrder.findUnique({
        where: { ticketId },
        select: { ticketId: true, razorpayOrderId: true, totalPaise: true, shippingChargePaise: true },
    });
    if (!order?.razorpayOrderId) return backToOrder(req, ticketId, true);

    const cf = (await getActiveOnlineGateways()).find((g) => g.provider === "cashfree");
    const env: "TEST" | "LIVE" = cf?.environment === "LIVE" ? "LIVE" : "TEST";

    const status = await getCashfreeOrder(env, creds, order.razorpayOrderId);
    if (!status || status.status !== "PAID") return backToOrder(req, ticketId, true);

    // Defence in depth: the paid amount must equal the order's grand total.
    const expected = Number((((order.totalPaise ?? 0) + (order.shippingChargePaise ?? 0)) / 100).toFixed(2));
    if (Number(status.amount) !== expected) return backToOrder(req, ticketId, true);

    const result = await markOrderPaid(ticketId, {
        paymentId: order.razorpayOrderId,
        gatewayLabel: "Cashfree",
        provider: "cashfree",
    });
    return backToOrder(req, ticketId, !result.ok);
}
