/**
 * Round to 2 decimal places (money precision). Use this — not a bare
 * `Number(...)` or `* 100 / 100` — whenever a Prisma `Decimal(14,2)` value or a
 * float result crosses into JS number math, so float drift (0.1 + 0.2 …) can
 * never reach the GL or a displayed amount.
 */
export function round2(n: number): number {
    return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Prisma Decimal / string / number → JS number rounded to 2dp money precision. */
export function moneyNumber(value: number | string | { toString(): string }): number {
    return round2(Number(value));
}

/** Integer paise → rupees at 2dp (e.g. 19900 → 199.00). */
export function paiseToRupees(paise: number): number {
    return round2(paise / 100);
}

/** Rupees (float or 2dp) → integer paise, rounded (e.g. 199.005 → 19901). */
export function rupeesToPaise(rupees: number): number {
    return Math.round(rupees * 100);
}

/** Format integer paise as ₹ string with two decimals (e.g. 19900 → ₹199.00). */
export function formatRupeesFromPaise(paise: number): string {
    const rupees = paise / 100;
    return new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(rupees);
}

/** Format rupees (already a float) as ₹ string with no decimals (e.g. 1234 → ₹1,234). */
export function formatRupees(rupees: number): string {
    return new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    }).format(rupees);
}

/**
 * Float rupees → "₹1,234.00" (2dp, default) or "₹1,234" (0dp), matching the
 * legacy inline `₹${n.toLocaleString("en-IN", …)}` format used across modules.
 */
export function formatInr(rupees: number, decimals: 0 | 2 = 2): string {
    return `₹${rupees.toLocaleString("en-IN", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
    })}`;
}

/**
 * A signed ledger `closing` (positive = balance sits on the account's own
 * "normal" side, per `aggregateClosingAsOf`) → tally-style "1,234.00 Dr/Cr".
 * Matches the legacy `fmt()` grouping (@/utils/constants) used across the
 * account-ledger screens — kept en-US so figures line up identically there.
 */
export function formatDrCr(balance: number, normalBalance: "DEBIT" | "CREDIT" | null): string {
    if (balance === 0) return "0.00";
    const sign = balance < 0
        ? (normalBalance === "DEBIT" ? "Cr" : "Dr")
        : (normalBalance === "DEBIT" ? "Dr" : "Cr");
    const abs = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(balance));
    return `${abs} ${sign}`;
}
