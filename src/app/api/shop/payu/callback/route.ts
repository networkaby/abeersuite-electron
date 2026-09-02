import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { payuCreds, verifyPayuResponse, payuAmount } from "@/shared/lib/payments/payu";
import { markOrderPaid } from "@/modules/order/lib/markOrderPaid";
import { publishChangeServer } from "@/shared/lib/realtime/serverPublish";

// PayU posts the payment result (application/x-www-form-urlencoded) to this URL as
// both surl (success) and furl (failure). We verify the reverse hash, confirm the
// amount, mark the order paid, then 303-redirect the customer's browser back to
// their order page (303 flips PayU's POST into a GET). A forged/failed post just
// lands them back on the order page with ?pay=failed.

/** 303 redirect to the order page (or shop home when we can't resolve the order). */
function backToOrder(req: Request, ticketId: number | null, failed: boolean): NextResponse {
    const origin = new URL(req.url).origin;
    const path = ticketId
        ? `/shop/order/${ticketId}${failed ? "?pay=failed" : ""}`
        : "/shop";
    return NextResponse.redirect(new URL(path, origin), 303);
}

/** Parse the order id we embedded in the txnid (SHOP<id>T…) as a fallback. */
function ticketIdFromTxnid(txnid: string): number | null {
    const m = /^SHOP(\d+)T/u.exec(txnid);
    return m ? Number(m[1]) : null;
}

export async function POST(req: Request) {
    const body: Record<string, string> = {};
    try {
        const form = await req.formData();
        for (const [k, v] of form.entries()) body[k] = typeof v === "string" ? v : "";
    } catch {
        return backToOrder(req, null, true);
    }

    const txnid = body.txnid ?? "";
    const fallbackId = ticketIdFromTxnid(txnid);

    const creds = payuCreds();
    // Reject anything we can't cryptographically trust or that PayU didn't mark paid.
    if (!creds || !verifyPayuResponse(creds.salt, body) || body.status !== "success") {
        return backToOrder(req, fallbackId, true);
    }

    const order = await prisma.ticketOrder.findFirst({
        where: { razorpayOrderId: txnid },
        select: { ticketId: true, totalPaise: true, shippingChargePaise: true },
    });
    if (!order) return backToOrder(req, fallbackId, true);

    // Defence in depth: the paid amount must equal the order's grand total.
    const expected = payuAmount((order.totalPaise ?? 0) + (order.shippingChargePaise ?? 0));
    if (body.amount !== expected) return backToOrder(req, order.ticketId, true);

    const paymentId = body.mihpayid || body.payuMoneyId || `PAYU-${txnid}`;
    const result = await markOrderPaid(order.ticketId, {
        paymentId,
        gatewayLabel: "PayU",
        provider: "payu",
    });
    if (!result.ok) return backToOrder(req, order.ticketId, true);

    // PayU posted straight here — no browser, so no axios interceptor to announce
    // the write. Published after markOrderPaid returned, i.e. after commit.
    void publishChangeServer(["ledger", "stock"]);
    return backToOrder(req, order.ticketId, false);
}

// PayU always POSTs; a stray GET just returns the customer to the shop.
export async function GET(req: Request) {
    return NextResponse.redirect(new URL("/shop", new URL(req.url).origin), 303);
}
