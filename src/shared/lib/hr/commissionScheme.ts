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

export const COMMISSION_KINDS = ["PERCENT", "ABOVE_TARGET", "SLABS", "BONUS"] as const;
export type CommissionKind = (typeof COMMISSION_KINDS)[number];

export const COMMISSION_KIND_LABELS: Record<CommissionKind, string> = {
    PERCENT:      "A share of every sale",
    ABOVE_TARGET: "A share of sales above a target",
    SLABS:        "Slabs — the rate steps up as sales grow",
    BONUS:        "A flat bonus on reaching a target",
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
    /** BONUS. */
    bonusPaise: number;
    /** The head's name, when the rule came from one — the card and the slip say it. */
    label?: string;
}

/** What one scheme says — its rules. The wire and storage shape, minus the row's own ids. */
export interface CommissionSchemeTerms {
    rules: CommissionRule[];
}

/** The sale voucher kinds a person's commission counts, and the one that takes back. */
export const COMMISSION_SALE_TYPES = ["SALE", "POS", "ONLINE_INVOICE"] as const;
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

/** `rulesJson` from the database; a rule of an unknown kind is dropped, not guessed at. */
export function parseRules(raw: unknown): CommissionRule[] {
    if (!Array.isArray(raw)) return [];
    const out: CommissionRule[] = [];
    for (const r of raw) {
        if (!r || typeof r !== "object") continue;
        const o = r as Record<string, unknown>;
        if (!isCommissionKind(o.kind)) continue;
        out.push({ kind: o.kind, targetPaise: num(o.targetPaise), rateBp: num(o.rateBp), slabs: parseSlabs(o.slabs), bonusPaise: num(o.bonusPaise), ...(typeof o.label === "string" ? { label: o.label } : {}) });
    }
    return out;
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
                // Marginal: each slab's rate is paid on the sales that fall inside
                // it, the way tax slabs work, so crossing a line never loses money.
                const slabs = rule.slabs;
                for (let i = 0; i < slabs.length; i++) {
                    const lo = slabs[i].fromPaise;
                    const hi = i + 1 < slabs.length ? slabs[i + 1].fromPaise : Infinity;
                    if (sales <= lo) break;
                    paise += ((Math.min(sales, hi) - lo) * slabs[i].rateBp) / 10_000;
                }
                break;
            }
            case "BONUS":
                paise = target > 0 && sales >= target ? rule.bonusPaise : 0;
                break;
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
        case "SLABS":
            return r.slabs.map((s, i) => {
                const next = r.slabs[i + 1];
                if (!next) return `${formatBp(s.rateBp)} above ${formatPaise(s.fromPaise)}`;
                if (s.fromPaise === 0) return `${formatBp(s.rateBp)} up to ${formatPaise(next.fromPaise)}`;
                return `${formatBp(s.rateBp)} on ${formatPaise(s.fromPaise)}–${formatPaise(next.fromPaise)}`;
            }).join(", ") || "slabs not set";
    }
}

/** The scheme in one sentence, for the board row and the person's card. */
export function describeScheme(terms: CommissionSchemeTerms, formatPaise: (p: number) => string): string {
    return terms.rules.length ? terms.rules.map((r) => describeRule(r, formatPaise)).join(" · ") : "Nothing set";
}
