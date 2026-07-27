// Unit chains — "1 KM = 1000 M", "1 M = 100 CM".
//
// Each unit names its IMMEDIATE parent and how many of that parent it holds.
// Chains may be any depth: KM → M → CM. The chain's root (a unit with no
// parent) is the BASE unit, and quantities are ALWAYS stored in it — one
// integer on InvProduct.stock / InvStockLedger. Everything here is a lens over
// that integer; nothing converts stored data.
//
// A unit's true size is the PRODUCT of its chain: KM = 1000 × 100 = 100,000 CM.
// Two units are "related" (interchangeable on a voucher line) when they share
// a root — that is what makes G, KG and TONNE mutually selectable.

export type UnitRow = {
    id:                number;
    code:              string;
    baseUnitId?:       number | null;
    conversionFactor?: number | null;
};

/** One rung of a chain: how many BASE units make one of `code`. */
export type UnitTier = { code: string; factor: number };

/** Chains deeper than this are refused — a real unit chain is 2-4 rungs. */
export const MAX_UNIT_CHAIN_DEPTH = 8;

const indexOf = (all: Iterable<UnitRow>): Map<number, UnitRow> => {
    const m = new Map<number, UnitRow>();
    for (const u of all) m.set(u.id, u);
    return m;
};

/**
 * Walk a unit to its root, returning every rung with its factor expressed in
 * BASE units — largest first. KM in a KM→M→CM chain yields:
 *   [{ KM, 100000 }, { M, 100 }, { CM, 1 }]
 *
 * Cycles and over-deep chains stop the walk rather than hang; the tiers found
 * so far are still returned, so a misconfigured master degrades to a plainer
 * rendering instead of breaking the page.
 */
export function unitTiers(unitId: number, all: Iterable<UnitRow>): UnitTier[] {
    const idx = indexOf(all);
    const chain: UnitRow[] = [];
    const seen = new Set<number>();

    let cur = idx.get(unitId);
    while (cur && !seen.has(cur.id) && chain.length < MAX_UNIT_CHAIN_DEPTH) {
        seen.add(cur.id);
        chain.push(cur);
        if (cur.baseUnitId == null || !(cur.conversionFactor && cur.conversionFactor > 1)) break;
        cur = idx.get(cur.baseUnitId);
    }
    if (chain.length === 0) return [];

    // Walk back up from the root multiplying factors: the root is 1 base unit,
    // its child is `factor` base units, and so on.
    const tiers: UnitTier[] = [];
    let factor = 1;
    for (let i = chain.length - 1; i >= 0; i -= 1) {
        const rung = chain[i];
        if (i < chain.length - 1) {
            // `rung` sits above chain[i+1]; its own conversionFactor counts how
            // many of that child it holds.
            factor *= rung.conversionFactor ?? 1;
        }
        tiers.unshift({ code: rung.code, factor });
    }
    return tiers;
}

/** BASE units in one of `unitId` — the product of its whole chain. */
export function baseUnitsPer(unitId: number, all: Iterable<UnitRow>): number {
    return unitTiers(unitId, all)[0]?.factor ?? 1;
}

/** Every unit sharing a root with `unitId` — the set offerable on a line. */
export function relatedUnits(unitId: number, all: Iterable<UnitRow>): UnitRow[] {
    const rows = [...all];
    const rootOf = (id: number): number => {
        const t = unitTiers(id, rows);
        return t.length ? (rows.find((r) => r.code === t[t.length - 1].code)?.id ?? id) : id;
    };
    const target = rootOf(unitId);
    return rows.filter((r) => rootOf(r.id) === target);
}

/**
 * Render a BASE-unit quantity across a unit's tiers, largest first:
 *   1,015,005 CM on a KM→M→CM chain → "10 KM 150 M 5 CM"
 *   5,000 with G→KG                 → "5 KG"
 *   9                                → "9 G"
 *
 * Tiers that contribute nothing are dropped, so exact multiples stay clean.
 * Negative stock (goods sold before their purchase was entered) splits on the
 * absolute value and carries one leading sign — "-4 DOZ 6 NOS", never
 * "-4 DOZ -6 NOS".
 */
export function formatQtyInTiers(baseQty: number, tiers: UnitTier[]): string {
    if (tiers.length === 0) return String(baseQty);

    const negative = baseQty < 0;
    let rest = Math.abs(baseQty);
    const parts: string[] = [];

    for (const tier of tiers) {
        const n = Math.floor(rest / tier.factor);
        if (n > 0) {
            parts.push(`${n} ${tier.code}`);
            rest -= n * tier.factor;
        }
    }
    // Nothing landed (qty 0, or smaller than the finest tier) — show the base.
    if (parts.length === 0) return `${baseQty} ${tiers[tiers.length - 1].code}`;

    return `${negative ? "-" : ""}${parts.join(" ")}`;
}

/** Convenience for callers holding the raw unit list. */
export function formatQtyInUnit(baseQty: number, unitId: number, all: Iterable<UnitRow>): string {
    return formatQtyInTiers(baseQty, unitTiers(unitId, all));
}
