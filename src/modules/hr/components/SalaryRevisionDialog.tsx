"use client";

// New salary revision — an effective date and a handful of lines. Starts from
// the current structure so a raise is one number changed, not a form retyped.

import { useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field } from "@/shared/components/Field";
import { TallyDateInput } from "@/shared/components/TallyDateInput";
import { extractApiError } from "@/shared/lib/api/extractApiError";
import { todayIso } from "@/shared/lib/format/formatDate";
import { formatRupeesFromPaise, paiseToRupees, parseRupeesToPaise } from "@/shared/lib/format/moneyInr";
import { DEFAULT_SALARY_LINES, salaryTotals, type SalaryLine } from "../lib/salaryLines";
import PayDaysField from "./PayDaysField";
import { DEFAULT_PAY_DAYS } from "@/shared/lib/constants/hr";
import type { StaffSalaryDto } from "../lib/staffTypes";

type Draft = { name: string; kind: SalaryLine["kind"]; amount: string };

const toDraft = (l: SalaryLine): Draft => ({ name: l.name, kind: l.kind, amount: l.amountPaise ? String(paiseToRupees(l.amountPaise)) : "" });

export default function SalaryRevisionDialog({ url, startFrom, dutyMinutes, onClose, onSaved }: {
    url: string;
    startFrom: StaffSalaryDto | null;
    /** This person's duty day, for the hourly rate shown under the divisor. */
    dutyMinutes?: number | null;
    onClose: () => void;
    onSaved: () => void;
}) {
    const [effectiveFrom, setEffectiveFrom] = useState(todayIso());
    // Carried forward from the structure being replaced — a raise should not
    // silently reset the divisor the last one was agreed on.
    const [payDays, setPayDays] = useState(String(startFrom?.payDays ?? DEFAULT_PAY_DAYS));
    const [lines, setLines] = useState<Draft[]>(() => (startFrom?.lines.length ? startFrom.lines : DEFAULT_SALARY_LINES).map(toDraft));
    const [note, setNote] = useState("");
    const [saving, setSaving] = useState(false);

    const parsed = useMemo<SalaryLine[]>(
        () => lines.map((l) => ({ name: l.name.trim(), kind: l.kind, amountPaise: parseRupeesToPaise(l.amount) ?? 0 })),
        [lines],
    );
    const totals = salaryTotals(parsed);
    const badLine = lines.some((l) => !l.name.trim() || (l.amount.trim() !== "" && parseRupeesToPaise(l.amount) == null));
    const days = Number(payDays);
    const badDays = !Number.isInteger(days) || days < 1 || days > 31;
    const canSave = !saving && !badLine && !badDays && effectiveFrom && parsed.length > 0 && totals.grossPaise > 0;

    const set = (i: number, patch: Partial<Draft>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

    const submit = async () => {
        setSaving(true);
        try {
            await axios.post(`${url}/salary`, { effectiveFrom, payDays: days, lines: parsed, note: note.trim() || null });
            toast.success("Salary revision saved");
            onSaved();
        } catch (e) {
            toast.error(extractApiError(e, "Could not save the revision"));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>New salary revision</DialogTitle>
                    <DialogDescription>
                        Amounts are per month, in rupees. Earnings add up to gross; deductions come off it. A month is
                        taken to be 26 paid days unless you change it — one day&rsquo;s pay, and the hourly rate behind
                        overtime, both come off that figure.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    <div className="flex flex-wrap items-start gap-4">
                        <div className="min-w-40 flex-1">
                            <Field label="Effective from">
                                {(id) => <TallyDateInput id={id} value={effectiveFrom} onValueChange={setEffectiveFrom} className="h-9 text-sm" />}
                            </Field>
                        </div>
                        <PayDaysField value={payDays} onChange={setPayDays} grossPaise={totals.grossPaise} dutyMinutes={dutyMinutes} />
                    </div>

                    <div className="space-y-2">
                        {lines.map((l, i) => (
                            <div key={i} className="flex items-center gap-2">
                                <Input
                                    value={l.name}
                                    onChange={(e) => set(i, { name: e.target.value })}
                                    placeholder="Basic, HRA, PF…"
                                    aria-label={`Line ${i + 1} name`}
                                    className="h-9 flex-1 text-sm"
                                />
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="w-24 shrink-0"
                                    aria-label={`Line ${i + 1} is ${l.kind === "EARNING" ? "an earning" : "a deduction"} — press to switch`}
                                    onClick={() => set(i, { kind: l.kind === "EARNING" ? "DEDUCTION" : "EARNING" })}
                                >
                                    {l.kind === "EARNING" ? "Earning" : "Deduction"}
                                </Button>
                                <Input
                                    value={l.amount}
                                    onChange={(e) => set(i, { amount: e.target.value })}
                                    inputMode="decimal"
                                    placeholder="0"
                                    aria-label={`Line ${i + 1} amount in rupees`}
                                    aria-invalid={l.amount.trim() !== "" && parseRupeesToPaise(l.amount) == null}
                                    className="h-9 w-28 shrink-0 text-right text-sm tabular-nums"
                                />
                                <Button
                                    type="button"
                                    size="icon-sm"
                                    variant="ghost"
                                    aria-label={`Remove line ${i + 1}`}
                                    disabled={lines.length === 1}
                                    onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                                >
                                    <X size={14} />
                                </Button>
                            </div>
                        ))}
                        <Button type="button" size="sm" variant="ghost" onClick={() => setLines((ls) => [...ls, { name: "", kind: "EARNING", amount: "" }])}>
                            <Plus size={14} /> Add line
                        </Button>
                    </div>

                    <div className="flex flex-wrap gap-6 rounded-md bg-muted/40 px-3 py-2 text-sm">
                        <span>Gross <strong className="tabular-nums">{formatRupeesFromPaise(totals.grossPaise)}</strong></span>
                        <span>Deductions <strong className="tabular-nums">{formatRupeesFromPaise(totals.deductionsPaise)}</strong></span>
                        <span>Net <strong className="tabular-nums">{formatRupeesFromPaise(totals.netPaise)}</strong></span>
                    </div>

                    <Field label="Note (optional)">
                        {(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Annual raise, promotion…" className="h-9 text-sm" />}
                    </Field>
                </div>

                <DialogFooter>
                    <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
                    <Button type="button" disabled={!canSave} onClick={() => void submit()}>
                        {saving ? "Saving…" : "Save revision"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
