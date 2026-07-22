import { prisma } from "@/shared/lib/prisma/prismaClient";
import { createSystemInboxNotifications } from "@/modules/message/lib/inbox";
import { CONFIRMED_STATUS_LABEL } from "@/modules/ecommerce/lib/ordersPipeline";
import { ORDER_STAGE } from "@/modules/order/lib/orderPipeline";
import { shiprocketEnvReady } from "@/modules/delivery/lib/shiprocket";
import { pushDeliveryToShiprocket } from "@/modules/delivery/lib/shiprocketFulfil";

export type TransitionOrderPipelineInput = {
    orderId: number;
    toStatusId: string;
    toStatusLabel: string;
    courier?: string | null;
    trackingNumber?: string | null;
    actorUserId: number;
};

// Forward stages that require the order's invoice to exist first: the invoice
// (one-click ONLINE_INVOICE convert on the order page) posts revenue + GST +
// stock OUT, so goods must never be packed/dispatched before it's raised.
const INVOICE_REQUIRED_STAGES: string[] = [
    ORDER_STAGE.PACKING,
    ORDER_STAGE.DISPATCHED,
    ORDER_STAGE.DELIVERED,
];

/**
 * Pure pipeline status move for a shop order (sales-orders / P7).
 *
 * Moving stages changes the order's `statusId` only — stock + GL post via the
 * order's ONLINE_INVOICE (the one-click convert on the order detail page), never
 * from a status move. The gate below makes that invoice MANDATORY before the
 * order can advance past Confirmed (Packing / Dispatched / Delivered); Cancel and
 * Return stay open. The online payment itself is booked separately as an advance
 * RECEIPT at gateway success (markOrderPaid → postOnlineOrderReceipt).
 */
export async function transitionOrderPipelineStatus(input: TransitionOrderPipelineInput) {
    const { orderId, toStatusId, toStatusLabel, courier, trackingNumber, actorUserId } = input;

    const existing = await prisma.ticket.findUnique({
        where: { id: orderId },
        select: { id: true, order: { select: { ticketId: true } } },
    });
    if (!existing?.order) throw new Error("Order not found");

    // Invoice gate — a POSTED ONLINE_INVOICE must be linked (VoucherLink
    // SHOP_ORDER) before the order moves toward fulfilment. "Cannot transition"
    // keys the status route's 422 mapping.
    if (INVOICE_REQUIRED_STAGES.includes(toStatusId)) {
        const links = await prisma.voucherLink.findMany({
            where: { kind: "SHOP_ORDER", targetId: String(orderId) },
            select: { universalVoucherId: true },
        });
        const posted = links.length
            ? await prisma.universalVoucher.findFirst({
                  where: {
                      id: { in: links.map((l) => l.universalVoucherId) },
                      status: "POSTED",
                      deletedAt: null,
                  },
                  select: { id: true },
              })
            : null;
        if (!posted) {
            throw new Error(
                `Cannot transition to ${toStatusLabel} — create the invoice first (one click on the order page).`,
            );
        }
    }

    // An order is a Ticket (flavour "order") + TicketOrder detail. Status is the core
    // pipeline stage; courier/tracking live on the detail.
    const t = await prisma.ticket.update({
        where: { id: orderId },
        data: {
            status: toStatusId,
            order: {
                update: {
                    ...(courier !== undefined ? { courier: courier ?? null } : {}),
                    ...(trackingNumber !== undefined ? { trackingNumber: trackingNumber ?? null } : {}),
                },
            },
        },
        include: { order: { include: { lines: { include: { product: true } } } } },
    });
    // Flatten to the old ShopOrder shape (statusId ← core status) for the caller.
    const order = { ...t, ...t.order, statusId: t.status };

    const link = `/office/ecommerce/orders/${orderId}`;

    // ── Auto-book the courier at Packing ─────────────────────────────────────
    // "Start packing" tells an API courier we're ready to hand over: book the
    // shipment (AWB + pickup request + label) via the existing Shiprocket push.
    // Best-effort — a courier-API failure must NEVER block packing; staff get an
    // inbox alert and can book manually from the delivery instead.
    // SHIPWAY has no booking API yet (rates only) and OWN/CUSTOM couriers have no
    // API at all — those keep the manual dispatch path.
    if (toStatusId === ORDER_STAGE.PACKING) {
        try {
            await autoBookCourier(orderId, actorUserId, link);
        } catch (e) {
            console.error("[orderStatus] courier auto-booking failed for order", orderId, e);
            await createSystemInboxNotifications({
                roleIds: ["R1", "R2"],
                actorUserId,
                title: `Order #${orderId} — courier auto-booking failed`,
                body: `${e instanceof Error ? e.message : "Unknown error"} — book the courier manually from the delivery.`,
                link,
            }).catch(() => undefined);
        }
    }

    if (toStatusLabel === CONFIRMED_STATUS_LABEL) {
        await createSystemInboxNotifications({
            roleIds: ["R1", "R2"],
            actorUserId,
            title: `Order #${orderId} confirmed`,
            body: "Order confirmed. Raise the invoice and arrange delivery.",
            link,
        });
    }
    if (trackingNumber && toStatusLabel === "Dispatched") {
        await createSystemInboxNotifications({
            roleIds: ["R1", "R2"],
            actorUserId,
            title: `Order #${orderId} dispatched`,
            body: `Courier: ${courier ?? "—"} · Tracking: ${trackingNumber}`,
            link,
        });
    }

    // invoiceId kept in the return shape for the status route; always null now
    // because invoicing is manual.
    return { order, invoiceId: null as number | null };
}

/**
 * Book the order's chosen courier via its API when packing starts. Silently
 * skips when there's nothing to do (non-API courier, already booked, creds
 * absent, no delivery spawned); throws only on a real booking failure so the
 * caller can alert staff.
 */
async function autoBookCourier(orderId: number, actorUserId: number, link: string) {
    const order = await prisma.ticketOrder.findUnique({
        where: { ticketId: orderId },
        select: { shippingAddress: true },
    });
    const addr = (order?.shippingAddress ?? {}) as { courierKind?: string };
    if (addr.courierKind !== "SHIPROCKET") return; // Shipway: no booking API yet — manual path
    if (!shiprocketEnvReady()) return; // creds absent (dev) — manual path

    const delivery = await prisma.ticketDelivery.findFirst({
        where: { orderSource: "shop", orderId },
        select: { ticketId: true, awb: true },
    });
    if (!delivery || delivery.awb) return; // nothing spawned yet, or already booked

    const result = await pushDeliveryToShiprocket(delivery.ticketId);

    // Stamp the AWB onto the order so the header + "Mark Dispatched" pre-fill.
    await prisma.ticketOrder.update({
        where: { ticketId: orderId },
        data: { trackingNumber: result.awb },
    });
    await createSystemInboxNotifications({
        roleIds: ["R1", "R2"],
        actorUserId,
        title: `Order #${orderId} — courier booked`,
        body: `${result.courierName ?? "Shiprocket"} · AWB ${result.awb} · pickup requested.`,
        link,
    }).catch(() => undefined);
}
