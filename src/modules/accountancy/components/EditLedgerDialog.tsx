"use client";

// Edit an existing ledger account (name, parent group, bank particulars,
// opening balance) — PATCHes /api/accountancy/ledgers/[id]. Mirrors the
// inline editor in Accountancy → Masters → Ledgers, packaged as a dialog so
// it can be opened from the Bank/Cash/Loans Book and Account Ledger explorer
// without navigating away from the register.

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { extractApiError } from "@/shared/lib/api";
import { Loader2 } from "lucide-react";
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { GroupCombobox } from "@/modules/accountancy/components/GroupCombobox";
import {
    type BankFields, EMPTY_BANK, hasBankData, parseBank, BANK_FIELD_LABELS, isBankGroupName,
} from "@/modules/accountancy/lib/bankParticulars";

type GroupType = "ASSET" | "LIABILITY" | "INCOME" | "EXPENSE";

interface GroupNode {
    id: number;
    name: string;
    type: GroupType;
    children: GroupNode[];
}

interface GroupOption { id: number; name: string; type: GroupType; depth: number }

function flattenGroups(nodes: GroupNode[], depth = 0, out: GroupOption[] = []): GroupOption[] {
    for (const n of nodes) {
        out.push({ id: n.id, name: n.name, type: n.type, depth });
        flattenGroups(n.children ?? [], depth + 1, out);
    }
    return out;
}

export interface EditableLedger {
    id: number;
    name: string;
    groupId: number | null;
    bankJson?: unknown;
    openingBalance?: number | null;
    openingBalanceType?: "DEBIT" | "CREDIT" | null;
}

export function EditLedgerDialog({
    open,
    onOpenChange,
    ledger,
    onSaved,
}: {
    open: boolean;
    onOpenChange: (v: boolean) => void;
    /** Account being edited. Dialog stays closed (no-op save) if null. */
    ledger: EditableLedger | null;
    onSaved: () => void;
}) {
    const [groups, setGroups] = useState<GroupOption[]>([]);
    const [saving, setSaving] = useState(false);

    const [name, setName] = useState("");
    const [groupId, setGroupId] = useState<number | null>(null);
    const [bank, setBank] = useState<BankFields>(EMPTY_BANK);
    const [openingBalance, setOpeningBalance] = useState("");
    const [openingBalanceType, setOpeningBalanceType] = useState<"DEBIT" | "CREDIT">("DEBIT");

    // Reset the form from the target ledger and load the group list whenever
    // the dialog opens.
    useEffect(() => {
        if (!open || !ledger) return;
        setName(ledger.name);
        setGroupId(ledger.groupId);
        setBank(parseBank(ledger.bankJson));
        setOpeningBalance(ledger.openingBalance ? String(ledger.openingBalance) : "");
        setOpeningBalanceType(ledger.openingBalanceType ?? "DEBIT");
        axios.get<GroupNode[]>("/api/accountancy/account-groups")
            .then((r) => setGroups(flattenGroups(r.data)))
            .catch(() => { /* group list is optional */ });
    }, [open, ledger]);

    const save = async () => {
        if (!ledger) return;
        if (!name.trim()) { toast.error("Name is required"); return; }
        const hasOpening = openingBalance.trim() !== "";
        const amount = Number(openingBalance);
        if (hasOpening && (!Number.isFinite(amount) || amount < 0)) {
            toast.error("Opening balance must be a valid non-negative number");
            return;
        }

        const groupIsBank = isBankGroupName(groups.find((g) => g.id === groupId)?.name);

        setSaving(true);
        try {
            const payload: Record<string, unknown> = {
                name: name.trim(),
                groupId,
                bankJson: groupIsBank && hasBankData(bank) ? bank : null,
            };
            if (hasOpening) {
                payload.openingBalance = amount;
                payload.openingBalanceType = openingBalanceType;
            } else {
                payload.openingBalance = null;
                payload.openingBalanceType = null;
            }
            await axios.patch(`/api/accountancy/ledgers/${ledger.id}`, payload);
            toast.success("Ledger updated");
            onOpenChange(false);
            onSaved();
        } catch (err: unknown) {
            toast.error(extractApiError(err, "Failed to update ledger"));
        } finally {
            setSaving(false);
        }
    };

    const selectedGroupIsBank = isBankGroupName(groups.find((g) => g.id === groupId)?.name);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-xl">
                <DialogHeader>
                    <DialogTitle>Edit Ledger Account</DialogTitle>
                    <DialogDescription>Update the ledger&apos;s name, group, bank particulars, or opening balance.</DialogDescription>
                </DialogHeader>

                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5 col-span-2">
                        <Label>Name <span className="text-destructive">*</span></Label>
                        <Input
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Account name"
                            autoFocus
                            onKeyDown={(e) => { if (e.key === "Enter") save(); }}
                        />
                    </div>
                    <div className="space-y-1.5 col-span-2">
                        <Label>Under (Group)</Label>
                        <GroupCombobox value={groupId} onChange={setGroupId} groups={groups} />
                    </div>
                    <div className="col-span-2 space-y-3 rounded-md border border-border bg-muted/30 p-4">
                        <p className="text-sm font-medium text-foreground">
                            Opening Balance <span className="font-normal text-muted-foreground">— leave blank to clear</span>
                        </p>
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                            <div className="space-y-1.5">
                                <Label>Amount (₹)</Label>
                                <Input
                                    type="text"
                                    inputMode="decimal"
                                    value={openingBalance}
                                    onChange={(e) => setOpeningBalance(e.target.value)}
                                    placeholder="0.00"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label>Dr / Cr</Label>
                                <Select
                                    value={openingBalanceType}
                                    onValueChange={(value) => setOpeningBalanceType(value as "DEBIT" | "CREDIT")}
                                >
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="DEBIT">Debit</SelectItem>
                                        <SelectItem value="CREDIT">Credit</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    </div>
                    {selectedGroupIsBank && (
                        <div className="col-span-2 space-y-3 rounded-md border border-border bg-muted/30 p-4">
                            <p className="text-sm font-medium text-foreground">
                                Bank Details <span className="font-normal text-muted-foreground">— printed on the deposit slip</span>
                            </p>
                            <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                                {BANK_FIELD_LABELS.map(({ key, label, placeholder }) => (
                                    <div key={key} className="space-y-1.5">
                                        <Label>{label}</Label>
                                        <Input
                                            value={bank[key]}
                                            onChange={(e) => setBank((b) => ({ ...b, [key]: e.target.value }))}
                                            placeholder={placeholder}
                                        />
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button onClick={save} disabled={saving}>
                        {saving && <Loader2 size={14} className="animate-spin" />} Save
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
