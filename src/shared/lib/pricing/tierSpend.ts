import { CUSTOMER_SALE_VOUCHER_TYPES } from "@/shared/lib/constants/accounting";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { resolveTierTitles, type TierPeriodInput, type TierResult } from "./resolveTierTitles";

// Server-side spend-tier resolution for ONE account — the queries half of the
// tier engine (the pure math half is resolveTierTitles). Extracted from
// /api/pos/account-snapshot so every channel resolves tiers identically:
//   • POS account snapshot — history view + raw periods for the live cart
//   • Shop checkout (/api/shop/orders) — server-authoritative discount the
//     storefront customer actually gets (their browser is never trusted)
//   • Cart preview (/api/shop/tier-preview) — the same number, shown early

/** Voucher types whose POSTED totals count as customer spend for tier brackets.
 *  One customer, every channel: counter (POS), office SALE, and the online
 *  shop (ONLINE_INVOICE) all feed the same brackets — buying online raises
 *  the same level as buying at the counter. */
export const TIER_SPEND_VOUCHER_TYPES = CUSTOMER_SALE_VOUCHER_TYPES;

export type TierSpendContext = {
    /** Periods with bracket spend attached — the resolver's raw material
     *  (also returned to the POS so it can re-resolve against the live cart). */
    tierPeriodInputs: TierPeriodInput[];
    /** Cap on the tier % — the lower of the tier's own cap and the combined
     *  guard (CouponConfig.maxTierDiscountPct / maxTotalDiscountPct); null = uncapped. */
    tierCapPct: number | null;
    /** Combined guard alone (coupon + tier + loyalty), for the coupon clamp. */
    totalCapPct: number | null;
    /** Coupon's own cap (CouponConfig.maxCouponDiscountPct); null = none. */
    couponCapPct: number | null;
    /** Posted sale-type voucher count (ledger truth only). */
    invoiceCount: number;
    /** The "new customer" verdict the resolution used — posted vouchers AND any
     *  caller-supplied prior-sale signals (e.g. paid-but-uninvoiced shop
     *  orders). Callers should read THIS, not re-derive from invoiceCount. */
    isNewCustomer: boolean;
    /** Resolved titles + discount % for the given currentSaleValue. */
    tier: TierResult;
};

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Resolve the account's tier standing against an optional live bill.
 *
 * `currentSaleValue` is the bill BEFORE any discount (see resolveTierTitles) —
 * pass 0 for the at-rest history view. Spend per period is counted inside its
 * bracket only (fromDay inclusive, toDay exclusive), exactly as the POS
 * account-snapshot always did.
 */
export async function resolveTierForAccount(
    db: Db,
    accountId: number,
    currentSaleValue = 0,
    opts: {
        /** Extra evidence the customer is NOT new, beyond posted vouchers —
         *  e.g. the count of their prior non-cancelled shop orders (placed /
         *  paid but not yet invoiced). Keeps a NEW-scoped welcome period from
         *  re-firing on every order while staff hasn't invoiced the last one. */
        extraPriorSales?: number;
    } = {},
): Promise<TierSpendContext> {
    const tierPeriods = await db.customerTierPeriod.findMany({
        where: { enabled: true },
        orderBy: [{ sortOrder: "asc" }, { fromDay: "asc" }],
        include: { levels: { where: { enabled: true }, orderBy: { minSpend: "desc" } } },
    });

    // One after another: `db` may be a transaction (one connection), where pg 9
    // refuses parallel queries.
    // Spend inside each period's bracket — `fromDay <= age < toDay`, older
    // edge exclusive / newer edge inclusive so tiled brackets (0-30, 30-90)
    // hand a sale to exactly one period. fromDay 0 has no upper bound.
    const periodAggs: { _sum: { totalAmount: unknown } }[] = [];
    for (const p of tierPeriods) {
        const notBefore = new Date();
        notBefore.setDate(notBefore.getDate() - p.toDay);
        const notAfter = new Date();
        notAfter.setDate(notAfter.getDate() - p.fromDay);
        periodAggs.push(await db.voucherDetail.aggregate({
            where: {
                universalVoucher: {
                    partyAccountId: accountId, status: "POSTED",
                    type: { in: [...TIER_SPEND_VOUCHER_TYPES] },
                    date: p.fromDay === 0 ? { gt: notBefore } : { gt: notBefore, lte: notAfter },
                },
            },
            _sum: { totalAmount: true },
        }));
    }
    const invoiceCount = await db.voucherDetail.count({
        where: {
            universalVoucher: {
                partyAccountId: accountId, status: "POSTED",
                type: { in: [...TIER_SPEND_VOUCHER_TYPES] },
            },
        },
    });
    const couponConfig = await db.couponConfig.findUnique({ where: { id: 1 }, select: { maxTotalDiscountPct: true, maxTierDiscountPct: true, maxCouponDiscountPct: true } });

    const tierPeriodInputs: TierPeriodInput[] = tierPeriods.map((p, i) => ({
        id:               p.id,
        name:             p.name,
        currentSaleScope: p.currentSaleScope,
        currentSaleOnly:  p.currentSaleOnly,
        fromDay:          p.fromDay,
        toDay:            p.toDay,
        spend:            Number(periodAggs[i]?._sum.totalAmount ?? 0),
        levels:           p.levels.map((l) => ({
            name:        l.name,
            minSpend:    Number(l.minSpend),
            discountPct: Number(l.discountPct),
        })),
    }));

    const totalCapPct = couponConfig?.maxTotalDiscountPct != null ? Number(couponConfig.maxTotalDiscountPct) : null;
    const ownCapPct = couponConfig?.maxTierDiscountPct != null ? Number(couponConfig.maxTierDiscountPct) : null;
    const couponCapPct = couponConfig?.maxCouponDiscountPct != null ? Number(couponConfig.maxCouponDiscountPct) : null;
    const tierCapPct = ownCapPct == null ? totalCapPct : totalCapPct == null ? ownCapPct : Math.min(ownCapPct, totalCapPct);
    const isNewCustomer = invoiceCount === 0 && (opts.extraPriorSales ?? 0) === 0;
    const tier = resolveTierTitles({
        periods: tierPeriodInputs,
        currentSaleValue,
        isNewCustomer,
        capPct: tierCapPct,
    });

    return { tierPeriodInputs, tierCapPct, totalCapPct, couponCapPct, invoiceCount, isNewCustomer, tier };
}
