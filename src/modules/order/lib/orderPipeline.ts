import type { PrismaClient, Prisma } from "@/generated/prisma/client";

// The O2C order pipeline (seeded as P7 "sales-orders": New → Under Review →
// Confirmed → Packing → Dispatched → Delivered ; Cancelled / Returned).
// Every order — counter POS_ORDER, office SALES_ORDER, online ShopOrder — rides
// this one pipeline so they share a single Orders board. Resolve by stable name.
export const ORDER_PIPELINE_NAME = "sales-orders" as const;

export async function getOrderPipeline(db: PrismaClient | Prisma.TransactionClient) {
    return db.pipeline.findUnique({
        where: { name: ORDER_PIPELINE_NAME },
        include: { statuses: { orderBy: { order: "asc" } } },
    });
}

/** The entry stage (isEntryPoint, else first) of the order pipeline. */
export function orderEntryStatus(
    pipeline: { statuses: { id: string; isEntryPoint: boolean }[] } | null,
): string | null {
    if (!pipeline) return null;
    return (pipeline.statuses.find((s) => s.isEntryPoint) ?? pipeline.statuses[0])?.id ?? null;
}

/** Validate that `statusId` belongs to the order pipeline (mirrors assertDealStatus). */
export async function assertOrderStatus(
    db: PrismaClient | Prisma.TransactionClient,
    statusId: string,
): Promise<{ ok: true; isTerminal: boolean } | { ok: false; message: string }> {
    const st = await db.ticketStatus.findUnique({
        where: { id: statusId },
        select: { id: true, isTerminal: true, pipeline: { select: { name: true } } },
    });
    if (!st || st.pipeline?.name !== ORDER_PIPELINE_NAME) {
        return { ok: false, message: "Invalid status for the Orders pipeline" };
    }
    return { ok: true, isTerminal: st.isTerminal };
}
