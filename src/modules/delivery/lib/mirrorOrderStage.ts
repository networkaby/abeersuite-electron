// SERVER-ONLY. Mirrors a courier milestone (P8 delivery stage) onto the P7
// order — shared by the Shiprocket and Shipway tracking webhooks. Forward-only,
// so a late or out-of-order callback never walks the order backwards:
//   picked up / in transit / OFD → Dispatched (only from Packing)
//   delivered                    → Delivered  (from Packing or Dispatched)
//   failed / RTO                 → order untouched; staff inbox alert

import { prisma } from "@/shared/lib/prisma/prismaClient";
import { createSystemInboxNotifications } from "@/modules/message/lib/inbox";
import { ORDER_STAGE } from "@/modules/order/lib/orderPipeline";
import { DELIVERY_STAGE } from "./shiprocketStatus";

// P8 delivery stages that mean the parcel LEFT us → order Dispatched.
const MOVING_STAGES: string[] = [
    DELIVERY_STAGE.PICKED_UP,
    DELIVERY_STAGE.IN_TRANSIT,
    DELIVERY_STAGE.OUT_FOR_DELIVERY,
];

export async function mirrorStageToOrder(
    del: { orderSource: string; orderId: number },
    stage: string,
    awb: string,
) {
    if (del.orderSource !== "shop") return;

    if (stage === DELIVERY_STAGE.FAILED_RTO) {
        await createSystemInboxNotifications({
            roleIds: ["R1", "R2"],
            title: `Order #${del.orderId} — delivery failed / RTO`,
            body: `Courier reported a failure for AWB ${awb}. Check the delivery and arrange re-ship or return.`,
            link: `/office/ecommerce/orders/${del.orderId}`,
        });
        return;
    }

    const target = MOVING_STAGES.includes(stage)
        ? { to: ORDER_STAGE.DISPATCHED, from: [ORDER_STAGE.PACKING] }
        : stage === DELIVERY_STAGE.DELIVERED
          ? { to: ORDER_STAGE.DELIVERED, from: [ORDER_STAGE.PACKING, ORDER_STAGE.DISPATCHED] }
          : null;
    if (!target) return;

    // updateMany + status filter = atomic forward-only move (no-op when the
    // order already advanced past — or was cancelled).
    const moved = await prisma.ticket.updateMany({
        where: { id: del.orderId, status: { in: target.from } },
        data: { status: target.to },
    });
    if (moved.count > 0) {
        // Stamp the milestone time for the customer timeline (first arrival only).
        await prisma.ticketOrder
            .update({
                where: { ticketId: del.orderId },
                data:
                    target.to === ORDER_STAGE.DELIVERED
                        ? { deliveredAt: new Date() }
                        : { shippedAt: new Date() },
            })
            .catch(() => undefined);
    }
}
