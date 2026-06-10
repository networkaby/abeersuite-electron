// SERVER-ONLY. Guards the scannable identifier space: a product's SKU and every
// InvProductCode.value must be globally unique *across both namespaces*, so a
// scanned string resolves to exactly one product. Postgres can't express a unique
// constraint spanning two tables, so we enforce it at write time on the product
// create / update paths. Do NOT import from client components (pulls in Prisma).

import { prisma } from "@/shared/lib/prisma/prismaClient";

export type SkuCodeCollision = { value: string; conflict: "sku" | "code" };

/**
 * Returns the first collision between the candidate SKU / code values and the
 * existing scannable space, or null when clear.
 *   - a candidate `sku` that equals an existing InvProductCode.value → conflict "code"
 *   - a candidate code value that equals an existing InvProduct.sku  → conflict "sku"
 *   - a candidate code value that equals the candidate `sku` itself  → conflict "sku"
 * `excludeProductId` skips the product being edited so it doesn't clash with itself.
 */
export async function findSkuCodeCollision(opts: {
    sku?: string | null;
    codeValues?: string[];
    excludeProductId?: number;
}): Promise<SkuCodeCollision | null> {
    const sku = opts.sku?.trim() || null;
    const codeValues = (opts.codeValues ?? []).map((v) => v.trim()).filter(Boolean);
    const { excludeProductId } = opts;

    // A new code can't duplicate this same product's own SKU (redundant + confusing).
    if (sku && codeValues.includes(sku)) return { value: sku, conflict: "sku" };

    if (sku) {
        const hit = await prisma.invProductCode.findFirst({
            where: {
                value: sku,
                ...(excludeProductId != null ? { productId: { not: excludeProductId } } : {}),
            },
            select: { value: true },
        });
        if (hit) return { value: sku, conflict: "code" };
    }

    if (codeValues.length > 0) {
        const hit = await prisma.invProduct.findFirst({
            where: {
                sku: { in: codeValues },
                ...(excludeProductId != null ? { id: { not: excludeProductId } } : {}),
            },
            select: { sku: true },
        });
        if (hit) return { value: hit.sku, conflict: "sku" };
    }

    return null;
}

/** Human-facing 409 message for a collision. */
export function skuCodeCollisionMessage(c: SkuCodeCollision): string {
    return c.conflict === "sku"
        ? `"${c.value}" is already a product SKU — a scannable code can't reuse it.`
        : `"${c.value}" is already used as a product code — the SKU can't reuse it.`;
}
