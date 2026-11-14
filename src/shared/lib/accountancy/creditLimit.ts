import { CUSTOMER_SALE_VOUCHER_TYPES } from "@/shared/lib/constants/accounting";
import type { Prisma } from "@/generated/prisma/client";

// ── Auto credit-limit resolver ───────────────────────────────────────────────
//
// The per-customer MANUAL limit lives on Account.creditLimit. On top of that,
// the CreditLimitConfig singleton (id=1) can switch on an AUTO limit sized from
// each customer's own recent trading:
//
//   auto limit = pctOfSales% of the customer's POSTED sales in the last windowDays
//
// The EFFECTIVE limit enforced everywhere is the HIGHER of the two — a manual
// limit never lowers what a good auto number would grant, and vice-versa. When
// autoEnabled is false this collapses to the old deny-by-default model: manual
// only, null/0 = cash-only.

export interface CreditLimitConfigLite {
    autoEnabled:  boolean;
    windowDays:   number;
    pctOfSales:   number;
    maxAutoLimit: number | null;
    roundToStep:  number;
}

const SALE_TYPES = CUSTOMER_SALE_VOUCHER_TYPES;

// Pure — the auto limit for a given windowed sales total. Returns 0 when auto is
// off or there is no sales history to size it from.
export function computeAutoCreditLimit(salesInWindow: number, cfg: CreditLimitConfigLite): number {
    if (!cfg.autoEnabled || salesInWindow <= 0 || cfg.pctOfSales <= 0) return 0;
    let limit = salesInWindow * (cfg.pctOfSales / 100);
    if (cfg.roundToStep > 0) limit = Math.round(limit / cfg.roundToStep) * cfg.roundToStep;
    if (cfg.maxAutoLimit != null) limit = Math.min(limit, cfg.maxAutoLimit);
    return Math.max(0, limit);
}

const AUTO_OFF: CreditLimitConfigLite = { autoEnabled: false, windowDays: 90, pctOfSales: 0, maxAutoLimit: null, roundToStep: 0 };

// Load the singleton config as plain numbers (Prisma Decimals flattened).
// Safe defaults (auto OFF) when the row is missing so nothing auto-grants by
// accident before the config is seeded. Also swallows a missing-table error
// (P2021) so the pre-`db push` window behaves exactly like the old manual-only
// model instead of 500-ing POS sales / the Contacts page. Remove the catch once
// the table is live everywhere.
export async function loadCreditLimitConfig(db: Prisma.TransactionClient): Promise<CreditLimitConfigLite> {
    try {
        const row = await db.creditLimitConfig.findUnique({ where: { id: 1 } });
        return {
            autoEnabled:  row?.autoEnabled ?? false,
            windowDays:   row?.windowDays ?? 90,
            pctOfSales:   row ? Number(row.pctOfSales) : 0,
            maxAutoLimit: row?.maxAutoLimit != null ? Number(row.maxAutoLimit) : null,
            roundToStep:  row?.roundToStep ?? 0,
        };
    } catch {
        return AUTO_OFF;
    }
}

// Σ POSTED SALE/POS voucher totals for one account over the trailing window.
export async function windowSalesTotal(
    db: Prisma.TransactionClient,
    accountId: number,
    windowDays: number,
): Promise<number> {
    const since = new Date();
    since.setDate(since.getDate() - windowDays);
    const agg = await db.voucherDetail.aggregate({
        where: {
            universalVoucher: {
                partyAccountId: accountId,
                status:         "POSTED",
                type:           { in: [...SALE_TYPES] },
                date:           { gte: since },
            },
        },
        _sum: { totalAmount: true },
    });
    return Number(agg._sum.totalAmount ?? 0);
}

// Manual and auto limits for many accounts in two queries — for whole-list jobs
// (due reminders) that must not run windowSalesTotal per party.
export async function creditLimitsFor(
    db: Prisma.TransactionClient,
    accountIds: number[],
    cfg?: CreditLimitConfigLite,
): Promise<Map<number, { manual: number; auto: number }>> {
    const out = new Map<number, { manual: number; auto: number }>();
    if (!accountIds.length) return out;
    const config = cfg ?? (await loadCreditLimitConfig(db));
    const accounts = await db.account.findMany({ where: { id: { in: accountIds } }, select: { id: true, creditLimit: true } });
    for (const a of accounts) out.set(a.id, { manual: Math.max(0, Number(a.creditLimit ?? 0)), auto: 0 });
    if (!config.autoEnabled) return out;

    const since = new Date();
    since.setDate(since.getDate() - config.windowDays);
    const rows = await db.voucherDetail.findMany({
        where: {
            universalVoucher: {
                partyAccountId: { in: accountIds },
                status:         "POSTED",
                type:           { in: [...SALE_TYPES] },
                date:           { gte: since },
            },
        },
        select: { totalAmount: true, universalVoucher: { select: { partyAccountId: true } } },
    });
    const sales = new Map<number, number>();
    for (const r of rows) {
        const id = r.universalVoucher?.partyAccountId;
        if (id != null) sales.set(id, (sales.get(id) ?? 0) + Number(r.totalAmount ?? 0));
    }
    for (const [id, total] of sales) {
        const lim = out.get(id);
        if (lim) lim.auto = computeAutoCreditLimit(total, config);
    }
    return out;
}

// The effective limit for one customer = max(manual, auto). Skips the sales
// aggregate entirely when auto is off. `manualLimit` is the raw Account.creditLimit
// coerced to a number (null → 0).
export async function resolveEffectiveCreditLimit(
    db: Prisma.TransactionClient,
    accountId: number,
    manualLimit: number,
    cfg?: CreditLimitConfigLite,
): Promise<{ effective: number; manual: number; auto: number }> {
    const config = cfg ?? (await loadCreditLimitConfig(db));
    const manual = Math.max(0, manualLimit);
    let auto = 0;
    if (config.autoEnabled) {
        const sales = await windowSalesTotal(db, accountId, config.windowDays);
        auto = computeAutoCreditLimit(sales, config);
    }
    return { effective: Math.max(manual, auto), manual, auto };
}
