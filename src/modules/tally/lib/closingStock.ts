// Live closing-stock valuation: SUM(InvProduct.stock × InvProduct.costPaise) / 100.
// Tally-style "Closing Stock" line for the Balance Sheet and P&L Trading account.

import { prisma } from "@/lib/prisma";

export type ClosingStockResult = {
    /** Computed valuation in rupees (live). */
    computed: number;
    /** Number of products contributing (helpful for diagnostics). */
    productCount: number;
};

export async function getClosingStockValue(): Promise<ClosingStockResult> {
    const products = await prisma.invProduct.findMany({
        where: { stock: { not: null }, costPaise: { not: null } },
        select: { stock: true, costPaise: true },
    });
    let total = 0;
    let count = 0;
    for (const p of products) {
        if (p.stock === null || p.costPaise === null) continue;
        if (p.stock === 0) continue;
        total += (p.stock * p.costPaise) / 100;
        count += 1;
    }
    return { computed: total, productCount: count };
}
