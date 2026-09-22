"use client";

// New target & commission scheme for one person — an effective date, a monthly
// target, and how sales turn into money. Starts from the scheme being replaced
// so raising a target is one number changed, not a form retyped. The worked
// example at the bottom quotes the very arithmetic payroll will run.

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
    COMMISSION_KINDS, COMMISSION_KIND_LABELS, computeCommission, describeScheme,
    type CommissionKind, type CommissionSchemeTerms, type CommissionSlab,
} from "@/shared/lib/hr/commissionScheme";
import type { CommissionSchemeDto } from "../lib/commissionTypes";

type SlabDraft = { from: string; rate: string };

const rupees = (paise: number) => (paise ? String(paiseToRupees(paise)) : "");
const pct = (bp: number) => (bp ? String(Number((bp / 100).toFixed(2))) : "");
const toBp = (s: string) => { const n = Number(s); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null; };

export default function CommissionSchemeDialog({ userId, name, startFrom, onClose, onSaved }: {
    userId: number;
    name: string;
    startFrom: CommissionSchemeDto | null;
    onClose: () => void;
    onSaved: () => void;
}) {
    const [effectiveFrom, setEffectiveFrom] = useState(todayIso());
    const [target, setTarget] = useState(rupees(startFrom?.targetPaise ?? 0));
    const [kind, setKind] = useState<CommissionKind>(startFrom?.kind ?? "PERCENT");
    const [rate, setRate] = useState(pct(startFrom?.rateBp ?? 0));
    const [bonus, setBonus] = useState(rupees(startFrom?.bonusPaise ?? 0));
    const [slabs, setSlabs] = useState<SlabDraft[]>(() =>
        startFrom?.slabs.length
            ? startFrom.slabs.map((s) => ({ from: rupees(s.fromPaise), rate: pct(s.rateBp) }))
            : [{ from: "0", rate: "" }, { from: "", rate: "" }],
    );
    const [note, setNote] = useState("");
    const [saving, setSaving] = useState(false);

    const parsed = useMemo<{ terms: CommissionSchemeTerms; bad: string | null }>(() => {
        const targetPaise = target.trim() === "" ? 0 : parseRupeesToPaise(target);
        const bonusPaise = bonus.trim() === "" ? 0 : parseRupeesToPaise(bonus);
        const rateBp = rate.trim() === "" ? 0 : toBp(rate);
        let bad: string | null = null;
        if (targetPaise == null) bad = "The target is not a rupee figure";
        else if (bonusPaise == null) bad = "The bonus is not a rupee figure";
        else if (rateBp == null || rateBp > 10_000) bad = "The rate must be between 0 and 100";
        else if ((kind === "PERCENT" || kind === "ABOVE_TARGET") && rateBp <= 0) bad = "Enter the rate";
        else if (kind === "ABOVE_TARGET" && targetPaise <= 0) bad = "Sales above WHAT target — set one";
        else if (bonusPaise > 0 && targetPaise <= 0) bad = "A bonus needs a target to reach";
        const parsedSlabs: CommissionSlab[] = [];
        if (kind === "SLABS") {
            for (const s of slabs) {
                const fromPaise = s.from.trim() === "" ? null : parseRupeesToPaise(s.from);
                const rateBp2 = s.rate.trim() === "" ? null : toBp(s.rate);
                if (fromPaise == null || rateBp2 == null || rateBp2 > 10_000) { bad ??= "Every slab needs a starting amount and a rate"; continue; }
                parsedSlabs.push({ fromPaise, rateBp: rateBp2 });
            }
            if (!parsedSlabs.length) bad ??= "Add at least one slab";
            for (let i = 1; i < parsedSlabs.length; i++) {
                if (parsedSlabs[i].fromPaise <= parsedSlabs[i - 1].fromPaise) { bad ??= "Each slab must start above the one before"; break; }
            }
        }
        return {
            terms: { targetPaise: targetPaise ?? 0, kind, rateBp: rateBp ?? 0, slabs: parsedSlabs, bonusPaise: bonusPaise ?? 0 },
            bad,
        };
    }, [target, bonus, rate, kind, slabs]);

    const { terms, bad } = parsed;
    const nothingSet = terms.kind === "NONE" && terms.targetPaise <= 0;
    const canSave = !saving && !bad && !nothingSet && !!effectiveFrom;

    // The example: at the target, and a fifth past it — the two moments the
    // person will actually ask about.
    const example = useMemo(() => {
        const base = terms.targetPaise > 0 ? terms.targetPaise : 100_000_00;
        return [base, Math.round(base * 1.2)].map((sales) => ({ sales, outcome: computeCommission(terms, sales) }));
    }, [terms]);

    const setSlab = (i: number, patch: Partial<SlabDraft>) => setSlabs((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

    const submit = async () => {
        setSaving(true);
        try {
            await axios.post("/api/hr/commission", {
                userId, effectiveFrom,
                targetPaise: terms.targetPaise, kind: terms.kind, rateBp: terms.rateBp,
                slabs: terms.slabs, bonusPaise: terms.bonusPaise,
                note: note.trim() || null,
            });
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
            <DialogContent className="max-w-xl">
                <DialogHeader>
                    <DialogTitle>Target & commission — {name}</DialogTitle>
                    <DialogDescription>
                        A monthly sales target and how this person&apos;s own bills turn into commission. Payroll pays it as a &quot;Commission&quot; line.
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Applies from" required>
                        {(id) => <TallyDateInput id={id} value={effectiveFrom} onValueChange={setEffectiveFrom} />}
                    </Field>
                    <Field label="Monthly sales target (₹)" hint="0 or blank = no target, sales are only shown">
                        {(id) => <NumericInput id={id} mode="decimal" value={target} onValueChange={setTarget} placeholder="e.g. 3,00,000" />}
                    </Field>
                    <Field label="How commission is earned" className="sm:col-span-2">
                        {(id) => (
                            <Select value={kind} onValueChange={(v) => setKind(v as CommissionKind)}>
                                <SelectTrigger id={id} className="h-9 w-full text-sm"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {COMMISSION_KINDS.map((k) => <SelectItem key={k} value={k}>{COMMISSION_KIND_LABELS[k]}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        )}
                    </Field>
                    {(kind === "PERCENT" || kind === "ABOVE_TARGET") && (
                        <Field label="Rate (%)" required hint={kind === "PERCENT" ? "On every rupee sold" : "Only on the rupees past the target"}>
                            {(id) => <NumericInput id={id} mode="decimal" value={rate} onValueChange={setRate} placeholder="e.g. 1.5" />}
                        </Field>
                    )}
                    <Field label="Bonus on reaching the target (₹)" hint="A flat amount on top, the month the target is met">
                        {(id) => <NumericInput id={id} mode="decimal" value={bonus} onValueChange={setBonus} placeholder="optional" />}
                    </Field>
                </div>

                {kind === "SLABS" && (
                    <div className="space-y-2">
                        <div className="text-xs text-muted-foreground">
                            Each slab&apos;s rate is paid on the sales inside it — like tax slabs, so crossing a line never loses money.
                        </div>
                        {slabs.map((s, i) => (
                            <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
                                <NumericInput mode="decimal" value={s.from} onValueChange={(v) => setSlab(i, { from: v })} placeholder={i === 0 ? "from ₹0" : "from ₹"} />
                                <NumericInput mode="decimal" value={s.rate} onValueChange={(v) => setSlab(i, { rate: v })} placeholder="rate %" />
                                <Button type="button" variant="ghost" size="icon" aria-label="Remove slab" disabled={slabs.length <= 1}
                                    onClick={() => setSlabs((ls) => ls.filter((_, j) => j !== i))}>
                                    <X size={14} />
                                </Button>
                            </div>
                        ))}
                        <Button type="button" variant="outline" size="sm" disabled={slabs.length >= 10}
                            onClick={() => setSlabs((ls) => [...ls, { from: "", rate: "" }])}>
                            <Plus size={14} /> Add slab
                        </Button>
                    </div>
                )}

                <Field label="Note">
                    {(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Why this changed (optional)" />}
                </Field>

                <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
                    <div className="font-medium">{describeScheme(terms, formatRupeesFromPaise)}</div>
                    {!nothingSet && !bad && (
                        <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                            {example.map(({ sales, outcome }) => (
                                <li key={sales}>
                                    Sells {formatRupeesFromPaise(sales)} in a month → earns <span className="font-medium text-foreground">{formatRupeesFromPaise(outcome.totalPaise)}</span>
                                    {outcome.bonusPaise > 0 ? ` (incl. ${formatRupeesFromPaise(outcome.bonusPaise)} bonus)` : ""}
                                </li>
                            ))}
                        </ul>
                    )}
                    {bad && <div className="mt-1 text-xs text-destructive">{bad}</div>}
                </div>

                <DialogFooter>
                    <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
                    <Button type="button" onClick={submit} disabled={!canSave}>{saving ? "Saving…" : "Save scheme"}</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
