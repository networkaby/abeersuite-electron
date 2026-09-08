"use client";

import { useState } from "react";
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

interface Props {
    accountId: number;
    /** Current amount from the API. Prisma Decimal arrives as a string; null = none set. */
    initialAmount: string | number | null;
    initialType: "DEBIT" | "CREDIT" | null;
    /** Whether the current user may change the opening balance. */
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
function sanitize(raw: string): string {
    const cleaned = raw.replace(/[^\d.]/g, "");
    const firstDot = cleaned.indexOf(".");
    if (firstDot === -1) return cleaned;
    return cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, "");
}

export default function AccountOpeningBalanceCard({
    accountId, initialAmount, initialType, canEdit, onSaved,
}: Props) {
    const [amount, setAmount] = useState(() => toInput(initialAmount));
    const [type, setType] = useState<"DEBIT" | "CREDIT">(initialType ?? "DEBIT");
    const [saving, setSaving] = useState(false);
    const [billsOpen, setBillsOpen] = useState(false);

    const savedAmount = toInput(initialAmount);
    const savedType = initialType ?? "DEBIT";
    const dirty = amount !== savedAmount || type !== savedType;
    const parsed = amount.trim() === "" ? 0 : Number(amount);
    const hasOpening = parsed > 0;

    const save = async () => {
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
                    {hasOpening
                        ? <>Carried-forward opening balance of <span className="font-medium text-foreground">{formatRupees(parsed)}</span> ({type === "DEBIT" ? "Dr" : "Cr"}), from before this ledger started in the app.</>
                        : "No opening balance on the master — set one when migrating a customer's existing outstanding from another system, or check Bill-wise details, where it lives once it has been broken into bills."}
                </p>

                {canEdit ? (
                    <>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-xl">
                            <div className="space-y-1.5">
                                <Label htmlFor="opening-balance-amount">Amount (₹)</Label>
                                <Input
                                    id="opening-balance-amount"
                                    inputMode="decimal"
                                    value={amount}
                                    onChange={e => setAmount(sanitize(e.target.value))}
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
                                    {saving ? "Saving…" : "Save opening balance"}
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
                                <Button size="sm" variant="outline" onClick={() => setBillsOpen(true)}>
                                    <ListTree size={14} className="mr-1" /> Bill-wise details
                                </Button>
                            )}
                        </div>
                    </>
                ) : (
                    <p className="text-xs text-muted-foreground/70">
                        You don&apos;t have permission to change the opening balance.
                    </p>
                )}
            </CardContent>
            {billsOpen && (
                <OpeningBillsDialog
                    open
                    onOpenChange={(v) => { if (!v) setBillsOpen(false); }}
                    accountId={accountId}
                    onSaved={onSaved}
                />
            )}
        </Card>
    );
}
