// Targets & Commission — the shape of a scheme and the ONE arithmetic that turns
// a month's sales into money.
//
// Owner, 2026-09-22: *"earnings, commission, target, etc. need a page to
// set/edit. user need to see it to get motivated."* Three screens read this
// file — the board where HR sets a scheme, the card on My Info where the person
// watches his own month, and the payroll run that freezes the answer — so the
// sums are written once, here, with no server import, and every screen quotes
// the same rupee.
//
// Money is paise (Int). A rate is basis points: 100 bp = 1%.

export const COMMISSION_KINDS = ["NONE", "PERCENT", "ABOVE_TARGET", "SLABS"] as const;
export type CommissionKind = (typeof COMMISSION_KINDS)[number];

export const COMMISSION_KIND_LABELS: Record<CommissionKind, string> = {
    NONE:         "Target only — no commission on sales",
    PERCENT:      "A share of every sale",
    ABOVE_TARGET: "A share of sales above the target",
    SLABS:        "Slabs — the rate steps up as sales grow",
};

/** One slab: the rate that applies to sales from this rupee upward, until the next slab starts. */
export interface CommissionSlab {
    fromPaise: number;
    rateBp: number;
}

/** What one scheme says. The wire and storage shape, minus the row's own ids. */
export interface CommissionSchemeTerms {
    targetPaise: number;
    kind: CommissionKind;
    rateBp: number;
    slabs: CommissionSlab[];
    bonusPaise: number;
}

/** The sale voucher kinds a person's commission counts, and the one that takes back. */
export const COMMISSION_SALE_TYPES = ["SALE", "POS", "ONLINE_INVOICE"] as const;
export const COMMISSION_RETURN_TYPES = ["SALE_RETURN"] as const;

/** `slabsJson` comes back from the database as unknown; read it defensively. */
export function parseSlabs(raw: unknown): CommissionSlab[] {
    if (!Array.isArray(raw)) return [];
    const out: CommissionSlab[] = [];
    for (const s of raw) {
        if (!s || typeof s !== "object") continue;
        const from = Number((s as { fromPaise?: unknown }).fromPaise);
        const rate = Number((s as { rateBp?: unknown }).rateBp);
        if (!Number.isFinite(from) || !Number.isFinite(rate) || from < 0 || rate < 0) continue;
        out.push({ fromPaise: Math.round(from), rateBp: Math.round(rate) });
    }
    return out.sort((a, b) => a.fromPaise - b.fromPaise);
}

export function isCommissionKind(v: unknown): v is CommissionKind {
    return typeof v === "string" && (COMMISSION_KINDS as readonly string[]).includes(v);
}

/** "1%", "1.5%", "0.25%" — never "1.50%". */
export const formatBp = (bp: number) => `${Number((bp / 100).toFixed(2))}%`;

export interface CommissionOutcome {
    /** Commission on the sales themselves, before any bonus. */
    onSalesPaise: number;
    /** The flat bonus, only when the target was reached (and one is set). */
    bonusPaise: number;
    /** onSales + bonus — what goes on the payslip. */
    totalPaise: number;
    /** Sales as a share of the target, 0..∞. Null when there is no target. */
    achieved: number | null;
    targetMet: boolean;
}

/**
 * The money a month's sales are worth under a scheme.
 *
 * `targetPaise` is passed separately so a payroll period covering part of a
 * month can hand in the target scaled to the days it covers; a whole month
 * passes the scheme's own target.
 */
export function computeCommission(terms: CommissionSchemeTerms, salesPaise: number, targetPaise = terms.targetPaise): CommissionOutcome {
    const sales = Math.max(0, salesPaise);
    let onSales = 0;
    switch (terms.kind) {
        case "PERCENT":
            onSales = (sales * terms.rateBp) / 10_000;
            break;
        case "ABOVE_TARGET":
            onSales = (Math.max(0, sales - targetPaise) * terms.rateBp) / 10_000;
            break;
        case "SLABS": {
            // Marginal: each slab's rate is paid on the sales that fall inside it,
            // the way income tax slabs work. A flat "whole amount at the top rate"
            // would make the first rupee past a boundary worth a jump in pay,
            // which is a fight at the counter, not a target.
            const slabs = terms.slabs;
            for (let i = 0; i < slabs.length; i++) {
                const lo = slabs[i].fromPaise;
                const hi = i + 1 < slabs.length ? slabs[i + 1].fromPaise : Infinity;
                if (sales <= lo) break;
                onSales += ((Math.min(sales, hi) - lo) * slabs[i].rateBp) / 10_000;
            }
            break;
        }
        case "NONE":
        default:
            break;
    }
    const targetMet = targetPaise > 0 && sales >= targetPaise;
    const bonus = targetMet ? terms.bonusPaise : 0;
    const onSalesPaise = Math.round(onSales);
    return {
        onSalesPaise,
        bonusPaise: bonus,
        totalPaise: onSalesPaise + bonus,
        achieved: targetPaise > 0 ? sales / targetPaise : null,
        targetMet,
    };
}

/** The scheme in one plain sentence, for the board row and the person's card. */
export function describeScheme(terms: CommissionSchemeTerms, formatPaise: (p: number) => string): string {
    const parts: string[] = [];
    switch (terms.kind) {
        case "PERCENT":
            parts.push(`${formatBp(terms.rateBp)} of every sale`);
            break;
        case "ABOVE_TARGET":
            parts.push(`${formatBp(terms.rateBp)} of sales above the target`);
            break;
        case "SLABS":
            parts.push(terms.slabs.map((s, i) => {
                const next = terms.slabs[i + 1];
                const range = next ? `${formatPaise(s.fromPaise)}–${formatPaise(next.fromPaise)}` : `above ${formatPaise(s.fromPaise)}`;
                return `${formatBp(s.rateBp)} on ${range}`;
            }).join(", ") || "slabs not set");
            break;
        default:
            break;
    }
    if (terms.bonusPaise > 0 && terms.targetPaise > 0) parts.push(`${formatPaise(terms.bonusPaise)} bonus on reaching the target`);
    if (!parts.length) return terms.targetPaise > 0 ? "Target only" : "Nothing set";
    return parts.join(" · ");
}
