/**
 * Strict numeric id: a positive integer, else null. Stricter than
 * `parseIdParam` (which only asks for a finite number) — the routes that use
 * this refuse `0`, negatives and fractions on purpose.
 */
export function parseNumericId(raw: string): number | null {
    const n = Number(raw);
    return Number.isInteger(n) && n > 0 ? n : null;
}
