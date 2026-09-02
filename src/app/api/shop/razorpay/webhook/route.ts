import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { publishChangeServer } from "@/shared/lib/realtime/serverPublish";

/**
 * Razorpay webhook — PARKED.
 *
 * TODO(payment-gateway): online payment is not live in the COD MVP. When a
 * gateway is wired back in, this handler must (1) verify the webhook signature,
 * then (2) advance the order on the sales-orders pipeline via
 * `transitionOrderPipelineStatus`. It must NOT post to the GL — invoicing stays
 * manual (the old crude `postSaleJournal` auto-JE was removed in the COD rebuild
 * to avoid double-booking).
 *
 * For now it only records the payment id against a matching order so a future
 * reconciliation pass can find it; it never changes order status.
 */
export async function POST(req: Request) {
    try {
        const body = await req.text();
        let parsed: { payload?: { payment?: { entity?: { order_id?: string; id?: string } } } };
        try {
            parsed = JSON.parse(body) as typeof parsed;
        } catch {
            return NextResponse.json({ ok: false }, { status: 400 });
        }
        const rzOrderId = parsed.payload?.payment?.entity?.order_id;
        const paymentId = parsed.payload?.payment?.entity?.id;
        if (!rzOrderId) {
            return NextResponse.json({ ok: true, ignored: true });
        }

        const row = await prisma.ticketOrder.findFirst({
            where: { razorpayOrderId: rzOrderId },
            select: { ticketId: true },
        });
        if (!row) {
            return NextResponse.json({ ok: true, ignored: true });
        }

        await prisma.ticketOrder.update({
            where: { ticketId: row.ticketId },
            data: { razorpayPaymentId: paymentId ?? null },
        });

        // Razorpay posted straight here — no browser, so no axios interceptor to
        // announce the write. Published after the update returned, i.e. after commit.
        void publishChangeServer(["ledger", "stock"]);
        return NextResponse.json({ ok: true, parked: true });
    } catch (e) {
        console.error(e);
        return NextResponse.json({ ok: false }, { status: 500 });
    }
}
