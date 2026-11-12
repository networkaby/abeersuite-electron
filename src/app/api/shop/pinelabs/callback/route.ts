import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { getActiveOnlineGateways } from "@/shared/lib/payments/activeOnlineGateway";
import { getPineLabsOrder, pineLabsCreds } from "@/shared/lib/payments/pinelabs";
import { markOrderPaid } from "@/modules/order/lib/markOrderPaid";

// Pine Labs brings the customer back here after payment (success and failure alike;
// GET or a form POST — both handled). We confirm the order server-side by asking
// Pine Labs — never trusting what the return carries — then mark the order paid and
// 303-redirect to the order page (?pay=failed on any failure).

function backToOrder(req: Request, ticketId: number | null, failed: boolean): NextResponse {
    const origin = new URL(req.url).origin;
    const path = ticketId ? `/shop/order/${ticketId}${failed ? "?pay=failed" : ""}` : "/shop";
    return NextResponse.redirect(new URL(path, origin), 303);
}

async function handle(req: Request) {
    const url = new URL(req.url);
    const ticketId = Number(url.searchParams.get("ticketId"));
    if (!Number.isInteger(ticketId) || ticketId < 1) return backToOrder(req, null, true);

    const creds = await pineLabsCreds();
    if (!creds) return backToOrder(req, ticketId, true);

    const order = await prisma.ticketOrder.findUnique({
        where: { ticketId },
        select: { ticketId: true, razorpayOrderId: true, totalPaise: true, shippingChargePaise: true },
    });
    if (!order?.razorpayOrderId) return backToOrder(req, ticketId, true);

    const pl = (await getActiveOnlineGateways()).find((g) => g.provider === "pinelabs");
    const env: "TEST" | "LIVE" = pl?.environment === "LIVE" ? "LIVE" : "TEST";

    const status = await getPineLabsOrder(env, creds, order.razorpayOrderId);
    if (!status?.paid) return backToOrder(req, ticketId, true);

    // Defence in depth: the paid amount must equal the order's grand total.
    const expected = (order.totalPaise ?? 0) + (order.shippingChargePaise ?? 0);
    if (status.amountPaise !== expected) {
        console.warn(`[pinelabs] order ${ticketId}: paid ${status.amountPaise}, expected ${expected} (paise) — not marked paid`);
        return backToOrder(req, ticketId, true);
    }

    const result = await markOrderPaid(ticketId, {
        paymentId: order.razorpayOrderId,
        gatewayLabel: "Pine Labs",
        provider: "pinelabs",
    });
    return backToOrder(req, ticketId, !result.ok);
}

export const GET = handle;
export const POST = handle;
