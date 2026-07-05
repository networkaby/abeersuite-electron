import { prisma } from "@/shared/lib/prisma/prismaClient";
import { createSystemInboxNotifications } from "@/modules/message/lib/inbox";
import { CONFIRMED_STATUS_LABEL } from "@/modules/ecommerce/lib/ordersPipeline";

export type TransitionOrderPipelineInput = {
    orderId: number;
    toStatusId: string;
    toStatusLabel: string;
    courier?: string | null;
    trackingNumber?: string | null;
    actorUserId: number;
};

/**
 * Pure pipeline status move for a shop order (sales-orders / P7).
 *
 * Phase 1 (COD MVP): moving stages changes the order's `statusId` only — there is
 * **NO** stock decrement and **NO** voucher / journal-entry creation. Invoice,
 * delivery, GL posting and stock movement are all done **MANUALLY** by staff
 * through the office Sale-voucher flow (which posts stock via `recordStockMovement`
 * and GL via `postInvVoucherToGl`, with real GST, on post).
 *
 * This deliberately replaces the old auto path (a crude hardcoded JE on "Paid"
 * plus a DRAFT SALE voucher on "Confirmed") that bypassed the stock ledger and
 * could double-book the same sale.
 */
export async function transitionOrderPipelineStatus(input: TransitionOrderPipelineInput) {
    const { orderId, toStatusId, toStatusLabel, courier, trackingNumber, actorUserId } = input;

    const existing = await prisma.ticket.findUnique({
        where: { id: orderId },
        select: { id: true, order: { select: { ticketId: true } } },
    });
    if (!existing?.order) throw new Error("Order not found");

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
