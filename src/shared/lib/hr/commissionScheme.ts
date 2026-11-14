import { CUSTOMER_SALE_VOUCHER_TYPES } from "@/shared/lib/constants/accounting";

// Targets & Commission — the shape of a scheme and the ONE arithmetic that turns
// a month's sales into money.
//
// Owner, 2026-09-22: *"earnings, commission, target, etc. need a page to
// set/edit. user need to see it to get motivated."* and *"global commission,
// user wise off/on and override, multiple target/commission type same time."*
//
// A person is judged by a LIST OF RULES paid together — one per commission
// HEAD that reaches them (modules/hr/lib/commissionServer.ts resolves which).
// Each rule is one way of earning and carries its own target where it needs
// one, so "1% on everything, ₹500 at ₹60,000 and ₹1,500 at ₹1,00,000" is three
// heads. Three screens read this file — the board, the card on My Info, and
// the payroll run — so the sums are written once, here, with no server import.
//
// Money is paise (Int). A rate is basis points: 100 bp = 1%.

export const COMMISSION_KINDS = ["PERCENT", "ABOVE_TARGET", "SLABS", "BONUS", "MANUAL"] as const;
export type CommissionKind = (typeof COMMISSION_KINDS)[number];

export const COMMISSION_KIND_LABELS: Record<CommissionKind, string> = {
    PERCENT:      "A share of every sale",
    ABOVE_TARGET: "A share of sales above a target",
    SLABS:        "Slabs — the rate depends on how much was sold",
    BONUS:        "A flat bonus on reaching a target",
    MANUAL:       "Manual count — things the app cannot see, typed in by HR",
};

/** One slab: the rate that applies to sales from this rupee upward, until the next slab starts. */
export interface CommissionSlab {
    fromPaise: number;
    rateBp: number;
}

/** One way of earning. Fields a kind does not use are 0 / empty. */
export interface CommissionRule {
    kind: CommissionKind;
    /** ABOVE_TARGET: the line; BONUS: the line. 0 elsewhere. */
    targetPaise: number;
    /** PERCENT / ABOVE_TARGET. */
    rateBp: number;
    /** SLABS. */
    slabs: CommissionSlab[];
    /** BONUS / MANUAL: the flat amount at the target. */
    bonusPaise: number;
    /** MANUAL: what is counted — "customers", "visits", "posts". */
    unit?: string;
    /** MANUAL: how many a month. 0 = no target, only the per-unit pay. */
    targetCount?: number;
    /** MANUAL: paid for each unit. */
    perUnitPaise?: number;
    /**
     * MANUAL: the month's count as resolved by the server from the entries —
     * the arithmetic's input, set on the applied rule, never stored on a head.
     */
    count?: number;
    /** The head's name, when the rule came from one — the card and the slip say it. */
    label?: string;
}

/** What one scheme says — its rules. The wire and storage shape, minus the row's own ids. */
export interface CommissionSchemeTerms {
    rules: CommissionRule[];
}

/** The sale voucher kinds a person's commission counts, and the one that takes back. */
export const COMMISSION_SALE_TYPES = CUSTOMER_SALE_VOUCHER_TYPES;
export const COMMISSION_RETURN_TYPES = ["SALE_RETURN"] as const;

export function isCommissionKind(v: unknown): v is CommissionKind {
    return typeof v === "string" && (COMMISSION_KINDS as readonly string[]).includes(v);
}

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0; };

/** `slabsJson` / a rule's slabs come from JSON; read defensively, sorted ascending. */
export function parseSlabs(raw: unknown): CommissionSlab[] {
    if (!Array.isArray(raw)) return [];
    const out: CommissionSlab[] = [];
    for (const s of raw) {
        if (!s || typeof s !== "object") continue;
        out.push({ fromPaise: num((s as { fromPaise?: unknown }).fromPaise), rateBp: num((s as { rateBp?: unknown }).rateBp) });
    }
    return out.sort((a, b) => a.fromPaise - b.fromPaise);
}

/** "1%", "1.5%", "0.25%" — never "1.50%". */
export const formatBp = (bp: number) => `${Number((bp / 100).toFixed(2))}%`;

export interface RuleOutcome {
    rule: CommissionRule;
    /** What this rule paid on these sales. */
    paise: number;
    /** The rule's target, scaled — 0 when the kind has none. */
    targetPaise: number;
    targetMet: boolean;
    /** MANUAL only: the month's count, and the (scaled) target count. */
    count?: number;
    targetCount?: number;
}

