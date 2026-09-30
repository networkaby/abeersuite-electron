"use client";

// ── PosExpenditureDialog ─────────────────────────────────────────────────────
// Records a small cash expense paid out of the counter drawer (tea, sundry
// donation, etc.). Posts a PAYMENT voucher (Dr <expense ledger> / Cr counter
// till) and links a PosExpenditure row to the shift, so the expected drawer at
// shift close is reduced by it. Funding is always the shift's counter till —
// the cashier can only spend from their own counter.

import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import axios from "axios";
import { toast } from "sonner";
import { printVoucherThermal } from "@/shared/lib/print/silentThermalPrint";
import { Banknote } from "lucide-react";
import { SavePrintButtons, savePrintKey } from "@/modules/pos/components/SavePrintButtons";
import {
    Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumericInput } from "@/shared/components/NumericInput";
import { Label } from "@/components/ui/label";
import { GlAccountCombobox, type GlAccount } from "@/modules/accountancy/components/GlAccountCombobox";
import { extractApiError } from "@/shared/lib/api";

export function PosExpenditureDialog({
    open, onOpenChange, shiftId, counterName, onDone,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    shiftId: number;
    counterName?: string;
    onDone: () => void;
}) {
    const [amount, setAmount]                     = useState("");
    const [description, setDescription]           = useState("");
    const [expenseAccountId, setExpenseAccountId] = useState<number | null>(null);
    const [accounts, setAccounts]                 = useState<GlAccount[]>([]);
    const [submitting, setSubmitting]             = useState(false);

    useEffect(() => {
        if (!open) return;
        setAmount(""); setDescription(""); setExpenseAccountId(null);
        // Only the EXPENSE ledgers this counter is allowed to spend to (the
        // counter's allow-list; empty list → all expense ledgers).
        axios.get<GlAccount[]>(`/api/pos/shifts/${shiftId}/expense-accounts`)
            .then((r) => setAccounts(r.data))
            .catch(() => toast.error("Failed to load expense accounts"));
    }, [open, shiftId]);

    const submit = async (print: boolean) => {
        const rupees = parseFloat(amount) || 0;
        if (rupees <= 0)            { toast.error("Amount must be positive"); return; }
        if (!description.trim())    { toast.error("Add a short note (e.g. tea, donation)"); return; }
        if (!expenseAccountId)      { toast.error("Pick an expense account"); return; }
        setSubmitting(true);
        try {
            const { data } = await axios.post<{ voucherId: number; voucherRef: string }>(`/api/pos/shifts/${shiftId}/expenditures`, {
                amountPaise:      Math.round(rupees * 100),
                description:      description.trim(),
                expenseAccountId,
            });
            toast.success(`Expenditure ${data.voucherRef} · ₹${rupees.toFixed(2)}`);
            // Silent thermal print of the payment voucher (selection page only as fallback).
            // Always paid in cash from the drawer, so the slip always opens it.
            if (print) void printVoucherThermal("gl", data.voucherId, "PAYMENT", { openDrawer: true });
            onDone();
            onOpenChange(false);
        } catch (e: unknown) {
            toast.error(extractApiError(e, "Failed to record expenditure"));
        } finally {
            setSubmitting(false);
        }
    };

    // Enter in Amount / Note → Record; Ctrl+Enter anywhere → Record + Print. The
    // account picker keeps its own Enter (it picks the ledger).
    const onFieldKey = (e: ReactKeyboardEvent) => savePrintKey(e, (p) => void submit(p), { disabled: submitting });

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className="sm:max-w-md"
                onKeyDown={(e) => savePrintKey(e, (p) => void submit(p), { enterSaves: false, disabled: submitting })}
            >
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Banknote size={18} className="text-primary" /> Counter expenditure
                    </DialogTitle>
                    <DialogDescription>
                        Record a small cash expense paid from this counter&apos;s drawer (tea, sundry donation, etc.).
                        Posts a payment voucher (Dr expense / Cr {counterName ?? "counter till"}) and reduces the
                        expected drawer at shift close.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-2">
                    <div className="space-y-1.5">
                        <Label htmlFor="exp-amount">Amount (₹)</Label>
                        <NumericInput
                            id="exp-amount"
                            mode="decimal"
                            min={0}
                            value={amount}
                            onValueChange={setAmount}
                            placeholder="10"
                            autoFocus
                            onKeyDown={onFieldKey}
                        />
                    </div>

                    <div className="space-y-1.5">
                        <Label htmlFor="exp-note">Note</Label>
                        <Input
                            id="exp-note"
                            type="text"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="e.g. tea, sundry donation"
                            maxLength={200}
                            onKeyDown={onFieldKey}
                        />
                    </div>

                    <div className="space-y-1.5">
                        <Label>Expense account</Label>
                        <GlAccountCombobox
                            value={expenseAccountId}
                            onChange={(a) => setExpenseAccountId(a?.id ?? null)}
                            accounts={accounts}
                            placeholder="Pick expense ledger…"
                        />
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
                    <SavePrintButtons
                        label="Record"
                        printLabel="Record + Print"
                        onSave={(p) => void submit(p)}
                        submitting={submitting}
                    />
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
