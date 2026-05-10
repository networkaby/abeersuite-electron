import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { transitionShopOrderStatus } from "@/modules/ecommerce/lib/order-status";
import { ShopOrderStatus } from "@/generated/prisma/enums";

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
        const rzOrderId = parsed.payload?.payment?.entity?.order_id;
        const paymentId = parsed.payload?.payment?.entity?.id;
        if (!rzOrderId) {
            return NextResponse.json({ ok: true, ignored: true });
        }

        const row = await prisma.shopOrder.findFirst({
            where: { razorpayOrderId: rzOrderId },
            select: { id: true, status: true },
        });
        if (!row) {
            return NextResponse.json({ ok: true, ignored: true });
        }

        await prisma.shopOrder.update({
            where: { id: row.id },
            data: { razorpayPaymentId: paymentId ?? null },
        });

        if (row.status === ShopOrderStatus.PENDING_PAYMENT) {
            const actor =
                (await prisma.user.findFirst({
                    where: { role: "R1" },
                    orderBy: { id: "asc" },
                    select: { id: true },
                })) ?? (await prisma.user.findFirst({ orderBy: { id: "asc" }, select: { id: true } }));

            if (actor) {
                try {
                    await transitionShopOrderStatus({
                        orderId: row.id,
                        to: ShopOrderStatus.PAID,
                        actorUserId: actor.id,
                    });
                } catch {
                    /* already PAID or invalid transition — ignore */
                }
            }
        }

        return NextResponse.json({ ok: true });
    } catch (e) {
        console.error(e);
        return NextResponse.json({ ok: false }, { status: 500 });
    }
}
