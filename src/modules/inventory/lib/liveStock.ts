// Live on-hand quantity — the READ side of the stock formula.
//
// ONE rule, and it is the same rule `recomputeProductStock` writes with
// (stockMovement.ts):
//
//     stock = openingStock + Σ(inQty − outQty)
//             └ master column, NOT a ledger row
//
// `branchId` narrows BOTH halves, but by different means. The ledger half is a
// `where` on the query. The opening half is decided by `openingBranchId` on the
// product master — the stock LOCATION of the opening quantity:
//
//     openingBranchId = null           → folds into every branch (see below)
//     openingBranchId = the asked one  → folds in
//     openingBranchId = another branch → left out
//     no branch asked (org-wide)       → always folds in, exactly once
//
// ── Why null folds into every branch ────────────────────────────────────────
// Before 2026-09-17 the opening carried no branch at all and folded into every
// scope unconditionally. Migration 20260917090000_product_opening_branch stamps
// BR-HQ on every opening that existed then, so on live "null" now means an
// opening created since, by an operator who did not pick a location. Folding it
// everywhere keeps that row reading as it always did rather than quietly
// dropping to zero on every branch screen — the failure this whole file exists
// to prevent. It is the lenient half of the rule, and deliberately so.
//
// The money side is NOT branch-aware and must not become so here: `openingValue`,
// computeTradingStockAdjustment and valuation.ts are all org-level. This column
// scopes a QUANTITY only.
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

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { isCombined } from "@/shared/lib/auth/activeBranch";
import { toNumber } from "@/modules/accountancy/lib/balance";

/**
 * The combined sentinel ("__combined__") is a scope, not a branch id, and
 * `resolveActiveBranchId` passes it straight through to readers — so it does
 * arrive here (products/route.ts:77). Treat it as org-wide.
 *
 * This is load-bearing, not defensive. Left alone it would go into the ledger
 * `where` as a literal branch id, match no rows, AND exclude every opening that
 * has a real branch on it — turning the whole catalogue to zero on a screen that
 * is asking to see everything.
 */
function scopeBranch(branchId?: string | null): string | null {
    return !branchId || isCombined(branchId) ? null : branchId;
}

/**
 * A product row as this helper needs it.
 *
 * Both opening fields are REQUIRED, not optional, and deliberately so: a caller
 * that forgets to select one now fails to compile instead of silently dropping
 * the opening quantity — which is the exact bug this helper replaces. Adding
 * `openingBranchId` to this type is what forced every one of the seven call
 * sites to be revisited rather than quietly keeping the old answer.
 */
export type ProductStockRow = {
    id: number;
    openingStock: { toString(): string } | number | string | null;
    openingBranchId: string | null;
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

    const scope = scopeBranch(branchId);

    const sums = await prisma.invStockLedger.groupBy({
        by: ["productId"],
        where: {
            productId: { in: products.map((p) => p.id) },
            ...(scope ? { branchId: scope } : {}),
        },
        _sum: { inQty: true, outQty: true },
    });

    const moved = new Map<number, number>();
    for (const s of sums) {
        moved.set(s.productId, toNumber(s._sum.inQty ?? 0) - toNumber(s._sum.outQty ?? 0));
    }

    for (const p of products) {
        out.set(p.id, foldOpening(
            p.openingStock,
            moved.has(p.id) ? moved.get(p.id)! : null,
            openingAppliesTo(p, scope),
        ));
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
        byBranch.set(s.branchId, foldOpening(
            product.openingStock, delta, openingAppliesTo(product, s.branchId),
        ) ?? 0);
    }

    // The opening's own branch may have no ledger row at all — a product that
    // opened with stock and has not moved since. It still belongs in the picker,
    // and it is the one branch showing the quantity.
    const extras = product.openingBranchId
        ? [...extraBranchIds, product.openingBranchId]
        : extraBranchIds;
    for (const id of extras) {
        if (!byBranch.has(id)) byBranch.set(id, foldOpening(
            product.openingStock, 0, openingAppliesTo(product, id),
        ) ?? 0);
    }

    // The total is the org-wide scope, so the opening counts once regardless of
    // where it sits — this is NOT the sum of the branch figures above, and with
    // an unassigned opening it deliberately is not.
    return { total: foldOpening(product.openingStock, movedTotal, true) ?? 0, byBranch };
}

