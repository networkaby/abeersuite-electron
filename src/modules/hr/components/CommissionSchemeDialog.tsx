"use client";

// New target & commission scheme — for the shop (userId null) or one person.
// An effective date and a list of rules paid together: a share of every sale,
// a share above a target, slabs, a bonus at a target — each with its own
// target, as many as wanted. Starts from the scheme being replaced so raising
// one target is one number changed. The worked example at the bottom quotes
// the very arithmetic payroll will run.

import { useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field } from "@/shared/components/Field";
import { NumericInput } from "@/shared/components/NumericInput";
import { TallyDateInput } from "@/shared/components/TallyDateInput";
import { extractApiError } from "@/shared/lib/api/extractApiError";
import { todayIso } from "@/shared/lib/format/formatDate";
import { formatRupeesFromPaise, paiseToRupees, parseRupeesToPaise } from "@/shared/lib/format/moneyInr";
import {
    COMMISSION_KINDS, COMMISSION_KIND_LABELS, computeCommission, describeRule,
    type CommissionKind, type CommissionRule, type CommissionSlab,
} from "@/shared/lib/hr/commissionScheme";
import type { CommissionSchemeDto } from "../lib/commissionTypes";

type SlabDraft = { from: string; rate: string };
type RuleDraft = { kind: CommissionKind; target: string; rate: string; bonus: string; slabs: SlabDraft[] };

const rupees = (paise: number) => (paise ? String(paiseToRupees(paise)) : "");
const pct = (bp: number) => (bp ? String(Number((bp / 100).toFixed(2))) : "");
const toBp = (s: string) => { const n = Number(s); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null; };
const toPaise = (s: string) => (s.trim() === "" ? 0 : parseRupeesToPaise(s));

const blankRule = (kind: CommissionKind = "PERCENT"): RuleDraft => ({ kind, target: "", rate: "", bonus: "", slabs: [{ from: "0", rate: "" }, { from: "", rate: "" }] });
const toDraft = (r: CommissionRule): RuleDraft => ({
    kind: r.kind, target: rupees(r.targetPaise), rate: pct(r.rateBp), bonus: rupees(r.bonusPaise),
    // A slab may honestly start at ₹0, so the from box is never blanked the way an unset target is.
    slabs: r.slabs.length ? r.slabs.map((s) => ({ from: String(paiseToRupees(s.fromPaise)), rate: pct(s.rateBp) })) : blankRule().slabs,
});

/** A draft rule → the rule, or the sentence that says why it is not one yet. */
function parseRule(d: RuleDraft): { rule: CommissionRule; bad: string | null } {
    const target = toPaise(d.target), bonus = toPaise(d.bonus), rate = d.rate.trim() === "" ? 0 : toBp(d.rate);
    let bad: string | null = null;
    if (target == null) bad = "The target is not a rupee figure";
    else if (bonus == null) bad = "The bonus is not a rupee figure";
    else if (rate == null || rate > 10_000) bad = "The rate must be between 0 and 100";
    else if ((d.kind === "PERCENT" || d.kind === "ABOVE_TARGET") && rate <= 0) bad = "Enter the rate";
    else if ((d.kind === "ABOVE_TARGET" || d.kind === "BONUS") && target <= 0) bad = "Enter the target";
    else if (d.kind === "BONUS" && bonus <= 0) bad = "Enter the bonus";
    const slabs: CommissionSlab[] = [];
    if (d.kind === "SLABS") {
        for (const s of d.slabs) {
            const fromPaise = s.from.trim() === "" ? null : parseRupeesToPaise(s.from);
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
            bonusPaise: d.kind === "BONUS" ? bonus ?? 0 : 0,
        },
        bad,
    };
}

