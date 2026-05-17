// Bill of Materials (BOM) helpers — pure functions shared between the
// Manufacturing Journal form and the BOM master page.

export type BomLine = { productId: number; qty: number };

/**
 * Scale a BOM's consumption lines proportional to a target output qty.
 *
 * Example: BOM defines "5 kg flour produces 10 loaves" (outputQty = 10). If
 * the operator wants to produce 25 loaves, every consumption line is
 * multiplied by 25/10 = 2.5 (so 5 kg flour → 12.5 kg flour).
 *
 * Caller is responsible for rounding / unit-of-measure presentation.
 */
export function scaleBomLines<T extends BomLine>(
    bomLines: T[],
    bomOutputQty: number,
    targetOutputQty: number,
): T[] {
    if (!(bomOutputQty > 0) || !(targetOutputQty > 0)) return bomLines.map((l) => ({ ...l }));
    const factor = targetOutputQty / bomOutputQty;
    return bomLines.map((l) => ({ ...l, qty: Number((l.qty * factor).toFixed(3)) }));
}
