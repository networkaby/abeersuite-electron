import { prisma } from "@/shared/lib/prisma/prismaClient";
import type { OrderRef } from "./orderAdapter";

// O2C stock reservation (Phase 2, org-wide). When an order is Confirmed we HOLD
// its line quantities (available-to-sell = stock − reserved) so the goods can't
// be sold out from under it; on Cancel/Return we release the hold; at Fulfil the
// hold is converted to a real stock-out. GL-silent — reservation only moves the
// `reserved` counter, never the books. Idempotent: reserving twice is a no-op.

async function orderLines(ref: OrderRef): Promise<{ productId: number; quantity: number }[]> {
    if (ref.source === "inv") {
        // Phase 5 5C: goods lines hang off the spine.
        const v = await prisma.invVoucher.findUnique({ where: { id: ref.id }, select: { universalVoucherId: true } });
        const lines = v?.universalVoucherId != null
            ? await prisma.voucherInventoryLine.findMany({ where: { universalVoucherId: v.universalVoucherId }, select: { productId: true, quantity: true } })
            : [];
        return lines.map((l) => ({ productId: l.productId, quantity: Math.round(Number(l.quantity)) }));
    }
    const o = await prisma.shopOrder.findUnique({
        where: { id: ref.id },
        select: { lines: { select: { productId: true, quantity: true } } },
    });
    return (o?.lines ?? []).map((l) => ({ productId: l.productId, quantity: l.quantity }));
}

/** Hold stock for an order's lines (no-op if already held, or for untracked products). */
export async function reserveOrder(ref: OrderRef): Promise<void> {
    const lines = await orderLines(ref);
    if (lines.length === 0) return;
    await prisma.$transaction(async (tx) => {
        const already = await tx.stockReservation.count({
            where: { orderSource: ref.source, orderId: ref.id, status: "HELD" },
        });
        if (already > 0) return; // idempotent
        for (const l of lines) {
            if (!(l.quantity > 0)) continue;
            // Only tracked products (stock != null) participate in reservation.
            const p = await tx.invProduct.findUnique({ where: { id: l.productId }, select: { stock: true } });
            if (p?.stock == null) continue;
            await tx.stockReservation.create({
                data: { orderSource: ref.source, orderId: ref.id, productId: l.productId, quantity: l.quantity, status: "HELD" },
            });
            await tx.invProduct.update({ where: { id: l.productId }, data: { reserved: { increment: l.quantity } } });
        }
    }, { timeout: 30_000, maxWait: 10_000 });
}

/** Release any held stock for an order (cancel / return). */
export async function releaseOrder(ref: OrderRef): Promise<void> {
    await prisma.$transaction(async (tx) => {
        const held = await tx.stockReservation.findMany({
            where: { orderSource: ref.source, orderId: ref.id, status: "HELD" },
            select: { id: true, productId: true, quantity: true },
        });
        for (const r of held) {
            await tx.invProduct.update({ where: { id: r.productId }, data: { reserved: { decrement: r.quantity } } });
        }
        if (held.length > 0) {
            await tx.stockReservation.updateMany({
                where: { orderSource: ref.source, orderId: ref.id, status: "HELD" },
                data: { status: "RELEASED" },
            });
        }
    }, { timeout: 30_000, maxWait: 10_000 });
}
