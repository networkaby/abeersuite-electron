// The safety wall. A line bills at its barcode price; its effective sale price
// is the lowest it may ever end up at. Every discount — tier, loyalty, coupon,
// group rebate — comes out of the gap between the two and stops at the wall.
//
// Pure maths, shared by the POS screen (usePosBilling) and the server
// (/api/pos/sale, /api/pos/coupon-validate) so the shown total and the posted
// total agree. A line with no floor (service, no sale price, an edited or
// converted line) has no wall and keeps the old behaviour.

/** Pre-tax floor per unit from a tax-inclusive sale price in paise; null = no wall. */
export function floorExclFromPaise(salePaise: number | null | undefined, taxRate: number): number | null {
    if (salePaise == null || salePaise <= 0) return null;
    const incl = salePaise / 100;
    return taxRate > 0 ? incl / (1 + taxRate / 100) : incl;
}

/** Tier discount (pre-tax rupees) cut back so the line never nets below its floor. */
export function capToFloorExcl(discExcl: number, qty: number, unitPrice: number, floorExcl: number | null): number {
    if (floorExcl == null) return discExcl;
    return Math.max(0, Math.min(discExcl, qty * (unitPrice - floorExcl)));
}

export type FloorRoomLine = { qty: number; unitPrice: number; taxRate: number; floorExcl: number | null };

/**
 * Tax-inclusive rupees the whole bill may be discounted by before any floored
 * line hits its wall. A line with no floor counts its full value (no wall).
 * Subtract the tier discount (incl) to get what loyalty + coupon may still take.
 */
export function floorRoomIncl(lines: FloorRoomLine[]): number {
    return lines.reduce((s, l) => {
        const perUnitExcl = l.floorExcl == null ? l.unitPrice : Math.max(0, l.unitPrice - l.floorExcl);
        return s + l.qty * perUnitExcl * (1 + l.taxRate / 100);
    }, 0);
}
