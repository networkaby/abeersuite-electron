import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { effectiveAccountBalance, type AccountForEffectiveBalance } from "@/modules/accountancy/lib/balance";

type Tx = Prisma.TransactionClient | PrismaClient;

// ── POS shift cash math ──────────────────────────────────────────────────────
//
// All values in paise (BigInt) to dodge floating-point drift.
//
// The till account IS the drawer's book. A shift opens with the till's book
// balance as its opening float (carry-over + the vault top-up Contra), and every
// movement during the shift — sale cash, receipts, cash refunds, expenditures,
// a manual entry — lands on that same ledger. So at close:
//
//     expected in drawer = till book balance now − Σ mid-shift cash drops
//
// Drops are the one exception: the cash physically left for the safe, but it
// stays on the till ledger until the closing Contra sweeps it. Nothing is
// re-derived per voucher type — the Cash Book and the close read one figure.
//
// Variance is whatever the cashier physically counted vs. what we expect.
// Positive = drawer over (income via Cash Over); negative = short
// (expense via Cash Short).

/** The till's current book balance in paise — the same read shift OPEN uses for
 *  the carry-over, so open and close see the ledger identically. */
export function effectiveBalancePaise(account: AccountForEffectiveBalance): bigint {
    return BigInt(Math.round(effectiveAccountBalance(account) * 100));
}

export function computeExpectedCash(
    tillBookBalancePaise: bigint,
    dropsPaise:           bigint,
): bigint {
    return tillBookBalancePaise - dropsPaise;
}

export function computeVariance(
    declaredCashPaise: bigint,
    expectedCashPaise: bigint,
): bigint {
    return declaredCashPaise - expectedCashPaise;
}

/**
 * Sums a list of payment amounts in paise. Defensive against null/undefined.
 */
export function sumPaise(rows: Array<{ amountPaise: bigint | number | string | null | undefined }>): bigint {
    let total = BigInt(0);
    for (const r of rows) {
        if (r.amountPaise == null) continue;
        total += typeof r.amountPaise === "bigint" ? r.amountPaise : BigInt(r.amountPaise);
    }
    return total;
}

/**
 * Total collected per settlement account during a shift, in paise — for the
 * informational "Payments collected" tally (the reconciliation itself reads the
 * till's book balance, see above). Two sources:
 *
 *   • POS sale tenders (Dr Till / Bank / Wallet …) → the spine's role=TENDER GL
 *     lines, windowed off VoucherDetail.createdAt (the sale time).
 *   • Receipts taken on this shift → the shift's own PosReceipt links (every
 *     counter receipt flow writes one), read as the DEBIT legs of those spines.
 *     Linked, not windowed, so a receipt's timestamp can never drop it.
 *
 * Returns a Map keyed by accountId; accounts with no activity are absent.
 */
export async function sumShiftTendersByAccount(
    tx: Tx,
    args: {
        shiftId:    number;
        accountIds: number[];
        openedAt:   Date;
        closedAt?:  Date | null;
    },
): Promise<Map<number, bigint>> {
    const totals = new Map<number, bigint>();
    if (args.accountIds.length === 0) return totals;
    const end = args.closedAt ?? new Date();
    const toPaise = (amount: { toString(): string } | null): bigint =>
        amount == null ? BigInt(0) : BigInt(Math.round(Number(amount) * 100));
    const add = (accountId: number, paise: bigint) =>
        totals.set(accountId, (totals.get(accountId) ?? BigInt(0)) + paise);

    const posUvIds = (await tx.voucherDetail.findMany({
        where:  { universalVoucher: { type: "POS", status: "POSTED", deletedAt: null }, createdAt: { gte: args.openedAt, lte: end } },   // 5D-8/5D-11
        select: { universalVoucherId: true },
    })).map((v) => v.universalVoucherId).filter((x): x is number => x != null);
    const posTenders = posUvIds.length === 0 ? [] : await tx.voucherGlLine.groupBy({
        by:    ["accountId"],
        where: {
            accountId:          { in: args.accountIds },
            role:               "TENDER",
            universalVoucherId: { in: posUvIds },
        },
        _sum:  { amount: true },
    });
    for (const r of posTenders) add(r.accountId, toPaise(r._sum.amount));

    const receiptUvIds = (await tx.posReceipt.findMany({
        where:  { shiftId: args.shiftId },
        select: { voucherId: true },
    })).map((r) => r.voucherId).filter((x): x is number => x != null);
    const receiptLines = receiptUvIds.length === 0 ? [] : await tx.voucherGlLine.groupBy({
        by:    ["accountId"],
        where: {
            accountId:          { in: args.accountIds },
            type:               "DEBIT",
            universalVoucherId: { in: receiptUvIds },
            universalVoucher:   { status: "POSTED", deletedAt: null },
        },
        _sum:  { amount: true },
    });
    for (const r of receiptLines) add(r.accountId, toPaise(r._sum.amount));

    return totals;
}

// Counter shape needed to map settlement accounts → method labels. Structurally
// matched by the Prisma counter objects the shift routes already load (cash till
// + the flexible payment-account list).
type CounterRouting = {
    tillAccount:     { id: number };
    paymentAccounts: { channel: string; label: string; accountId: number }[];
};

export type TenderBreakdownRow = { method: string; label: string; amountPaise: string };

/**
 * Per-method tally of everything collected at a counter during a shift, for
 * the close report. CASH routes to the till; each other method uses its
 * per-counter routing account and optional custom label ("PhonePe UPI" etc.).
 * Only methods with a positive total are returned. If two methods share one
 * account, the first in display order claims it (no double-count).
 */
export async function buildShiftTenderBreakdown(
    tx: Tx,
    args: { shiftId: number; counter: CounterRouting; openedAt: Date; closedAt?: Date | null },
): Promise<TenderBreakdownRow[]> {
    const c = args.counter;
    const defs: Array<{ method: string; accountId: number | null; label: string }> = [
        { method: "CASH", accountId: c.tillAccount.id, label: "Cash" },
        ...c.paymentAccounts.map((a) => ({ method: a.channel, accountId: a.accountId as number | null, label: a.label?.trim() || a.channel })),
    ];

    const accountIds = [...new Set(defs.map((d) => d.accountId).filter((x): x is number => x != null))];
    const totals = await sumShiftTendersByAccount(tx, { shiftId: args.shiftId, accountIds, openedAt: args.openedAt, closedAt: args.closedAt });

    const claimed = new Set<number>();
    const rows: TenderBreakdownRow[] = [];
    for (const d of defs) {
        if (d.accountId == null || claimed.has(d.accountId)) continue;
        claimed.add(d.accountId);
        const amt = totals.get(d.accountId) ?? BigInt(0);
        if (amt > BigInt(0)) rows.push({ method: d.method, label: d.label, amountPaise: amt.toString() });
    }
    return rows;
}
