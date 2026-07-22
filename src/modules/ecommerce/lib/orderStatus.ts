import { prisma } from "@/shared/lib/prisma/prismaClient";
import { createSystemInboxNotifications } from "@/modules/message/lib/inbox";
import { CONFIRMED_STATUS_LABEL } from "@/modules/ecommerce/lib/ordersPipeline";
import { ORDER_STAGE } from "@/modules/order/lib/orderPipeline";

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
