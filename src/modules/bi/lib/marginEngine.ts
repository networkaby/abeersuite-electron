// BI margin engine — pairs sold quantities with a derived cost basis.
//
// The cost basis itself lives in modules/inventory/lib/costBasis.ts (shared
// with the accountancy trading account, so P&L gross profit and Bill-wise
// Profit can't drift apart). This file only does the sale-line side: which
// lines count as revenue, and how qty/revenue/COGS/profit are shaped per line.

import { CUSTOMER_SALE_VOUCHER_TYPES } from "@/shared/lib/constants/accounting";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { toNumber } from "@/modules/accountancy/lib/balance";
import { round2 as r2 } from "@/shared/lib/format/moneyInr";
import {
    loadUnitCostMap,
    resolveCostMethod,
    type CostFallback,
    type CostMethod,
} from "@/modules/inventory/lib/costBasis";
import { getCurrentAdditionalCostByProduct } from "@/modules/pricing-strategy/lib/costPool";

export interface BiUnitCost {
    /** Purchase rate + extra cost — what every BI report costs a unit at. */
    unitCost: number;
    /** Purchase-rate part (derived cost basis). */
    baseCost: number;
    /** Allocated additional cost per unit (courier / shipping, GST-exclusive ₹). */
    extraCost: number;
    fallback?: CostFallback;
}

/**
 * BI cost per unit = derived purchase cost + the Pricing Strategy additional
 * cost allocated to the product (same derive rule as pricing: all legs of the
 * latest inward ≤ asOf). Owner 2026-11-14: every BI report includes it.
 */
export async function loadBiUnitCostMap(
    productIds: number[],
    asOf: Date,
    method: CostMethod,
): Promise<Map<number, BiUnitCost>> {
    const [base, extra] = await Promise.all([
        loadUnitCostMap(productIds, asOf, method),
        getCurrentAdditionalCostByProduct(productIds, asOf),
    ]);
    const out = new Map<number, BiUnitCost>();
    for (const id of productIds) {
        const b = base.get(id) ?? { unitCost: 0, fallback: "no-cost-basis" as const };
        const extraCost = (extra.get(id) ?? 0) / 100;
        out.set(id, { unitCost: b.unitCost + extraCost, baseCost: b.unitCost, extraCost, fallback: b.fallback });
    }
    return out;
}

export const SALE_TYPES = CUSTOMER_SALE_VOUCHER_TYPES;
export const SALE_RETURN_TYPE = "SALE_RETURN";

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
    /** Spine (UniversalVoucher) id — what adjustments and the drill-down key on. */
    voucherId: number;
    /** VoucherDetail id — what the edit form opens by. Null only for a spine with no detail row. */
    detailId: number | null;
    voucherType: string;
    /** Voucher's branch — null on branch-less (org-level) vouchers. */
    branchId: string | null;
    date: Date;
    /** Units that left stock (billed + free). Negative on sale returns. */
    qtyOut: number;
    /** Pre-tax, after line discount. Negative on sale returns. */
    revenue: number;
    /** GST on this line. Negative on sale returns. revenue + taxAmount = what the bill actually charged (tax-inclusive). */
    taxAmount: number;
    /** Line discount ₹ (pre-tax). Negative on sale returns. */
    discountAmt: number;
    /** Pre-tax, BEFORE line discount: revenue + discountAmt. */
    grossValue: number;
    /** ₹ per unit = derived purchase cost + allocated additional cost. */
    unitCost: number;
    /** The additional-cost part of `cogs` (₹, qtyOut × per-unit extra). */
    extraCost: number;
    cogs: number;
    profit: number;
    costFallback?: CostFallback;
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
                select: { id: true, type: true, date: true, partyAccountId: true, branchId: true, voucherDetail: { select: { id: true } } },
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
    const costMap = await loadBiUnitCostMap(productIds, q.to, costMethod);

    const lines: MarginLine[] = rawLines.map((l) => {
        const sign = l.universalVoucher.type === SALE_RETURN_TYPE ? -1 : 1;
        const qtyOut = (toNumber(l.quantity) + toNumber(l.freeQty ?? 0)) * sign;
        const taxAmount = toNumber(l.taxAmount) * sign;
        const revenue = (toNumber(l.amount) - toNumber(l.taxAmount)) * sign;
        const discountAmt = toNumber(l.discountAmt) * sign;
        const cost = costMap.get(l.productId)!; // every productId is in the map
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
            detailId: l.universalVoucher.voucherDetail?.id ?? null,
            voucherType: l.universalVoucher.type,
            branchId: l.universalVoucher.branchId,
            date: l.universalVoucher.date,
            qtyOut,
            revenue,
            taxAmount,
            discountAmt,
            grossValue: revenue + discountAmt,
            unitCost: cost.unitCost,
            extraCost: qtyOut * cost.extraCost,
            cogs,
            profit: revenue - cogs,
            costFallback: cost.fallback,
        };
    });

    return { lines, costMethod };
}

