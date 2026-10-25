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

/**
 * A typed ₹ field → integer paise. Blank, non-numeric or negative → null, so an
 * optional field stays unset; a typed 0 is a real 0 (a free item, a zero cost).
 * The one parser behind every rupee text input — the dialogs used to carry
 * their own copies, and they disagreed on whether 0 counted.
 */
export function parseRupeesToPaise(s: string): number | null {
    const t = s.trim();
    if (t === "") return null;
    const n = parseFloat(t);
    if (!Number.isFinite(n) || n < 0) return null;
    return rupeesToPaise(n);
}

// Each formatter is built once and reused: building an Intl.NumberFormat is
// far slower than calling one, and a register can format thousands of cells.
// Every figure uses Indian grouping (1,23,456.50), on screen and on paper.
const INR_2DP = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const INR_0DP = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 0, maximumFractionDigits: 0 });
const NUM_2DP = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const NUM_0DP = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const NUM_LOOSE = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

/** Format integer paise as ₹ string with two decimals (e.g. 19900 → ₹199.00). */
export function formatRupeesFromPaise(paise: number): string {
    return INR_2DP.format(paise / 100);
}

/** Format rupees (already a float) as ₹ string with no decimals (e.g. 1234 → ₹1,234). */
export function formatRupees(rupees: number): string {
    return INR_0DP.format(rupees);
}

/**
 * Float rupees → "₹1,234.00" (2dp, default) or "₹1,234" (0dp), matching the
 * legacy inline `₹${n.toLocaleString("en-IN", …)}` format used across modules.
 */
export function formatInr(rupees: number, decimals: 0 | 2 = 2): string {
    return `₹${(decimals === 2 ? NUM_2DP : NUM_0DP).format(rupees)}`;
}

/**
 * Plain 2dp amount, no ₹ sign (e.g. 123456.5 → "1,23,456.50"). The figure style
 * of the accountancy, BI and POS screens, printed slips, invoices and WhatsApp
 * messages, where the column header or the sentence already says it is rupees.
 */
export function formatAmount(n: number): string {
    return NUM_2DP.format(n);
}

/** Short name for `formatAmount` — the one most screens already import. */
export const fmt = formatAmount;

/** Printed-paper style, "Rs. 1,23,456.50" — the A4 and receipt prints spell the
 *  rupee out rather than trust every printer font with ₹. */
export function formatRs(n: number): string {
    return `Rs. ${formatAmount(n)}`;
}

/** Which side a signed ledger balance sits on. Positive = the account's own
 *  "normal" side (per `aggregateClosingAsOf`); no nature given reads as DEBIT. */
export function drCrSide(balance: number, normalBalance: "DEBIT" | "CREDIT" | null): "Dr" | "Cr" {
    const nb = normalBalance ?? "DEBIT";
    return balance < 0
        ? (nb === "DEBIT" ? "Cr" : "Dr")
        : (nb === "DEBIT" ? "Dr" : "Cr");
}

/**
 * A signed ledger `closing` → tally-style "1,23,456.00 Dr/Cr". Same grouping as
 * `fmt()` above, so figures line up identically on the account-ledger screens.
 */
export function formatDrCr(balance: number, normalBalance: "DEBIT" | "CREDIT" | null): string {
    if (balance === 0) return "0.00";
    return `${fmt(Math.abs(balance))} ${drCrSide(balance, normalBalance)}`;
}

/** Float rupees → "₹1,234.5" — up to 2dp, no padding zeros (chips, tooltips, share text). */
export function formatInrLoose(rupees: number): string {
    return `₹${NUM_LOOSE.format(rupees)}`;
}
