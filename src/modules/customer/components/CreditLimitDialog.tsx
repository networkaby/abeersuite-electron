"use client";

// ── CreditLimitDialog ────────────────────────────────────────────────────────
// The office's answer to a refused credit sale. The server refuses the sale and
// hands back the figures it refused it on (`CreditLimitDetail`); this shows them
// side by side, suggests a limit that would let the sale through, and saves it
// on the customer's ledger — so the salesman fixes it where they are standing
// instead of walking to the Contacts page and back.
//
// The counter deliberately does NOT get this dialog: a cashier is told to
// collect, an office user with customers:edit decides what a customer is good
// for. Saving still goes through PATCH /api/accounts/[id], which enforces
// customers:edit itself — `canEdit` only decides what is shown.
//
// `onSaved` is where the caller retries the save it was refused.

import { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { AlertCircle } from "lucide-react";
import {
    Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatRupees } from "@/shared/lib/format/moneyInr";
import { parseDecimalInput } from "@/shared/lib/format";
import { extractApiError } from "@/shared/lib/api";
import type { CreditLimitDetail } from "@/shared/lib/accountancy/checkCreditLimit";

/** Next ₹100 above what this sale needs — a tidy number to start from, which the
 *  user is free to overtype. */
function suggestLimit(required: number): number {
    return Math.max(100, Math.ceil(required / 100) * 100);
}


function Row({ label, value: v, strong }: { label: string; value: string; strong?: boolean }) {
    return (
        <div className="flex items-center justify-between py-1">
            <span className="text-muted-foreground">{label}</span>
            <span className={`tabular-nums ${strong ? "font-semibold" : ""}`}>{v}</span>
        </div>
    );
}
export default function CreditLimitDialog({
    open, onOpenChange, detail, partyName, canEdit, onSaved,
}: {
    open: boolean;
    onOpenChange: (v: boolean) => void;
    /** Figures the server refused the sale on. */
    detail: CreditLimitDetail;
    partyName: string;
    /** Whether this user holds customers:edit. */
    canEdit: boolean;
    /** Called after the new limit is saved — the caller retries its save. */
    onSaved: () => void;
}) {
    const [value, setValue] = useState(() => String(suggestLimit(detail.required)));
    const [saving, setSaving] = useState(false);

    const parsed = value.trim() === "" ? 0 : Number(value);
    const enough = Number.isFinite(parsed) && parsed >= detail.required;

    const save = async () => {
        setSaving(true);
        try {
            await axios.patch(`/api/accounts/${detail.accountId}`, { creditLimit: parsed });
            toast.success(`Credit limit for ${partyName} set to ${formatRupees(parsed)}`);
            onOpenChange(false);
            onSaved();
        } catch (e) {
            toast.error(extractApiError(e, "Could not change the credit limit"));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Credit limit reached — {partyName}</DialogTitle>
                </DialogHeader>

                <div className="space-y-3">
                    <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                        <AlertCircle size={16} className="mt-0.5 shrink-0" />
                        <span>
                            {detail.limit === 0
                                ? "This customer has no credit facility, so the sale cannot go on their account."
                                : `Their limit is ${formatRupees(detail.limit)} and this sale needs ${formatRupees(detail.required)}.`}
                        </span>
                    </div>

                    <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
                        <Row label="Already outstanding" value={formatRupees(Math.max(0, detail.balance))} />
                        <Row label="This sale, on credit" value={formatRupees(detail.onCredit)} />
                        <Row label="Limit needed" value={formatRupees(detail.required)} strong />
                        <Row
                            label="Limit now"
                            value={detail.manualLimit > 0
                                ? formatRupees(detail.manualLimit)
                                : detail.limit > 0
                                    ? `${formatRupees(detail.limit)} (automatic)`
                                    : "None"}
                        />
                    </div>

                    {canEdit ? (
                        <div className="space-y-1.5">
                            <Label htmlFor="new-credit-limit">New credit limit (₹)</Label>
                            <Input
                                id="new-credit-limit"
                                inputMode="decimal"
                                value={value}
                                onChange={(e) => setValue(parseDecimalInput(e.target.value))}
                                onKeyDown={(e) => { if (e.key === "Enter" && enough && !saving) { e.preventDefault(); void save(); } }}
                                autoFocus
                                className="max-w-[12rem]"
                            />
                            {!enough && (
                                <p className="text-xs text-amber-600">
                                    Needs to be at least {formatRupees(detail.required)} for this sale to go through.
                                </p>
                            )}
                            <p className="text-[11px] text-muted-foreground">
                                This sets the customer&apos;s permanent limit — the same field on their profile, not a one-time pass.
                            </p>
                        </div>
                    ) : (
                        <p className="text-xs text-muted-foreground">
                            You don&apos;t have permission to change a credit limit. Collect the balance on this
                            bill, or ask someone who can raise it.
                        </p>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
                        Close
                    </Button>
                    {canEdit && (
                        <Button onClick={() => void save()} disabled={saving || !enough}>
                            {saving ? "Saving…" : "Save limit & retry"}
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