/** Round to 2dp for JSON payloads (floats stay unrounded through the math) — the
 *  shared money rounding, re-exported under the name every BI route imports. */
export { r2 };

export const marginPct = (revenue: number, profit: number) =>
    revenue !== 0 ? r2((profit / revenue) * 100) : 0;

/**
 * Bill-level adjustments that sit BELOW the item lines and so never reach
 * `loadMarginLines` — overall discount, POS coupon/loyalty/service charges,
 * round-off. Pulled from the posted GL legs (`VoucherGlLine.role`), which are
 * the single source `buildInvVoucherGlLines` already stamps for every trading
 * voucher — so this can't drift from what actually posted.
 *
 * Sign convention: a CREDIT leg behaves like income (helps profit), a DEBIT
 * leg like an expense (hurts profit) — true for both SALE-shape and
 * SALE_RETURN-shape vouchers alike, so no separate return-sign handling is
 * needed here (unlike qtyOut/revenue in loadMarginLines).
 *
 * SHIPPING is reported separately and deliberately excluded from `net` — we
 * collect shipping income here but the courier's cost is a separate expense
 * voucher, so folding it in would flatter this bill's margin.
 */
export interface BillAdjustment {
    /** Overall bill discount (Discount Allowed leg). */
    discount: number;
    /** Coupon / loyalty redemption / POS service charges (net, pre-tax). */
    charge: number;
    roundOff: number;
    /** Shipping income, net of tax — display-only, not folded into `net`. */
    shippingNet: number;
    /** discount + charge + roundOff. Add to gross profit for net profit. */
    net: number;
}

const ADJ_ROLES = ["DISCOUNT", "CHARGE", "ROUNDOFF", "SHIPPING"] as const;

/**
 * Loads bill-level adjustments for exactly the vouchers passed in (the same
 * set `loadMarginLines` already resolved for the period/branch — no need to
 * re-filter by date here).
 *
 * Legacy fallback: some old postings predate GL role-tagging (`role` is
 * nullable) and would silently read as "no adjustment". When a voucher's
 * GL-derived discount comes out to exactly 0 but its VoucherDetail carries a
 * voucher-level `discountAmt`, that value is used instead — the one bit of
 * pre-role-tagging data that's reliably reconstructable from elsewhere.
 * Coupon/loyalty/charge adjustments have no such fallback (they only ever
 * existed as role-tagged GL legs), so an untagged bill with those simply
 * shows no adjustment for them.
 */
export async function loadBillAdjustments(
    vouchers: { voucherId: number; voucherType: string }[],
): Promise<Map<number, BillAdjustment>> {
    const byId = new Map<number, string>();
    for (const v of vouchers) byId.set(v.voucherId, v.voucherType);
    const ids = [...byId.keys()];
    if (ids.length === 0) return new Map();

    const [legs, details] = await Promise.all([
        prisma.voucherGlLine.findMany({
            where: { universalVoucherId: { in: ids }, role: { in: [...ADJ_ROLES] } },
            select: { universalVoucherId: true, role: true, type: true, amount: true },
        }),
        prisma.voucherDetail.findMany({
            where: { universalVoucherId: { in: ids }, discountAmt: { gt: 0 } },
            select: { universalVoucherId: true, discountAmt: true },
        }),
    ]);

    const result = new Map<number, BillAdjustment>();
    const get = (id: number) =>
        result.get(id) ?? { discount: 0, charge: 0, roundOff: 0, shippingNet: 0, net: 0 };

    for (const leg of legs) {
        const row = get(leg.universalVoucherId);
        const signed = (leg.type === "CREDIT" ? 1 : -1) * toNumber(leg.amount);
        if (leg.role === "DISCOUNT") row.discount += signed;
        else if (leg.role === "CHARGE") row.charge += signed;
        else if (leg.role === "ROUNDOFF") row.roundOff += signed;
        else if (leg.role === "SHIPPING") row.shippingNet += signed;
        result.set(leg.universalVoucherId, row);
    }

    // Legacy fallback — only fills in `discount` when GL roles left it at 0.
    for (const d of details) {
        if (d.universalVoucherId == null) continue; // DRAFT/unposted — shouldn't happen for POSTED-filtered ids, but VoucherDetail's FK is nullable
        const row = get(d.universalVoucherId);
        if (row.discount !== 0) continue;
        const voucherType = byId.get(d.universalVoucherId);
        const amt = toNumber(d.discountAmt ?? 0); // filtered to gt:0 above; Prisma type is still nullable
        row.discount = voucherType === SALE_RETURN_TYPE ? amt : -amt;
        result.set(d.universalVoucherId, row);
    }

    for (const [id, row] of result) {
        row.discount = r2(row.discount);
        row.charge = r2(row.charge);
        row.roundOff = r2(row.roundOff);
        row.shippingNet = r2(row.shippingNet);
        row.net = r2(row.discount + row.charge + row.roundOff);
        result.set(id, row);
    }
    return result;
}