export default function CommissionSchemeDialog({ userId, name, startFrom, onClose, onSaved }: {
    /** Null = the shop's global scheme. */
    userId: number | null;
    name: string;
    startFrom: CommissionSchemeDto | null;
    onClose: () => void;
    onSaved: () => void;
}) {
    const [effectiveFrom, setEffectiveFrom] = useState(todayIso());
    const [rules, setRules] = useState<RuleDraft[]>(() => (startFrom?.rules.length ? startFrom.rules.map(toDraft) : [blankRule()]));
    const [note, setNote] = useState("");
    const [saving, setSaving] = useState(false);

    const parsed = useMemo(() => rules.map(parseRule), [rules]);
    const bad = parsed.find((p) => p.bad)?.bad ?? null;
    const terms = useMemo(() => ({ rules: parsed.map((p) => p.rule) }), [parsed]);
    const canSave = !saving && !bad && rules.length > 0 && !!effectiveFrom;

    // The example: at the top target, and a fifth past it — or a round lakh
    // when no rule has a target — the moments the person will actually ask about.
    const example = useMemo(() => {
        const targets = terms.rules.map((r) => r.targetPaise).filter((t) => t > 0);
        const base = targets.length ? Math.max(...targets) : 100_000_00;
        return [base, Math.round(base * 1.2)].map((sales) => ({ sales, outcome: computeCommission(terms, sales) }));
    }, [terms]);

    const setRule = (i: number, patch: Partial<RuleDraft>) => setRules((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    const setSlab = (i: number, k: number, patch: Partial<SlabDraft>) =>
        setRules((rs) => rs.map((r, j) => (j === i ? { ...r, slabs: r.slabs.map((s, l) => (l === k ? { ...s, ...patch } : s)) } : r)));

    const submit = async () => {
        setSaving(true);
        try {
            await axios.post("/api/hr/commission", { userId, effectiveFrom, rules: terms.rules, note: note.trim() || null });
            toast.success("Scheme saved");
            onSaved();
        } catch (e) {
            toast.error(extractApiError(e, "Could not save the scheme"));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open onOpenChange={(o) => !o && onClose()}>
            <DialogContent className="max-h-[90vh] max-w-2xl overflow-x-hidden overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{userId === null ? "Shop scheme — everyone on it" : `Target & commission — ${name}`}</DialogTitle>
                    <DialogDescription>
                        Rules are paid together: add one for each way of earning. A person&apos;s own bills are what count. Payroll pays the total as a &quot;Commission&quot; line.
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Applies from" required>
                        {(id) => <TallyDateInput id={id} value={effectiveFrom} onValueChange={setEffectiveFrom} />}
                    </Field>
                    <Field label="Note">
                        {(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Why this changed (optional)" />}
                    </Field>
                </div>

                <div className="space-y-2">
                    {rules.map((r, i) => (
                        <div key={i} className="rounded-lg border border-border p-3">
                            <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-start">
                                <Select value={r.kind} onValueChange={(v) => setRule(i, { kind: v as CommissionKind })}>
                                    <SelectTrigger className="h-9 w-full text-sm" aria-label={`Rule ${i + 1} kind`}><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        {COMMISSION_KINDS.map((k) => <SelectItem key={k} value={k}>{COMMISSION_KIND_LABELS[k]}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                                <Button type="button" variant="ghost" size="icon" aria-label="Remove rule" disabled={rules.length <= 1}
                                    onClick={() => setRules((rs) => rs.filter((_, j) => j !== i))}>
                                    <X size={14} />
                                </Button>
                            </div>
                            <div className="mt-2 grid gap-2 sm:grid-cols-3">
                                {(r.kind === "ABOVE_TARGET" || r.kind === "BONUS") && (
                                    <Field label="Monthly target (₹)" required>
                                        {(id) => <NumericInput id={id} mode="decimal" value={r.target} onValueChange={(v) => setRule(i, { target: v })} placeholder="e.g. 3,00,000" />}
                                    </Field>
                                )}
                                {(r.kind === "PERCENT" || r.kind === "ABOVE_TARGET") && (
                                    <Field label="Rate (%)" required hint={r.kind === "PERCENT" ? "On every rupee sold" : "Only on the rupees past the target"}>
                                        {(id) => <NumericInput id={id} mode="decimal" value={r.rate} onValueChange={(v) => setRule(i, { rate: v })} placeholder="e.g. 1.5" />}
                                    </Field>
                                )}
                                {r.kind === "BONUS" && (
                                    <Field label="Bonus (₹)" required hint="A flat amount the month the target is met">
                                        {(id) => <NumericInput id={id} mode="decimal" value={r.bonus} onValueChange={(v) => setRule(i, { bonus: v })} placeholder="e.g. 1,000" />}
                                    </Field>
                                )}
                            </div>
                            {r.kind === "SLABS" && (
                                <div className="mt-2 space-y-2">
                                    <div className="text-xs text-muted-foreground">
                                        Each slab&apos;s rate is paid on the sales inside it — like tax slabs, so crossing a line never loses money.
                                    </div>
                                    {r.slabs.map((s, k) => (
                                        <div key={k} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
                                            <NumericInput mode="decimal" value={s.from} onValueChange={(v) => setSlab(i, k, { from: v })} placeholder={k === 0 ? "from ₹0" : "from ₹"} aria-label="Slab from" />
                                            <NumericInput mode="decimal" value={s.rate} onValueChange={(v) => setSlab(i, k, { rate: v })} placeholder="rate %" aria-label="Slab rate" />
                                            <Button type="button" variant="ghost" size="icon" aria-label="Remove slab" disabled={r.slabs.length <= 1}
                                                onClick={() => setRule(i, { slabs: r.slabs.filter((_, l) => l !== k) })}>
                                                <X size={14} />
                                            </Button>
                                        </div>
                                    ))}
                                    <Button type="button" variant="outline" size="sm" disabled={r.slabs.length >= 10}
                                        onClick={() => setRule(i, { slabs: [...r.slabs, { from: "", rate: "" }] })}>
                                        <Plus size={14} /> Add slab
                                    </Button>
                                </div>
                            )}
                        </div>
                    ))}
                    <Button type="button" variant="outline" size="sm" disabled={rules.length >= 10} onClick={() => setRules((rs) => [...rs, blankRule("BONUS")])}>
                        <Plus size={14} /> Add rule
                    </Button>
                </div>

                <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
                    <ul className="space-y-0.5">
                        {parsed.map((p, i) => (
                            <li key={i} className={p.bad ? "text-destructive" : "font-medium"}>{p.bad ?? describeRule(p.rule, formatRupeesFromPaise)}</li>
                        ))}
                    </ul>
                    {!bad && (
                        <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                            {example.map(({ sales, outcome }) => (
                                <li key={sales}>
                                    Sells {formatRupeesFromPaise(sales)} in a month → earns <span className="font-medium text-foreground">{formatRupeesFromPaise(outcome.totalPaise)}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>

                <DialogFooter>
                    <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
                    <Button type="button" onClick={submit} disabled={!canSave}>{saving ? "Saving…" : "Save scheme"}</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
