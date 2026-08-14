// User-typed amount helpers — used by Tally-style amount inputs that are
// `type="text"` (not `type="number"`) so commas, Indian grouping, and free
// editing don't fight the browser. Validation happens in code.

/** Parse a user-typed amount string. Strips Indian/Western separators;
 *  tolerant of "10000", "10,000", "1,00,000". Returns 0 for empty/invalid. */
export function parseAmount(s: string | undefined | null): number {
    if (!s) return 0;
    const cleaned = String(s).replace(/[,_\s]/g, "");
    const n = parseFloat(cleaned);
    return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** True iff the string contains only allowed amount characters
 *  (digits, comma, period, spaces). Used in onChange to filter
 *  keystrokes — keeps the user from typing letters. */
export function isAmountChars(s: string): boolean {
    return /^[\d,.\s]*$/.test(s);
}

/** As `parseAmount`, but keeps a leading minus — for figures that are
 *  meaningfully negative (a targeted shortfall, an adjustment). */
export function parseSignedAmount(s: string | undefined | null): number {
    if (!s) return 0;
    const cleaned = String(s).replace(/[,_\s]/g, "");
    const n = parseFloat(cleaned);
    return Number.isFinite(n) ? n : 0;
}

/** As `isAmountChars`, but allows one leading minus sign. */
export function isSignedAmountChars(s: string): boolean {
    return /^-?[\d,.\s]*$/.test(s);
}
