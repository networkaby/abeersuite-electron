// Live on-hand quantity — the READ side of the stock formula.
//
// ONE rule, and it is the same rule `recomputeProductStock` writes with
// (stockMovement.ts):
//
//     stock = openingStock + Σ(inQty − outQty)
//             └ master column, org-level, NOT a ledger row
//
// `branchId` narrows the SECOND half only. Opening stock is typed on the product
// master and carries no branch — it is the quantity the books began with — so it
// folds into every scope, exactly as `Account.openingBalance` folds into
// `aggregateClosingAsOf` on the GL side.
//
// ── Why this file exists ────────────────────────────────────────────────────
// The per-branch cache (`InvProductBranch.stock`, table inv_product_branches) is
// built from voucher movements alone, so it NEVER holds the opening quantity.
// Six read sites each reached for that cache directly, and every one of them
// showed a product whose stock came from an opening balance as zero. On live
// that was 644 of 1467 products and 12,865 units — and some branch rows had gone
// negative, because the opening was never put in but the sale was still taken
// out. The Vyapar opening loader (scripts/vyapar/opening-load.ts) writes
// openingStock/openingRate/openingValue and nothing else, which is correct: the
// branch row is a record of movement, not an answer to "how many are there".
//
// So: never read InvProduct.stock or InvProductBranch.stock to answer that
// question. Come through here.

import { prisma } from "@/shared/lib/prisma/prismaClient";
import { toNumber } from "@/modules/accountancy/lib/balance";

/**
 * A product row as this helper needs it.
 *
 * `openingStock` is REQUIRED, not optional, and deliberately so: a caller that
 * forgets to select it now fails to compile instead of silently dropping the
 * opening quantity — which is the exact bug this helper replaces.
 */
export type ProductStockRow = {
    id: number;
    openingStock: { toString(): string } | number | string | null;
};

/**
 * On-hand quantity per product for the requested scope.
 *
 * `null` in the returned map means "stock not tracked" — no opening balance AND
 * no ledger row has ever mentioned this product. Callers that want a number read
 * it as `map.get(id) ?? 0`; the products list shows it as "—".
 *
 * The ledger half is deliberately NOT filtered on voucher status: cancelling a
 * voucher appends counter-rows rather than removing the originals, so the rows
 * net themselves out and the unfiltered sum IS the truth. This matches
 * `recomputeProductStock`, and it was checked against live — the org-wide cache
 * equals `openingStock + unfiltered ledger` for all 1467 products, no drift.
 */
export async function loadLiveStockMap(
    products: ProductStockRow[],
    branchId?: string | null,
): Promise<Map<number, number | null>> {
    const out = new Map<number, number | null>();
    if (products.length === 0) return out;

    const sums = await prisma.invStockLedger.groupBy({
        by: ["productId"],
        where: {
            productId: { in: products.map((p) => p.id) },
            ...(branchId ? { branchId } : {}),
        },
        _sum: { inQty: true, outQty: true },
    });

    const moved = new Map<number, number>();
    for (const s of sums) {
        moved.set(s.productId, toNumber(s._sum.inQty ?? 0) - toNumber(s._sum.outQty ?? 0));
    }

    for (const p of products) {
        out.set(p.id, foldOpening(p.openingStock, moved.has(p.id) ? moved.get(p.id)! : null));
    }
    return out;
}

/**
 * Same rule for ONE product, split per branch — for the Item Ledger, which shows
 * a branch picker beside the total.
 *
 * `byBranch` carries every branch the product has ever moved in, plus any branch
 * the caller names in `extraBranchIds` (the branches that already have a cache
 * row, so the picker keeps showing what it showed before). Each figure is the
 * full opening plus that branch's own movement.
 */
export async function loadLiveStockByBranch(
    product: ProductStockRow,
    extraBranchIds: string[] = [],
): Promise<{ total: number; byBranch: Map<string, number> }> {
    const sums = await prisma.invStockLedger.groupBy({
        by: ["branchId"],
        where: { productId: product.id },
        _sum: { inQty: true, outQty: true },
    });

    const byBranch = new Map<string, number>();
    let movedTotal = 0;
    for (const s of sums) {
        const delta = toNumber(s._sum.inQty ?? 0) - toNumber(s._sum.outQty ?? 0);
        movedTotal += delta;
        byBranch.set(s.branchId, foldOpening(product.openingStock, delta) ?? 0);
    }
    for (const id of extraBranchIds) {
        if (!byBranch.has(id)) byBranch.set(id, foldOpening(product.openingStock, 0) ?? 0);
    }

    return { total: foldOpening(product.openingStock, movedTotal) ?? 0, byBranch };
}

/**
 * The rule itself, in one place. `null` movement means the ledger has never
 * mentioned this product — paired with no opening balance, that is "not tracked"
 * rather than zero.
 */
function foldOpening(
    openingStock: ProductStockRow["openingStock"],
    movement: number | null,
): number | null {
    const opening = openingStock == null ? null : toNumber(openingStock);
    if (opening == null && movement == null) return null;
    return (opening ?? 0) + (movement ?? 0);
}
