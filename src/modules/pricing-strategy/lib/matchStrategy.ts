// Sale-age helper (last formerly part of the PricingStrategy matcher, which was
// dropped in favour of the additive-margin engine). Kept here because the items
// API still surfaces "days since last sale" for the labels page filters.

import { prisma } from "@/shared/lib/prisma/prismaClient";

/**
 * productId → days since last SALE/POS voucher line (null = never sold).
 * Uses InvStockLedger.outQty > 0 + posted SALE/POS voucher.
 */
export async function loadLastSaleAgeDays(
    productIds: number[],
    now:        Date = new Date(),
): Promise<Map<number, number | null>> {
    const out = new Map<number, number | null>();
    for (const id of productIds) out.set(id, null);
    if (productIds.length === 0) return out;

    const rows = await prisma.invStockLedger.groupBy({
        by:    ["productId"],
        where: {
            productId: { in: productIds },
            outQty:    { gt: 0 },
            voucher:   {
                status: "POSTED",
                type:   { in: ["SALE", "POS"] },
            },
        },
        _max: { date: true },
    });

    const today = startOfDay(now).getTime();
    for (const r of rows) {
        if (r._max.date == null) continue;
        const ms   = today - startOfDay(r._max.date).getTime();
        const days = Math.max(0, Math.floor(ms / 86_400_000));
        out.set(r.productId, days);
    }
    return out;
}

function startOfDay(d: Date): Date {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
