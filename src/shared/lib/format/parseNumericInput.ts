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
