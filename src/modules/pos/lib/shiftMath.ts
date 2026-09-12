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
//   − Σ mid-shift cash expenditures (paid out of the till for an expense)
//   − Σ mid-shift cash refunds (paid out of the till on a SALE_RETURN)
//
// Variance is whatever the cashier physically counted vs. what we expect.
// Positive = drawer over (income via Cash Over); negative = short
// (expense via Cash Short).

export function computeExpectedCash(
    openingFloatPaise:  bigint,
    cashSalesPaise:     bigint,
    dropsPaise:         bigint,
    expendituresPaise:  bigint = BigInt(0),
    refundsPaise:       bigint = BigInt(0),
): bigint {
    // Drops leave the drawer for the safe; expenditures leave it for an expense;
    // refunds leave it back into a customer's hand. All three reduce the cash
    // the cashier should physically count.
    return openingFloatPaise + cashSalesPaise - dropsPaise - expendituresPaise - refundsPaise;
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

// Sums Decimal-shaped GL amounts (rupees) into paise. Shared by
// sumShiftCashSalesPaise and sumShiftCashRefundsPaise.
const sumGlAmountsToPaise = (rows: Array<{ amount: { toString(): string } }>): bigint =>
    rows.reduce((s, r) => s + BigInt(Math.round(Number(r.amount) * 100)), BigInt(0));

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

    // POS sale tenders → the spine's role=TENDER GL lines (G4b-3). The shift
    // window is keyed off `InvVoucher.createdAt` (the sale time) — NOT the spine
    // row's createdAt, which is the backfill time for historical rows — so we
    // resolve the in-window POS vouchers' JEs first, then read their till tenders.
    const posUvIds = (await tx.voucherDetail.findMany({
        where:  { universalVoucher: { type: "POS", status: "POSTED", deletedAt: null }, createdAt: { gte: args.openedAt, lte: end } },   // 5D-8/5D-11
        select: { universalVoucherId: true },
    })).map((v) => v.universalVoucherId).filter((x): x is number => x != null);
    const posTenders = posUvIds.length === 0 ? [] : await tx.voucherGlLine.findMany({
        where: {
            accountId:          args.tillAccountId,
            role:               "TENDER",
            universalVoucherId: { in: posUvIds },
        },
        select: { amount: true },
    });

    // Office RECEIPT vouchers (Customer pays old credit bill) — read the till
    // debit off the spine (G5); windowed on the spine's faithful sourceCreatedAt.
    const receiptLines = await tx.voucherGlLine.findMany({
        where: {
            accountId: args.tillAccountId,
            type:      "DEBIT",
            universalVoucher: {
                type:            "RECEIPT",
                status:          "POSTED",
                deletedAt:       null,
                sourceCreatedAt: { gte: args.openedAt, lte: end },
            },
        },
        select: { amount: true },
    });

    return sumGlAmountsToPaise(posTenders) + sumGlAmountsToPaise(receiptLines);
}

// Cash refunded out of the till during the shift window (SALE_RETURN, CASH mode).
export async function sumShiftCashRefundsPaise(
    tx: Tx,
    args: {
        tillAccountId: number;
        openedAt:      Date;
        closedAt?:     Date | null;
    },
): Promise<bigint> {
    const end = args.closedAt ?? new Date();

    const returnUvIds = (await tx.voucherDetail.findMany({
        where:  { universalVoucher: { type: "SALE_RETURN", status: "POSTED", deletedAt: null }, createdAt: { gte: args.openedAt, lte: end } },
        select: { universalVoucherId: true },
    })).map((v) => v.universalVoucherId).filter((x): x is number => x != null);
    const refundTenders = returnUvIds.length === 0 ? [] : await tx.voucherGlLine.findMany({
        where: {
            accountId:          args.tillAccountId,
            role:               "TENDER",
            type:               "CREDIT",
            universalVoucherId: { in: returnUvIds },
        },
        select: { amount: true },
    });

    return sumGlAmountsToPaise(refundTenders);
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

    // POS sale tenders (Dr Till / Bank / Wallet …) → spine role=TENDER GL lines
    // (G4b-3). Windowed off InvVoucher.createdAt (sale time), then grouped per
    // settlement account from the spine. See sumShiftCashSalesPaise for why.
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

    // Office RECEIPT vouchers settled at this counter (old credit bill paid) —
    // read off the spine (G5), windowed on the faithful sourceCreatedAt.
    const receiptLines = await tx.voucherGlLine.groupBy({
        by:    ["accountId"],
        where: {
            accountId: { in: args.accountIds },
            type:      "DEBIT",
            universalVoucher: { type: "RECEIPT", status: "POSTED", deletedAt: null, sourceCreatedAt: { gte: args.openedAt, lte: end } },
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
