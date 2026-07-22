import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { shiprocketStatusToStage, DELIVERY_STAGE } from "@/modules/delivery/lib/shiprocketStatus";
import { ORDER_STAGE } from "@/modules/order/lib/orderPipeline";
import { createSystemInboxNotifications } from "@/modules/message/lib/inbox";

// POST /api/shop/delivery-updates — carrier tracking callback (used by Shiprocket).
//
// NOTE: the path deliberately avoids the words "shiprocket", "kartrocket", "sr",
// "kr" — Shiprocket rejects webhook URLs containing those keywords.
//
// Configure this URL in Shiprocket → Settings → Additional Settings → Webhooks,
// pick Auth Token Type "x-api-key", and set a Token there; Shiprocket sends it as
// the `x-api-key` header. We reject calls whose header doesn't match
// SHIPROCKET_WEBHOOK_TOKEN (when that env is set). The payload carries the AWB +
// current status; we map it onto the P8 delivery stage for the matching delivery.
// Always returns 200 quickly (Shiprocket requirement).

type WebhookBody = {
    awb?: string;
    current_status?: string;
    current_status_id?: number;
    shipment_status?: string;
    shipment_status_id?: number;
};

export async function POST(req: Request) {
    // Verify the shared secret when configured. When it's unset (dev), accept.
    const expected = process.env.SHIPROCKET_WEBHOOK_TOKEN?.trim();
    if (expected) {
        const got = req.headers.get("x-api-key")?.trim();
        if (got !== expected) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    try {
        const body = (await req.json().catch(() => ({}))) as WebhookBody;
        const awb = body.awb?.trim();
        if (!awb) return NextResponse.json({ ok: true, skipped: "no awb" });

        const del = await prisma.ticketDelivery.findFirst({
            where: { awb },
            select: { ticketId: true, orderSource: true, orderId: true },
        });
        if (!del) return NextResponse.json({ ok: true, skipped: "unknown awb" });

        const stage = shiprocketStatusToStage({
            statusId: body.current_status_id ?? body.shipment_status_id ?? null,
            status: body.current_status ?? body.shipment_status ?? null,
        });
        if (stage) {
            await prisma.ticket.update({ where: { id: del.ticketId }, data: { status: stage } });
            // Mirror major courier milestones onto the P7 order (shop orders only,
            // forward-only): picked up / moving → Dispatched, delivered → Delivered.
            // Failed/RTO never moves the order — staff get an inbox alert instead.
            await mirrorStageToOrder(del, stage, awb).catch(() => undefined);
        }
        return NextResponse.json({ ok: true, statusId: stage });
    } catch {
        // Never 500 a webhook — Shiprocket retries and floods. Log-and-200.
        return NextResponse.json({ ok: true });
    }
}

// P8 delivery stages that mean the parcel LEFT us → order Dispatched.
const MOVING_STAGES: string[] = [
    DELIVERY_STAGE.PICKED_UP,
    DELIVERY_STAGE.IN_TRANSIT,
    DELIVERY_STAGE.OUT_FOR_DELIVERY,
];

/**
 * Mirror a courier milestone onto the P7 order — forward-only, so a late or
 * out-of-order webhook never walks the order backwards:
 *   picked up / in transit / OFD → Dispatched (only from Packing)
 *   delivered                    → Delivered  (from Packing or Dispatched)
 *   failed / RTO                 → order untouched; staff inbox alert
 */
async function mirrorStageToOrder(
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
    await prisma.ticket.updateMany({
        where: { id: del.orderId, status: { in: target.from } },
        data: { status: target.to },
    });
}
