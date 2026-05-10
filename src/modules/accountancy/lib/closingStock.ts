// Live closing-stock valuation: SUM of every product's `productClosingValue`.
// Tally-style "Closing Stock" line for the Balance Sheet and P&L Trading
// account. Per-product math lives in `src/modules/inventory/lib/stockValue.ts`.

import { prisma } from "@/shared/lib/prisma/prismaClient";
import { productClosingValue } from "@/modules/inventory/lib/stockValue";

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
        const v = productClosingValue(p);
        if (v === 0) continue;
        total += v;
        count += 1;
    }
    return { computed: total, productCount: count };
}