/**
 * On-hand quantity in ONE branch at the START of `date` — what a stock count
 * (Physical Stock) dated that day replaces. Same rule as the rest of this file;
 * only the ledger half is capped at the date.
 *
 * Two readers, and they must agree or the count screen shows one figure while the
 * server posts against another: `postVoucherInTx` (the PHYSICAL_STOCK delta) and
 * the count screen's "In system" column (`/api/inventory/products/stock-before`).
 * Before this existed the post path summed the branch's ledger alone and left the
 * opening out, so counting an untouched opening of 10 as 10 posted +10 → 20.
 *
 * Unlike the live map, the ledger half IS filtered on POSTED: a cancel's
 * counter-row is dated the day of the cancel, so a dated window can hold the
 * original and not its reversal. Filtering on the voucher status drops both.
 *
 * `db` is the caller's transaction when there is one — the post path reads inside
 * its own `tx`. A product never tracked anywhere still answers 0: a count needs a
 * number to subtract from.
 */
export async function loadStockBeforeDate(
    db: Pick<Prisma.TransactionClient, "invStockLedger" | "invProduct">,
    productIds: number[],
    branchId: string,
    date: Date,
): Promise<Map<number, number>> {
    const out = new Map<number, number>();
    const ids = [...new Set(productIds)];
    if (ids.length === 0) return out;

    // One after another: inside a transaction (one connection) pg refuses parallel queries.
    const products = await db.invProduct.findMany({
        where:  { id: { in: ids } },
        select: { id: true, openingStock: true, openingBranchId: true },
    });
    const sums = await db.invStockLedger.groupBy({
        by:    ["productId"],
        where: { productId: { in: ids }, branchId, date: { lt: date }, universalVoucher: { status: "POSTED" } },
        _sum:  { inQty: true, outQty: true },
    });
    const moved = new Map(sums.map((s) => [s.productId, toNumber(s._sum.inQty ?? 0) - toNumber(s._sum.outQty ?? 0)]));

    for (const p of products) {
        out.set(p.id, foldOpening(p.openingStock, moved.get(p.id) ?? null, openingAppliesTo(p, branchId)) ?? 0);
    }
    return out;
}

/**
 * Does this product's opening quantity belong to the scope being asked about?
 *
 * See the rule table in the file header. `null` branchId is the org-wide scope,
 * where every opening counts exactly once; `null` openingBranchId is an
 * unassigned opening, which counts everywhere.
 *
 * Exported because the BI movement register cannot use `loadLiveStockMap` — its
 * opening is date-aware (`openingStockDate < from`) and it also needs the prior
 * ledger period, so it folds the opening itself. It must still answer the BRANCH
 * question the same way, or the same product reads two different opening figures
 * on two reports. Takes the sentinel-normalising path via `scopeBranch`, so
 * callers may hand it whatever they resolved.
 */
export function openingAppliesTo(
    product: Pick<ProductStockRow, "openingBranchId">,
    branchId?: string | null,
): boolean {
    const scope = scopeBranch(branchId);
    if (!scope) return true;
    if (product.openingBranchId == null) return true;
    return product.openingBranchId === scope;
}

/**
 * The WRITE side of the same column: what `openingBranchId` becomes when a writer
 * saves an opening quantity. Every opening sits at a branch — it is counted at a
 * counter, and a counter belongs to a branch — so a quantity is never saved
 * without one.
 *
 *   quantity cleared               → null (a location for no stock is no location)
 *   quantity, branch already set   → kept (an edit, even from another branch,
 *                                    does not move stock that is lying elsewhere)
 *   quantity, no branch yet        → the writer's working branch
 *
 * `workingBranch` is called only in the last case, so a caller can pass
 * `() => requireWritableBranchId(req, session)` and an edit in "My branches"
 * mode is refused only when it really has to pick a branch.
 */
export function openingBranchOnSave(
    openingStock: unknown,
    currentBranchId: string | null,
    workingBranch: () => string,
): string | null {
    if (openingStock == null) return null;
    return currentBranchId ?? workingBranch();
}

/**
 * The rule itself, in one place.
 *
 * `null` movement means the ledger has never mentioned this product in this
 * scope. Paired with no opening balance ANYWHERE, that is "not tracked" rather
 * than zero — and the distinction is why `openingStock` is passed in whole
 * rather than pre-zeroed. A product whose opening sits at another branch is
 * still a tracked product: asked about this branch it answers 0, not "—".
 */
function foldOpening(
    openingStock: ProductStockRow["openingStock"],
    movement: number | null,
    openingApplies: boolean,
): number | null {
    const opening = openingStock == null ? null : toNumber(openingStock);
    if (opening == null && movement == null) return null;
    return (openingApplies ? (opening ?? 0) : 0) + (movement ?? 0);
}
