import type { Prisma, PrismaClient } from "@/generated/prisma/client";

type Tx = Prisma.TransactionClient | PrismaClient;

// ── POS shift cash math ──────────────────────────────────────────────────────
//
// All values in paise (BigInt) to dodge floating-point drift. The expected
// drawer balance at the moment of close is:
//
//     opening float
//   + Σ cash receipts from billing during the shift
//   − Σ mid-shift cash drops (physically moved to safe but still in the till
//     account from a GL standpoint until the closing Contra fires)
//
// Variance is whatever the cashier physically counted vs. what we expect.
// Positive = drawer over (income via Cash Over); negative = short
// (expense via Cash Short).

export function computeExpectedCash(
    openingFloatPaise:  bigint,
    cashSalesPaise:     bigint,
    dropsPaise:         bigint,
    expendituresPaise:  bigint = BigInt(0),
): bigint {
    // Drops leave the drawer for the safe; expenditures leave it for an expense.
    // Both reduce the cash the cashier should physically count.
    return openingFloatPaise + cashSalesPaise - dropsPaise - expendituresPaise;
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
 * Cash that hit the counter's till during a shift window.
 *
 * Sums tender rows pointing at the till from two sources:
 *
 *   • POS InvVouchers (type=POS) — the modern shape (Layer 7g):
 *     the cashier rings up a sale, the InvVoucher carries the till
 *     tender directly, and the JE debits the till for that amount.
 *
 *   • Office RECEIPT Vouchers — customer pays an old credit bill at
 *     this counter. Posts Dr Till / Cr Customer AR. Counted only when
 *     the receipt was created in the shift window.
 *
 * Opening Contra (vault → counter) and mid-shift cash drops are
 * deliberately NOT counted: the Contra is a one-off transfer, and
 * drops are PosCashDrop log rows with no GL hit.
 */
export async function sumShiftCashSalesPaise(
    tx: Tx,
    args: {
        tillAccountId: number;
        openedAt:      Date;
        closedAt?:     Date | null;
    },
): Promise<bigint> {
    const end = args.closedAt ?? new Date();

    // POS sale tenders → directly on the InvVoucher (no separate Receipt).
    const posTenders = await tx.invVoucherTender.findMany({
        where: {
            accountId: args.tillAccountId,
            voucher: {
                type:      "POS",
                status:    "POSTED",
                deletedAt: null,
                createdAt: { gte: args.openedAt, lte: end },
            },
        },
        select: { amount: true },
    });

    // Office RECEIPT vouchers (Customer pays old credit bill).
    const receiptLines = await tx.voucherLine.findMany({
        where: {
            accountId: args.tillAccountId,
            type:      "DEBIT",
            voucher: {
                type:      "RECEIPT",
                status:    "POSTED",
                deletedAt: null,
                createdAt: { gte: args.openedAt, lte: end },
            },
        },
        select: { amount: true },
    });

    const sum = (rows: Array<{ amount: { toString(): string } }>): bigint =>
        rows.reduce((s, r) => s + BigInt(Math.round(Number(r.amount) * 100)), BigInt(0));

    return sum(posTenders) + sum(receiptLines);
}

/**
 * Total collected per settlement account during a shift window, in paise.
 *
 * Same two sources as `sumShiftCashSalesPaise` (POS tender rows + RECEIPT
 * debits) but for an arbitrary set of accounts and grouped per account — so
 * the till gives the cash total (== reconciliation cash) and each non-cash
 * routing account gives that method's total. Returns a Map keyed by accountId;
 * accounts with no activity are simply absent.
 */
export async function sumShiftTendersByAccount(
    tx: Tx,
    args: {
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

    // POS sale tenders (Dr Till / Bank / Wallet …) carried on the voucher.
    const posTenders = await tx.invVoucherTender.groupBy({
        by:    ["accountId"],
        where: {
            accountId: { in: args.accountIds },
            voucher:   { type: "POS", status: "POSTED", deletedAt: null, createdAt: { gte: args.openedAt, lte: end } },
        },
        _sum:  { amount: true },
    });
    for (const r of posTenders) add(r.accountId, toPaise(r._sum.amount));

    // Office RECEIPT vouchers settled at this counter (old credit bill paid).
    const receiptLines = await tx.voucherLine.groupBy({
        by:    ["accountId"],
        where: {
            accountId: { in: args.accountIds },
            type:      "DEBIT",
            voucher:   { type: "RECEIPT", status: "POSTED", deletedAt: null, createdAt: { gte: args.openedAt, lte: end } },
        },
        _sum:  { amount: true },
    });
    for (const r of receiptLines) if (r.accountId != null) add(r.accountId, toPaise(r._sum.amount));

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
 * Per-method tally of everything collected at a counter during a shift window,
 * for the close report. CASH always routes to the till (so its total matches
 * the cash reconciliation); each other method uses its per-counter routing
 * account and optional custom label ("PhonePe UPI" etc.). Only methods with a
 * positive total are returned. If two methods share one account, the first in
 * display order claims it (no double-count).
 */
export async function buildShiftTenderBreakdown(
    tx: Tx,
    args: { counter: CounterRouting; openedAt: Date; closedAt?: Date | null },
): Promise<TenderBreakdownRow[]> {
    const c = args.counter;
    const defs: Array<{ method: string; accountId: number | null; label: string }> = [
        { method: "CASH", accountId: c.tillAccount.id, label: "Cash" },
        ...c.paymentAccounts.map((a) => ({ method: a.channel, accountId: a.accountId as number | null, label: a.label?.trim() || a.channel })),
    ];

    const accountIds = [...new Set(defs.map((d) => d.accountId).filter((x): x is number => x != null))];
    const totals = await sumShiftTendersByAccount(tx, { accountIds, openedAt: args.openedAt, closedAt: args.closedAt });

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
