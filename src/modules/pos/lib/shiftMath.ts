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
