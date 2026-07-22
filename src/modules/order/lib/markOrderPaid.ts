// SERVER-ONLY. The single "an online order just got paid" transition, shared by
// every gateway success path (the demo simulate button and the PayU callback).
//
// It marks the ONLINE order PAID and advances P7 New → Confirmed (which reserves
// stock + spawns the P8 delivery) + notifies staff. It deliberately does NOT post
// to the GL — invoicing stays manual (mirrors the parked Razorpay webhook rule, so
// a gateway success never double-books).

import { prisma } from "@/shared/lib/prisma/prismaClient";
import { createSystemInboxNotifications } from "@/modules/message/lib/inbox";
import { writeOrderStatus, resolveOrderStatus } from "@/modules/order/lib/orderAdapter";
import { ORDER_STAGE } from "@/modules/order/lib/orderPipeline";
import { reserveOrder } from "@/modules/order/lib/reservation";
import { spawnDelivery } from "@/modules/delivery/lib/delivery";

export type MarkOrderPaidResult =
    | { ok: true; paid: true; alreadyPaid?: boolean; statusId: string | null }
    | { ok: false; error: string; status: number };

/**
 * Mark an ONLINE shop order paid and confirm it. Idempotent: a second call on an
 * already-paid order is a no-op success.
 *
 * @param ticketId  the order (TicketOrder.ticketId)
 * @param opts.paymentId  PSP payment reference to record (e.g. PayU mihpayid)
 * @param opts.gatewayLabel  short label for the staff notification ("PayU", "demo")
 * @param opts.customerId  when set, the order must belong to this customer
 */
export async function markOrderPaid(
    ticketId: number,
    opts: { paymentId: string; gatewayLabel: string; customerId?: number },
): Promise<MarkOrderPaidResult> {
    const order = await prisma.ticketOrder.findUnique({
        where: { ticketId },
        select: {
            ticketId: true,
            personId: true,
            paymentMethod: true,
            legacyStatus: true,
            totalPaise: true,
            shippingChargePaise: true,
        },
    });
    if (!order) return { ok: false, error: "Order not found", status: 404 };
    if (opts.customerId != null && order.personId !== opts.customerId) {
        return { ok: false, error: "This order is not yours.", status: 403 };
    }
    if (order.paymentMethod !== "ONLINE") {
        return { ok: false, error: "This order is not an online-payment order.", status: 400 };
    }
    // Idempotent: already paid (or moved past pending) → report success, do nothing.
    if (order.legacyStatus !== "PENDING_PAYMENT") {
        return { ok: true, paid: true, alreadyPaid: true, statusId: null };
    }

    await prisma.ticketOrder.update({
        where: { ticketId },
        data: { legacyStatus: "PAID", paidAt: new Date(), razorpayPaymentId: opts.paymentId },
    });

    // Advance P7 New → Confirmed (reserve stock + spawn the delivery). Best-effort:
    // the order is already marked paid; a hiccup here must not fail the call.
    let statusId: string | null = null;
    try {
        const ref = { source: "shop" as const, id: ticketId };
        const current = await resolveOrderStatus(ref);
        if (current && current.statusId !== ORDER_STAGE.CONFIRMED) {
            const allowed = await prisma.statusTransition.findFirst({
                where: {
                    fromStatusId: current.statusId ?? ORDER_STAGE.NEW,
                    toStatusId: ORDER_STAGE.CONFIRMED,
                },
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
        console.error("[markOrderPaid] confirm hooks failed for order", ticketId, e);
    }

    const grand = (order.totalPaise ?? 0) + (order.shippingChargePaise ?? 0);
    await createSystemInboxNotifications({
        roleIds: ["R1", "R2"],
        title: `Shop order #${ticketId} paid (${opts.gatewayLabel})`,
        body: `₹ ${(grand / 100).toFixed(2)} received via ${opts.gatewayLabel}.`,
        link: `/office/ecommerce/orders/${ticketId}`,
    });

    return { ok: true, paid: true, statusId };
}
