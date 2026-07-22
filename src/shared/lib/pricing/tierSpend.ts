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
export const TIER_SPEND_VOUCHER_TYPES = ["SALE", "POS", "ONLINE_INVOICE"] as const;

export type TierSpendContext = {
    /** Periods with bracket spend attached — the resolver's raw material
     *  (also returned to the POS so it can re-resolve against the live cart). */
    tierPeriodInputs: TierPeriodInput[];
    /** Global discount guard (CouponConfig.maxTotalDiscountPct); null = uncapped. */
    tierCapPct: number | null;
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

    const [periodAggs, invoiceCount, couponConfig] = await Promise.all([
        // Spend inside each period's bracket — `fromDay <= age < toDay`, older
        // edge exclusive / newer edge inclusive so tiled brackets (0-30, 30-90)
        // hand a sale to exactly one period. fromDay 0 has no upper bound.
        Promise.all(tierPeriods.map((p) => {
            const notBefore = new Date();
            notBefore.setDate(notBefore.getDate() - p.toDay);
            const notAfter = new Date();
            notAfter.setDate(notAfter.getDate() - p.fromDay);
            return db.voucherDetail.aggregate({
                where: {
                    universalVoucher: {
                        partyAccountId: accountId, status: "POSTED", deletedAt: null,
                        type: { in: [...TIER_SPEND_VOUCHER_TYPES] },
                        date: p.fromDay === 0 ? { gt: notBefore } : { gt: notBefore, lte: notAfter },
                    },
                },
                _sum: { totalAmount: true },
            });
        })),
        db.voucherDetail.count({
            where: {
                universalVoucher: {
                    partyAccountId: accountId, status: "POSTED", deletedAt: null,
                    type: { in: [...TIER_SPEND_VOUCHER_TYPES] },
                },
            },
        }),
        db.couponConfig.findUnique({ where: { id: 1 }, select: { maxTotalDiscountPct: true } }),
    ]);

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

    const tierCapPct = couponConfig?.maxTotalDiscountPct != null ? Number(couponConfig.maxTotalDiscountPct) : null;
    const isNewCustomer = invoiceCount === 0 && (opts.extraPriorSales ?? 0) === 0;
    const tier = resolveTierTitles({
        periods: tierPeriodInputs,
        currentSaleValue,
        isNewCustomer,
        capPct: tierCapPct,
    });

    return { tierPeriodInputs, tierCapPct, invoiceCount, isNewCustomer, tier };
}
