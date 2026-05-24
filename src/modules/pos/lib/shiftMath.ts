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
    openingFloatPaise: bigint,
    cashSalesPaise:    bigint,
    dropsPaise:        bigint,
): bigint {
    return openingFloatPaise + cashSalesPaise - dropsPaise;
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
