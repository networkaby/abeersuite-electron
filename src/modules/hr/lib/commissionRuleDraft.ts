// The head form's draft: the boxes as typed, and the rule they come to (or the
// sentence saying why they do not yet). Client-safe, no server import.

import { paiseToRupees, parseRupeesToPaise } from "@/shared/lib/format/moneyInr";
import type { CommissionKind, CommissionRule, CommissionSlab } from "@/shared/lib/hr/commissionScheme";

export type SlabDraft = { from: string; rate: string };
export type RuleDraft = { kind: CommissionKind; target: string; rate: string; bonus: string; slabs: SlabDraft[]; unit: string; targetCount: string; perUnit: string };

const rupees = (paise: number) => (paise ? String(paiseToRupees(paise)) : "");
const pct = (bp: number) => (bp ? String(Number((bp / 100).toFixed(2))) : "");
export const toBp = (s: string) => { const n = Number(s); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null; };
const toPaise = (s: string) => (s.trim() === "" ? 0 : parseRupeesToPaise(s));

export const blankRule = (kind: CommissionKind = "PERCENT"): RuleDraft => ({ kind, target: "", rate: "", bonus: "", slabs: [{ from: "0", rate: "" }, { from: "", rate: "" }], unit: "", targetCount: "", perUnit: "" });
export const toDraft = (r: CommissionRule): RuleDraft => ({
    kind: r.kind, target: rupees(r.targetPaise), rate: pct(r.rateBp), bonus: rupees(r.bonusPaise),
    unit: r.unit ?? "", targetCount: r.targetCount ? String(r.targetCount) : "", perUnit: rupees(r.perUnitPaise ?? 0),
    // A slab may honestly start at ₹0, so the from box is never blanked the way an unset target is.
    slabs: r.slabs.length ? r.slabs.map((s) => ({ from: String(paiseToRupees(s.fromPaise)), rate: pct(s.rateBp) })) : blankRule().slabs,
});

/** A draft rule → the rule, or the sentence that says why it is not one yet. */
export function parseRule(d: RuleDraft): { rule: CommissionRule; bad: string | null } {
    const target = toPaise(d.target), bonus = toPaise(d.bonus), rate = d.rate.trim() === "" ? 0 : toBp(d.rate);
    let bad: string | null = null;
    if (target == null) bad = "The target is not a rupee figure";
    else if (bonus == null) bad = "The bonus is not a rupee figure";
    else if (rate == null || rate > 10_000) bad = "The rate must be between 0 and 100";
    else if ((d.kind === "PERCENT" || d.kind === "ABOVE_TARGET") && rate <= 0) bad = "Enter the rate";
    else if ((d.kind === "ABOVE_TARGET" || d.kind === "BONUS") && target <= 0) bad = "Enter the target";
    else if (d.kind === "BONUS" && bonus <= 0) bad = "Enter the bonus";
    const perUnit = toPaise(d.perUnit);
    const targetCount = d.targetCount.trim() === "" ? 0 : Number(d.targetCount);
    if (d.kind === "MANUAL") {
        if (!d.unit.trim()) bad ??= "Say what is counted (customers, visits, posts)";
        else if (perUnit == null) bad ??= "The pay per unit is not a rupee figure";
        else if (!Number.isInteger(targetCount) || targetCount < 0) bad ??= "The target count must be a whole number";
        else if (perUnit <= 0 && !(targetCount > 0 && (bonus ?? 0) > 0)) bad ??= "Pay per unit, or a bonus at a target count";
    }
    const slabs: CommissionSlab[] = [];
    if (d.kind === "SLABS") {
        // The ladder always starts at ₹0, so every rupee lands in some slab.
        for (const [i, s] of d.slabs.entries()) {
            const fromPaise = i === 0 ? 0 : s.from.trim() === "" ? null : parseRupeesToPaise(s.from);
            const rateBp = s.rate.trim() === "" ? null : toBp(s.rate);
            if (fromPaise == null || rateBp == null || rateBp > 10_000) { bad ??= "Every slab needs a starting amount and a rate"; continue; }
            slabs.push({ fromPaise, rateBp });
        }
        if (!slabs.length) bad ??= "Add at least one slab";
        for (let i = 1; i < slabs.length; i++) if (slabs[i].fromPaise <= slabs[i - 1].fromPaise) { bad ??= "Each slab must start above the one before"; break; }
    }
    return {
        rule: {
            kind: d.kind,
            targetPaise: d.kind === "ABOVE_TARGET" || d.kind === "BONUS" ? target ?? 0 : 0,
            rateBp: d.kind === "PERCENT" || d.kind === "ABOVE_TARGET" ? rate ?? 0 : 0,
            slabs: d.kind === "SLABS" ? slabs : [],
            bonusPaise: d.kind === "BONUS" || d.kind === "MANUAL" ? bonus ?? 0 : 0,
            ...(d.kind === "MANUAL" ? { unit: d.unit.trim(), targetCount: Number.isInteger(targetCount) && targetCount > 0 ? targetCount : 0, perUnitPaise: perUnit ?? 0 } : {}),
        },
        bad,
    };
}
