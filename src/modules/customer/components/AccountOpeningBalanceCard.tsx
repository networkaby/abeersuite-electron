"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Scale, ListTree } from "lucide-react";
import { formatRupees } from "@/shared/lib/format/moneyInr";
import { extractApiError } from "@/shared/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { OpeningBillsDialog } from "@/modules/accountancy/components/OpeningBillsDialog";
import { parseDecimalInput } from "@/shared/lib/format";

interface Props {
    accountId: number;
    /** Current amount from the API. Prisma Decimal arrives as a string; null = none set. */
    initialAmount: string | number | null;
    initialType: "DEBIT" | "CREDIT" | null;
    /**
     * Whether the current user may change the opening balance — the DELETE-level
     * grant (customers:delete), not plain customers:edit. Rewriting what a party
     * owed before the books started moves real money the same way removing the
     * party does, so it sits with Delete rather than with "fix a phone number".
     * False only greys the controls (the parent's fieldset does the disabling);
     * the figure itself stays readable to anyone who can open the profile.
     */
    canEdit: boolean;
    /** Called after a successful save so the parent can re-fetch. */
    onSaved: () => void;
}

// Decimal/null from the API → a clean editable string ("" when none set).
function toInput(amount: string | number | null): string {
    if (amount === null || amount === undefined) return "";
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return "";
    return String(n);
}

// Per repo rule: no <input type="number">. Keep digits and a single dot.
type BillTotal = { amount: number; type: "DEBIT" | "CREDIT"; count: number };

export default function AccountOpeningBalanceCard({
    accountId, initialAmount, initialType, canEdit, onSaved,
}: Props) {
    // Once the opening is broken into bills the master figure is null, so the
    // card reads the bills and shows their total — the box always holds the
    // opening as it really stands.
    const [bills, setBills] = useState<BillTotal | null>(null);
    const [amount, setAmount] = useState(() => toInput(initialAmount));
    const [type, setType] = useState<"DEBIT" | "CREDIT">(initialType ?? "DEBIT");
    const [saving, setSaving] = useState(false);
    const [billsOpen, setBillsOpen] = useState(false);
    const [reload, setReload] = useState(0);
    const [retarget, setRetarget] = useState<{ amount: number; type: "DEBIT" | "CREDIT" } | undefined>();

    useEffect(() => {
        let alive = true;
        axios.get<{ bills: { amount: number; type: "DEBIT" | "CREDIT" }[] }>(`/api/accountancy/accounts/${accountId}/opening-bills`)
            .then(({ data }) => {
                if (!alive) return;
                const total = Math.round(data.bills.reduce((s, b) => s + b.amount, 0) * 100) / 100;
                const t = data.bills.length > 0
                    ? { amount: total, type: data.bills[0].type, count: data.bills.length }
                    : null;
                setBills(t);
                if (t) { setAmount(toInput(t.amount)); setType(t.type); }
                else { setAmount(toInput(initialAmount)); setType(initialType ?? "DEBIT"); }
            })
            .catch(() => { /* not a party ledger, or offline — the master figure stands */ });
        return () => { alive = false; };
    }, [accountId, initialAmount, initialType, reload]);

    const savedAmount = bills ? toInput(bills.amount) : toInput(initialAmount);
    const savedType = bills ? bills.type : (initialType ?? "DEBIT");
    const dirty = amount !== savedAmount || type !== savedType;
    const parsed = amount.trim() === "" ? 0 : Number(amount);
    const hasOpening = parsed > 0;

    const save = async () => {
        // The opening lives in bills: a new figure goes through the breakup,
        // prefilled, rather than back onto the master (that would count twice).
        if (bills) {
            setRetarget({ amount: hasOpening ? parsed : 0, type });
            setBillsOpen(true);
            return;
        }
        setSaving(true);
        try {
            await axios.patch(`/api/accounts/${accountId}`, {
                openingBalance: hasOpening ? parsed : null,
                openingBalanceType: hasOpening ? type : null,
            });
            toast.success(hasOpening
                ? `Opening balance set to ${formatRupees(parsed)} (${type === "DEBIT" ? "Dr" : "Cr"})`
                : "Opening balance cleared");
            onSaved();
        } catch (e) {
            toast.error(extractApiError(e, "Save failed"));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Card>
            <CardContent className="space-y-3 pt-4">
                <div className="flex items-center gap-2">
                    <Scale size={15} className="text-primary" />
                    <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                        Opening balance
                    </p>
                </div>

                <p className="text-sm text-muted-foreground">
                    {bills && <>Held as {bills.count === 1 ? "1 bill" : `${bills.count} bills`} — a change here opens Bill-wise details to apply it. </>}
                    {hasOpening
                        ? <>Carried-forward opening balance of <span className="font-medium text-foreground">{formatRupees(parsed)}</span> ({type === "DEBIT" ? "Dr" : "Cr"}), from before this ledger started in the app.</>
                        : "No opening balance on the master — set one when migrating a customer's existing outstanding from another system, or check Bill-wise details, where it lives once it has been broken into bills."}
                    {!canEdit && " Only someone who can delete a customer may change this."}
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-xl">
                    <div className="space-y-1.5">
                        <Label htmlFor="opening-balance-amount">Amount (₹)</Label>
                        <Input
                            id="opening-balance-amount"
                            inputMode="decimal"
                            value={amount}
                            onChange={e => setAmount(parseDecimalInput(e.target.value))}
                            placeholder="0 to clear"
                        />
                    </div>
                    <div className="space-y-1.5">
                        <Label>Dr / Cr</Label>
                        <Select value={type} onValueChange={v => setType(v as "DEBIT" | "CREDIT")}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="DEBIT">Debit</SelectItem>
                                <SelectItem value="CREDIT">Credit</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    {dirty && (
                        <Button size="sm" onClick={() => void save()} disabled={saving}>
                            {saving ? "Saving…" : bills ? "Apply to bills…" : "Save opening balance"}
                        </Button>
                    )}
                    {/* One number rarely tells the whole story. Break it into the
                        bills it really was and each one ages, shows in Receivables
                        and can have a receipt settled against it.
                        Shown whether or not the amount above is set: once a breakup
                        exists the master figure is cleared (or the same money would
                        count twice), and this is the only way back in to edit it.
                        Hidden only while there are unsaved edits, which are not in
                        the breakup yet. */}
                    {!dirty && (
                        <Button size="sm" variant="outline" onClick={() => { setRetarget(undefined); setBillsOpen(true); }}>
                            <ListTree size={14} className="mr-1" /> Bill-wise details
                        </Button>
                    )}
                </div>
            </CardContent>
            {billsOpen && (
                <OpeningBillsDialog
                    open
                    onOpenChange={(v) => {
                        if (v) return;
                        setBillsOpen(false);
                        // Cancelled a retarget: put the box back to what is saved.
                        if (retarget) { setAmount(savedAmount); setType(savedType); setRetarget(undefined); }
                    }}
                    accountId={accountId}
                    retarget={retarget}
                    onSaved={() => { setRetarget(undefined); setReload((n) => n + 1); onSaved(); }}
                />
            )}
        </Card>
    );
}
