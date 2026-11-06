"use client";

// Charge Interest — books a loan's interest INTO the loan ledger:
//   Dr Interest (expense ledger)   Cr <loan ledger>
// so the interest shows on the loan's own statement and one payment clears
// principal + interest together. Posts a normal Journal Voucher, so the JV
// create/post permission gates it — no new permission.

import { useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumericInput } from "@/shared/components/NumericInput";
import { TallyDateInput } from "@/shared/components/TallyDateInput";
import { toIsoDate } from "@/shared/hooks/useTallyDate";
import { useGlAccounts } from "@/shared/hooks/useGlAccounts";
import { GlAccountCombobox } from "@/modules/accountancy/components/GlAccountCombobox";
import { extractApiError } from "@/shared/lib/api";
import { fmt, round2 } from "@/shared/lib/format/moneyInr";
import { parseLoan } from "@/modules/accountancy/lib/loanParticulars";

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    loan: { id: number; name: string; loanJson?: unknown } | null;
    /** Outstanding (closing) balance, used only for the suggested amount. */
    outstanding: number;
    onSaved: () => void;
}

const monthLabel = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { month: "short", year: "numeric" });

export function ChargeInterestDialog({ open, onOpenChange, loan, outstanding, onSaved }: Props) {
    const { accounts } = useGlAccounts();
    // Parent mounts this only while open, so state starts fresh each time.
    const [date, setDate] = useState(() => toIsoDate(new Date()));
    const [amount, setAmount] = useState("");
    const [pickedId, setInterestId] = useState<number | null>(null);
    const [narration, setNarration] = useState(() => loan ? `Interest for ${monthLabel(toIsoDate(new Date()))} – ${loan.name}` : "");
    const [saving, setSaving] = useState(false);

    // Default ledger: an expense ledger with "interest" in its name.
    const defaultInterest = useMemo(
        () => accounts.find((a) => /interest/i.test(a.name) && a.group?.type === "EXPENSE")
            ?? accounts.find((a) => /interest/i.test(a.name) && a.id !== loan?.id),
        [accounts, loan?.id],
    );
    const interestId = pickedId ?? defaultInterest?.id ?? null;

    // Suggestion only — never fills the box (staff decide the figure).
    const rate = Number(parseLoan(loan?.loanJson).interestRate) || 0;
    const suggested = rate > 0 && outstanding > 0 ? round2((outstanding * rate) / 1200) : 0;

    const value = Number(amount) || 0;
    const canSave = !!loan && value > 0 && interestId != null && interestId !== loan.id && !saving;

    const save = async () => {
        if (!canSave || !loan || interestId == null) return;
        setSaving(true);
        try {
            const res = await axios.post<{ voucherId: number; reference: string }>(
                "/api/accountancy/journal-vouchers",
                {
                    type: "JOURNAL",
                    date,
                    narration: narration.trim() || undefined,
                    postImmediately: true,
                    lines: [
                        { accountId: interestId, type: "DEBIT", amount: value },
                        { accountId: loan.id, type: "CREDIT", amount: value },
                    ],
                },
            );
            toast.success(`Interest ${fmt(value)} charged (${res.data.reference ?? `UV-${res.data.voucherId}`})`);
            onSaved();
            onOpenChange(false);
        } catch (err: unknown) {
            toast.error(extractApiError(err, "Could not charge interest"));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Charge Interest</DialogTitle>
                    <DialogDescription>
                        Adds interest to <b>{loan?.name}</b> so it shows on this statement.
                        Then pay principal + interest together. (Dr interest ledger, Cr this loan.)
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                            <Label className="text-xs">Date</Label>
                            <TallyDateInput
                                value={date}
                                onValueChange={(d) => {
                                    setDate(d);
                                    if (loan && /^Interest for /.test(narration)) {
                                        setNarration(`Interest for ${monthLabel(d)} – ${loan.name}`);
                                    }
                                }}
                                className="h-8 text-xs"
                            />
                        </div>
                        <div className="space-y-1">
                            <Label className="text-xs">Interest amount (₹)</Label>
                            <NumericInput
                                mode="decimal"
                                min={0}
                                value={amount}
                                onValueChange={setAmount}
                                className="h-8 text-xs"
                                autoFocus
                                onKeyDown={(e) => { if (e.key === "Enter") void save(); }}
                            />
                        </div>
                    </div>
                    {suggested > 0 && (
                        <p className="text-xs text-muted-foreground">
                            At {rate}% p.a. on {fmt(outstanding)}, one month ≈ {fmt(suggested)}.{" "}
                            <button type="button" className="text-primary underline" onClick={() => setAmount(String(suggested))}>
                                Use
                            </button>
                        </p>
                    )}

                    <div className="space-y-1">
                        <Label className="text-xs">Interest ledger (expense)</Label>
                        <GlAccountCombobox
                            value={interestId}
                            onChange={(a) => setInterestId(a?.id ?? null)}
                            accounts={accounts.filter((a) => a.id !== loan?.id)}
                            placeholder="e.g. Interest on Loan"
                            allowCreate
                        />
                        {!defaultInterest && (
                            <p className="text-xs text-muted-foreground">
                                No interest ledger yet — type “Interest on Loan” and create it under Indirect Expenses.
                            </p>
                        )}
                    </div>

                    <div className="space-y-1">
                        <Label className="text-xs">Narration</Label>
                        <Input value={narration} onChange={(e) => setNarration(e.target.value)} className="h-8 text-xs" />
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button size="sm" disabled={!canSave} onClick={() => void save()}>
                        {saving && <Loader2 size={14} className="mr-1 animate-spin" />}
                        Charge {value > 0 ? fmt(value) : ""}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
