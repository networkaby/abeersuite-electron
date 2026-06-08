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
    const existing = await prisma.delivery.findFirst({
        where: { orderSource: ref.source, orderId: ref.id },
        select: { id: true },
    });
    if (existing) return;
    const pipeline = await getDeliveryPipeline();
    const entry = pipeline?.statuses.find((s) => s.isEntryPoint) ?? pipeline?.statuses[0];
    if (!pipeline || !entry) return;
    await prisma.delivery.create({
        data: {
            orderSource: ref.source,
            orderId: ref.id,
            pipelineId: pipeline.id,
            statusId: entry.id,
            carrier: "OWN_BOY", // default to the in-house delivery boy; carrier/rate-shop is Phase 4b
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
