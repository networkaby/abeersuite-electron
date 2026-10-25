/** Keep digits + a single decimal point — the first one wins, every later
 *  dot is dropped (a pasted "1.2.3.4" becomes "1.234"). For free-typed
 *  money/qty text inputs. */
export const parseDecimalInput = (s: string): string => {
    const cleaned = s.replace(/[^\d.]/g, "");
    const firstDot = cleaned.indexOf(".");
    if (firstDot === -1) return cleaned;
    return cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, "");
};

/** Keep digits only. */
export const parseDigitsInput = (s: string): string => s.replace(/[^\d]/g, "");

/** Keep digits + a single leading minus. */
export const parseSignedInput = (s: string): string =>
    s.replace(/[^\d-]/g, "").replace(/(?!^)-/g, "");

/** Clamp `n` into [min, max], ignoring bounds that weren't given. Pairs with
 *  the sanitisers above: they decide what may be typed, this decides what the
 *  value settles to once the user leaves the field. */
export const clampNumber = (n: number, min?: number, max?: number): number =>
    Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? Number.NEGATIVE_INFINITY, n));

// ── Typed amounts (Tally-style text boxes) ─────────────────────────────────
// For amount boxes that accept Indian/Western grouping ("1,00,000"): the
// `is…Chars` checks filter keystrokes, the `parse…` ones read the value.

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
