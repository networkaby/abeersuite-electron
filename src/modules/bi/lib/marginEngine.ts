// BI margin engine — pairs sold quantities with a derived cost basis.
//
// COGS is NOT stored at sale time (VoucherInventoryLine has no costAtSale
// column; outward InvStockLedger rows carry the SELLING rate). Unit cost is
// therefore reconstructed at report time from inward InvStockLedger lots
// capped at the period end — same lot semantics as
// modules/inventory/lib/valuation.ts, but date-capped so old-period reports
// use only the purchase history that existed up to that period.
//
// FIFO / MONTHLY_AVG org defaults fall back to WEIGHTED_AVG here: a true
// per-sold-unit FIFO needs a full in/out replay that isn't worth it for
// decision reports. The cost method actually used is echoed to the UI.

import { prisma } from "@/shared/lib/prisma/prismaClient";
import { toNumber } from "@/modules/accountancy/lib/balance";

export const SALE_TYPES = ["SALE", "POS", "ONLINE_INVOICE"] as const;
export const SALE_RETURN_TYPE = "SALE_RETURN";

export type CostMethod = "LAST_INWARD" | "WEIGHTED_AVG" | "SIMPLE_AVG";

/** Org valuation method → the COGS method the margin engine supports. */
export function resolveCostMethod(method: string | null | undefined): CostMethod {
    return method === "LAST_INWARD" || method === "SIMPLE_AVG" ? method : "WEIGHTED_AVG";
}

export interface MarginLine {
    productId: number;
    sku: string;
    productName: string;
    categoryId: number | null;
    categoryName: string | null;
    brandId: number | null;
    brandName: string | null;
    /** Party ledger (Account) id — null = walk-in / cash sale. */
    accountId: number | null;
    voucherId: number;
    voucherType: string;
    /** Voucher's branch — null on branch-less (org-level) vouchers. */
    branchId: string | null;
    date: Date;
    /** Units that left stock (billed + free). Negative on sale returns. */
    qtyOut: number;
    /** Pre-tax, after line discount. Negative on sale returns. */
    revenue: number;
    /** Line discount ₹ (pre-tax). Negative on sale returns. */
    discountAmt: number;
    /** Pre-tax, BEFORE line discount: revenue + discountAmt. */
    grossValue: number;
    /** ₹ per unit from the derived cost basis (0 when no basis exists). */
    unitCost: number;
    cogs: number;
    profit: number;
    costFallback?: "opening-rate" | "no-cost-basis";
}

export interface MarginQuery {
    from: Date;
    to: Date;
    branchId?: string | null;
}

export interface MarginResult {
    lines: MarginLine[];
    costMethod: CostMethod;
}

/**
 * Per-product unit cost from inward lots dated ≤ `asOf` (POSTED, non-deleted
 * vouchers) + the product's opening lot. Cost basis is org-wide on purpose —
 * purchases may land at any branch, but the goods sold are the same goods.
 * Fallback: no lots → openingRate → 0 (flagged no-cost-basis).
 */
export async function loadUnitCostMap(
    productIds: number[],
    asOf: Date,
    method: CostMethod,
): Promise<Map<number, { unitCost: number; fallback?: MarginLine["costFallback"] }>> {
    const out = new Map<number, { unitCost: number; fallback?: MarginLine["costFallback"] }>();
    if (productIds.length === 0) return out;

    const [rows, masters] = await Promise.all([
        prisma.invStockLedger.findMany({
            where: {
                productId: { in: productIds },
                inQty: { gt: 0 },
                date: { lte: asOf },
                universalVoucher: { status: "POSTED", deletedAt: null },
            },
            select: { productId: true, date: true, inQty: true, rate: true },
            orderBy: [{ date: "asc" }, { id: "asc" }],
        }),
        prisma.invProduct.findMany({
            where: { id: { in: productIds } },
            select: { id: true, openingStock: true, openingRate: true, openingStockDate: true },
        }),
    ]);

    type Lot = { qty: number; rate: number };
    const lotsByProduct = new Map<number, Lot[]>();
    const pushLot = (productId: number, lot: Lot) => {
        const arr = lotsByProduct.get(productId);
        if (arr) arr.push(lot); else lotsByProduct.set(productId, [lot]);
    };

    // Opening lot first (it predates every ledger row), then ledger lots in date order.
    const openingRateById = new Map<number, number>();
    for (const m of masters) {
        const openQty = m.openingStock != null ? toNumber(m.openingStock) : 0;
        const openRate = m.openingRate != null ? toNumber(m.openingRate) : 0;
        if (openRate > 0) openingRateById.set(m.id, openRate);
        const inRange = !m.openingStockDate || m.openingStockDate <= asOf;
        if (openQty > 0 && openRate > 0 && inRange) pushLot(m.id, { qty: openQty, rate: openRate });
    }
    for (const r of rows) pushLot(r.productId, { qty: toNumber(r.inQty), rate: toNumber(r.rate) });

    for (const id of productIds) {
        const lots = lotsByProduct.get(id);
        if (!lots || lots.length === 0) {
            const openRate = openingRateById.get(id);
            out.set(id, openRate
                ? { unitCost: openRate, fallback: "opening-rate" }
                : { unitCost: 0, fallback: "no-cost-basis" });
            continue;
        }
        let unitCost = 0;
        switch (method) {
            case "LAST_INWARD":
                unitCost = lots[lots.length - 1].rate;
                break;
            case "SIMPLE_AVG":
                unitCost = lots.reduce((s, l) => s + l.rate, 0) / lots.length;
                break;
            case "WEIGHTED_AVG": {
                let q = 0, v = 0;
                for (const l of lots) { q += l.qty; v += l.qty * l.rate; }
                unitCost = q > 0 ? v / q : 0;
                break;
            }
        }
        out.set(id, { unitCost });
    }
    return out;
}

