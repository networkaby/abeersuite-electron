import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

/**
 * Razorpay webhook stub — verify signature in production before trusting payload.
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
        const orderId = parsed.payload?.payment?.entity?.order_id;
        const paymentId = parsed.payload?.payment?.entity?.id;
        if (!orderId) {
            return NextResponse.json({ ok: true, ignored: true });
        }

        await prisma.shopOrder.updateMany({
            where: { razorpayOrderId: orderId },
            data: {
                status: "PAID",
                razorpayPaymentId: paymentId ?? null,
            },
        });

        return NextResponse.json({ ok: true });
    } catch {
        return NextResponse.json({ ok: false }, { status: 500 });
    }
}
