// Pure quantity maths for sale returns (saleReturnGuard.ts).

export type QtyLine = { productId: number; quantity: unknown };

export function sumByProduct(lines: QtyLine[]): Map<number, number> {
    const out = new Map<number, number>();
    for (const l of lines) out.set(l.productId, (out.get(l.productId) ?? 0) + Number(l.quantity));
    return out;
}

/** The first product whose return would pass what was sold, or null when all fit. */
export function overReturnedProduct(sold: QtyLine[], returned: Map<number, number>, adding: QtyLine[]): number | null {
    const soldBy = sumByProduct(sold);
    for (const [productId, qty] of sumByProduct(adding)) {
        if (qty + (returned.get(productId) ?? 0) > (soldBy.get(productId) ?? 0) + 0.0005) return productId;
    }
    return null;
}