export interface CommissionOutcome {
    /** Everything the rules paid, summed — what goes on the payslip. */
    totalPaise: number;
    /** Rule by rule, in scheme order. */
    rules: RuleOutcome[];
    /** The highest target among the rules — the bar's far end. 0 when none. */
    topTargetPaise: number;
    /** Sales as a share of the top target. Null when there is no target. */
    achieved: number | null;
    /** Every targeted rule reached. False when there is no target at all. */
    targetMet: boolean;
    /** The nearest target still ahead, or null when all are met / none exist. */
    nextTargetPaise: number | null;
}

/**
 * The money a month's sales are worth under a scheme.
 *
 * `scale` shrinks every target to the share of the month a payroll period
 * covers (10 days of a 30-day month → 1/3); a whole month passes 1.
 */
export function computeCommission(terms: CommissionSchemeTerms, salesPaise: number, scale = 1): CommissionOutcome {
    const sales = Math.max(0, salesPaise);
    const rules: RuleOutcome[] = terms.rules.map((rule) => {
        const target = rule.kind === "ABOVE_TARGET" || rule.kind === "BONUS" ? Math.round(rule.targetPaise * scale) : 0;
        let paise = 0;
        switch (rule.kind) {
            case "PERCENT":
                paise = (sales * rule.rateBp) / 10_000;
                break;
            case "ABOVE_TARGET":
                paise = (Math.max(0, sales - target) * rule.rateBp) / 10_000;
                break;
            case "SLABS": {
                // Direct match — owner, 2026-09-23: "don't sum different slab i
                // want direct match". The slab the month's total lands in sets
                // the rate for the WHOLE amount: slabs ascend, and the last one
                // whose line is not above the sales is the one that applies.
                let rate = 0;
                for (const slab of rule.slabs) if (sales >= slab.fromPaise) rate = slab.rateBp;
                paise = (sales * rate) / 10_000;
                break;
            }
            case "BONUS":
                paise = target > 0 && sales >= target ? rule.bonusPaise : 0;
                break;
            case "MANUAL": {
                // Judged on the entries' count, not on sales: so much per unit,
                // and the bonus once the (scaled) target count is reached.
                const count = rule.count ?? 0;
                const targetCount = Math.round((rule.targetCount ?? 0) * scale);
                const met = targetCount > 0 && count >= targetCount;
                paise = count * (rule.perUnitPaise ?? 0) + (met ? rule.bonusPaise : 0);
                return { rule, paise: Math.round(paise), targetPaise: 0, targetMet: met, count, targetCount };
            }
        }
        return { rule, paise: Math.round(paise), targetPaise: target, targetMet: target > 0 && sales >= target };
    });
    const targets = rules.map((r) => r.targetPaise).filter((t) => t > 0);
    const top = targets.length ? Math.max(...targets) : 0;
    const ahead = targets.filter((t) => sales < t);
    return {
        totalPaise: rules.reduce((a, r) => a + r.paise, 0),
        rules,
        topTargetPaise: top,
        achieved: top > 0 ? sales / top : null,
        targetMet: top > 0 && ahead.length === 0,
        nextTargetPaise: ahead.length ? Math.min(...ahead) : null,
    };
}

/** One rule in a plain phrase. */
export function describeRule(r: CommissionRule, formatPaise: (p: number) => string): string {
    switch (r.kind) {
        case "PERCENT":      return `${formatBp(r.rateBp)} of every sale`;
        case "ABOVE_TARGET": return `${formatBp(r.rateBp)} of sales above ${formatPaise(r.targetPaise)}`;
        case "BONUS":        return `${formatPaise(r.bonusPaise)} bonus at ${formatPaise(r.targetPaise)}`;
        case "MANUAL": {
            const unit = r.unit || "units";
            const parts: string[] = [];
            if (r.perUnitPaise) parts.push(`${formatPaise(r.perUnitPaise)} per ${singular(unit)}`);
            if (r.targetCount && r.bonusPaise) parts.push(`${formatPaise(r.bonusPaise)} bonus at ${r.targetCount} ${unit}`);
            else if (r.targetCount) parts.push(`target ${r.targetCount} ${unit}`);
            return parts.join(" · ") || `counted in ${unit}`;
        }
        case "SLABS":
            return r.slabs.map((s, i) => {
                const next = r.slabs[i + 1];
                if (!next) return `${formatBp(s.rateBp)} when sales reach ${formatPaise(s.fromPaise)}`;
                if (s.fromPaise === 0) return `${formatBp(s.rateBp)} when sales are below ${formatPaise(next.fromPaise)}`;
                return `${formatBp(s.rateBp)} when sales are ${formatPaise(s.fromPaise)}–${formatPaise(next.fromPaise)}`;
            }).join(", ") || "slabs not set";
    }
}

/** "customers" → "customer", "posts" → "post"; a word not ending in s is left alone. */
const singular = (unit: string) => (unit.length > 3 && unit.endsWith("s") ? unit.slice(0, -1) : unit);
