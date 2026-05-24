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
 * The till sees deposits from receipt vouchers (DR till / CR customer AR
 * on cash POS sales) and withdrawals from refunds (CR till) — net of the
 * two is the shift's takings. Filtered to receipt-side movements only by
 * joining through Voucher type=RECEIPT so the opening-Contra and any
 * cash drops (which are PosCashDrop log rows, no GL hit) are excluded.
 *
 * Replaces the legacy `prisma.payment.findMany({ method: CASH, ... })`
 * sweep that died with the Payment table on 2026-05-24.
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
    const lines = await tx.voucherLine.findMany({
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
    return lines.reduce(
        (s, l) => s + BigInt(Math.round(Number(l.amount) * 100)),
        BigInt(0),
    );
}
