import { prisma } from "@/shared/lib/prisma/prismaClient";
import type { OrderRef } from "@/modules/order/lib/orderAdapter";

// O2C Delivery sub-pipeline (P8). A Delivery is spawned when an order is Confirmed
// and tracks the dispatch independently, reporting a coarse status back to the order.
export const DELIVERY_PIPELINE_NAME = "delivery" as const;

export async function getDeliveryPipeline() {
    return prisma.pipeline.findUnique({
        where: { name: DELIVERY_PIPELINE_NAME },
        include: { statuses: { orderBy: { order: "asc" } } },
    });
}

/** Spawn a Delivery for a confirmed order (idempotent — one delivery per order). */
export async function spawnDelivery(ref: OrderRef): Promise<void> {
    // A delivery is a Ticket (flavour "delivery") + TicketDelivery detail; the core
    // Ticket carries the pipeline stage, the detail the carrier + polymorphic order ref.
    const existing = await prisma.ticket.findFirst({
        where: { delivery: { orderSource: ref.source, orderId: ref.id } },
        select: { id: true },
    });
    if (existing) return;
    const pipeline = await getDeliveryPipeline();
    const entry = pipeline?.statuses.find((s) => s.isEntryPoint) ?? pipeline?.statuses[0];
    if (!pipeline || !entry) return;

    // A shop order carries the courier the customer chose at checkout + the
    // shipping address + the charge they paid — inherit them onto the delivery.
    // An inv (counter/office) order has no such choice, so fall back to OWN_BOY.
    let carrier = "OWN_BOY";
    let addressJson: unknown = null;
    let chargeToCustomerPaise = 0;
    if (ref.source === "shop") {
        const order = await prisma.ticketOrder.findUnique({
            where: { ticketId: ref.id },
            select: { courier: true, shippingAddress: true, shippingChargePaise: true },
        });
        if (order) {
            carrier = order.courier ?? "OWN_BOY";
            addressJson = order.shippingAddress ?? null;
            chargeToCustomerPaise = order.shippingChargePaise ?? 0;
        }
    }

    await prisma.ticket.create({
        data: {
            pipelineId: pipeline.id,
            status: entry.id,
            delivery: {
                create: {
                    orderSource: ref.source,
                    orderId: ref.id,
                    carrier,
                    addressJson: addressJson ?? undefined,
                    chargeToCustomerPaise,
                },
            },
        },
    });
}

/** Validate that a statusId belongs to the delivery pipeline. */
export async function assertDeliveryStatus(statusId: string): Promise<{ ok: true } | { ok: false; message: string }> {
    const st = await prisma.ticketStatus.findUnique({
        where: { id: statusId },
        select: { pipeline: { select: { name: true } } },
    });
    if (!st || st.pipeline?.name !== DELIVERY_PIPELINE_NAME) {
        return { ok: false, message: "Invalid status for the Delivery pipeline" };
    }
    return { ok: true };
}