/**
 * Every sale-family inventory line in the period (SALE + POS + ONLINE_INVOICE,
 * SALE_RETURN negated), enriched with revenue / derived COGS / profit.
 * Revenue is pre-tax after discount: line.amount − line.taxAmount.
 * Free qty flows into qtyOut and COGS (real cost given away) but adds ₹0 revenue.
 */
export async function loadMarginLines(q: MarginQuery): Promise<MarginResult> {
    const orgDefaults = await prisma.orgDefaults.findUnique({
        where: { id: 1 },
        select: { valuationMethod: true },
    });
    const costMethod = resolveCostMethod(orgDefaults?.valuationMethod);

    const rawLines = await prisma.voucherInventoryLine.findMany({
        where: {
            universalVoucher: {
                type: { in: [...SALE_TYPES, SALE_RETURN_TYPE] },
                status: "POSTED",
                deletedAt: null,
                date: { gte: q.from, lte: q.to },
                ...(q.branchId ? { branchId: q.branchId } : {}),
            },
        },
        select: {
            productId: true,
            quantity: true,
            freeQty: true,
            discountAmt: true,
            taxAmount: true,
            amount: true,
            universalVoucher: {
                select: { id: true, type: true, date: true, partyAccountId: true, branchId: true },
            },
            product: {
                select: {
                    sku: true,
                    name: true,
                    category: { select: { id: true, name: true } },
                    brand: { select: { id: true, name: true } },
                },
            },
        },
    });

    const productIds = [...new Set(rawLines.map((l) => l.productId))];
    const costMap = await loadUnitCostMap(productIds, q.to, costMethod);

    const lines: MarginLine[] = rawLines.map((l) => {
        const sign = l.universalVoucher.type === SALE_RETURN_TYPE ? -1 : 1;
        const qtyOut = (toNumber(l.quantity) + toNumber(l.freeQty ?? 0)) * sign;
        const revenue = (toNumber(l.amount) - toNumber(l.taxAmount)) * sign;
        const discountAmt = toNumber(l.discountAmt) * sign;
        const cost = costMap.get(l.productId) ?? { unitCost: 0, fallback: "no-cost-basis" as const };
        const cogs = qtyOut * cost.unitCost;
        return {
            productId: l.productId,
            sku: l.product.sku,
            productName: l.product.name,
            categoryId: l.product.category?.id ?? null,
            categoryName: l.product.category?.name ?? null,
            brandId: l.product.brand?.id ?? null,
            brandName: l.product.brand?.name ?? null,
            accountId: l.universalVoucher.partyAccountId,
            voucherId: l.universalVoucher.id,
            voucherType: l.universalVoucher.type,
            branchId: l.universalVoucher.branchId,
            date: l.universalVoucher.date,
            qtyOut,
            revenue,
            discountAmt,
            grossValue: revenue + discountAmt,
            unitCost: cost.unitCost,
            cogs,
            profit: revenue - cogs,
            costFallback: cost.fallback,
        };
    });

    return { lines, costMethod };
}

/** Round to 2dp for JSON payloads (floats stay unrounded through the math). */
export const r2 = (n: number) => Math.round(n * 100) / 100;

export const marginPct = (revenue: number, profit: number) =>
    revenue !== 0 ? r2((profit / revenue) * 100) : 0;
