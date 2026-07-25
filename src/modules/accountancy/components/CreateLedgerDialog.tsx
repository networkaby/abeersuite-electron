"use client";

// Create a new ledger account (Account row) under a group. Posts to
// /api/accountancy/ledgers and hands the created account back via onCreated.
// Fields mirror the create schema in that route — note there is no per-account
// "type"; the accounting nature is inherited from the chosen group.
// Opening balance fields (amount, Dr/Cr, date) are optional; if any are set
// all three are required and reconciled against the suspense ledger.

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
import { TallyDateInput } from "@/shared/components/TallyDateInput";
import { todayIso } from "@/shared/lib/format/formatDate";

type GroupType = "ASSET" | "LIABILITY" | "INCOME" | "EXPENSE";

interface GroupNode {
    id: number;
    name: string;
    type: GroupType;
    children: GroupNode[];
}

interface GroupOption { id: number; name: string; type: GroupType; depth: number }

export interface CreatedLedger {
    id: number;
    name: string;
    groupId: number | null;
}

// Flatten the tree preserving depth so the picker can render an indented
// bullet hierarchy (parent group › sub-group).
function flattenGroups(nodes: GroupNode[], depth = 0, out: GroupOption[] = []): GroupOption[] {
    for (const n of nodes) {
        out.push({ id: n.id, name: n.name, type: n.type, depth });
        flattenGroups(n.children ?? [], depth + 1, out);
    }
    return out;
}

// A ledger's normal balance is inherited from its group's accounting nature.
function inheritedNormalBalance(type: GroupType): "Debit" | "Credit" {
    return type === "ASSET" || type === "EXPENSE" ? "Debit" : "Credit";
}

type NewLedgerOpeningForm = {
    openingBalance: string;
    openingBalanceType: "DEBIT" | "CREDIT";
    openingBalanceDate: string;
};

export function CreateLedgerDialog({
    open,
    onOpenChange,
    onCreated,
    defaultGroupId = null,
}: {
    open: boolean;
    onOpenChange: (v: boolean) => void;
    onCreated: (account: CreatedLedger) => void;
    /** Pre-select this group when the dialog opens. */
    defaultGroupId?: number | null;
}) {
    const [groups, setGroups] = useState<GroupOption[]>([]);
    const [saving, setSaving] = useState(false);
    const [form, setForm] = useState<{
        name: string;
        groupId: number | null;
        description: string;
        openingBalance: string;
        openingBalanceType: "DEBIT" | "CREDIT";
        openingBalanceDate: string;
    }>({
        name: "",
        groupId: null,
        description: "",
        openingBalance: "",
        openingBalanceType: "DEBIT",
        openingBalanceDate: todayIso(),
    });

    // Reset the form and load the group list whenever the dialog opens.
    useEffect(() => {
        if (!open) return;
        setForm({
            name: "",
            groupId: defaultGroupId ?? null,
            description: "",
            openingBalance: "",
            openingBalanceType: "DEBIT",
            openingBalanceDate: todayIso(),
        });
        axios.get<GroupNode[]>("/api/accountancy/account-groups")
            .then((r) => setGroups(flattenGroups(r.data)))
            .catch(() => { /* group list is optional */ });
    }, [open, defaultGroupId]);

    const selectedGroup = groups.find((g) => g.id === form.groupId);

    const save = async () => {
        if (!form.name.trim()) { toast.error("Name is required"); return; }
        if (!form.groupId) { toast.error("Group is required"); return; }

        // Opening balance is optional, but if ANY part is filled all three
        // must be provided (matches the backend createSchema superRefine rule
        // and the Masters → Ledgers create-inline pattern).
        const obAmount = form.openingBalance.trim();
        const obType = form.openingBalanceType;
        const obDate = form.openingBalanceDate;
        const hasAny = obAmount !== "" || !!obType || !!obDate;
        if (hasAny) {
            if (obAmount === "") { toast.error("Opening balance amount is required"); return; }
            const amount = Number(obAmount);
            if (!Number.isFinite(amount) || amount <= 0) {
                toast.error("Opening balance must be greater than zero");
                return;
            }
            if (!obDate) { toast.error("Opening balance date is required"); return; }
        }

        setSaving(true);
        try {
            // normalBalance is left unset → inherited from the group's nature
            // (loadNormalBalanceMap infers it from group.type at read time).
            const payload: {
                name: string;
                groupId: number;
                description: string | null;
                openingBalance?: number;
                openingBalanceType?: "DEBIT" | "CREDIT";
                openingBalanceDate?: string;
            } = {
                name: form.name.trim(),
                groupId: form.groupId,
                description: form.description.trim() || null,
            };
            if (hasAny) {
                payload.openingBalance = Number(obAmount);
                payload.openingBalanceType = obType;
                payload.openingBalanceDate = obDate;
            }
            const r = await axios.post<CreatedLedger>("/api/accountancy/ledgers", payload);
            toast.success("Ledger created");
            onCreated(r.data);
            onOpenChange(false);
        } catch (err: unknown) {
            toast.error(extractApiError(err, "Failed to create ledger"));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-xl">
                <DialogHeader>
                    <DialogTitle>New Ledger Account</DialogTitle>
                    <DialogDescription>
                        Create a ledger account. The accounting type is inherited from its group.
                    </DialogDescription>
                </DialogHeader>

                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5 col-span-2">
                        <Label>Name <span className="text-destructive">*</span></Label>
                        <Input
                            value={form.name}
                            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                            placeholder="Account name"
                            autoFocus
                            onKeyDown={(e) => { if (e.key === "Enter") save(); }}
                        />
                    </div>
                    <div className="space-y-1.5">
                        <Label>Under (Group) <span className="text-destructive">*</span></Label>
                        <GroupCombobox
                            value={form.groupId}
                            onChange={(id) => setForm((f) => ({ ...f, groupId: id }))}
                            groups={groups}
                            placeholder="Search group…"
                            allowNone={false}
                        />
                    </div>
                    <div className="space-y-1.5">
                        <Label>Normal Balance</Label>
                        <div className="flex h-9 items-center rounded-md border border-input bg-muted/40 px-3 text-sm text-muted-foreground">
                            {selectedGroup
                                ? `${inheritedNormalBalance(selectedGroup.type)} — inherited from ${selectedGroup.name}`
                                : "Inherited from group"}
                        </div>
                    </div>
                    <div className="space-y-1.5 col-span-2">
                        <Label>Description</Label>
                        <Input
                            value={form.description}
                            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                            placeholder="Optional"
                        />
                    </div>
                    <div className="col-span-2 space-y-3 rounded-md border border-border bg-muted/30 p-4">
                        <p className="text-sm font-medium text-foreground">
                            Opening Balance <span className="font-normal text-muted-foreground">— optional, set all three if used</span>
                        </p>
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                            <div className="space-y-1.5">
                                <Label>Amount (₹)</Label>
                                <Input
                                    type="text"
                                    inputMode="decimal"
                                    value={form.openingBalance}
                                    onChange={(e) => setForm((f) => ({ ...f, openingBalance: e.target.value }))}
                                    placeholder="0.00"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label>Dr / Cr</Label>
                                <Select
                                    value={form.openingBalanceType}
                                    onValueChange={(value) => setForm((f) => ({
                                        ...f,
                                        openingBalanceType: value as "DEBIT" | "CREDIT",
                                    }))}
                                >
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="DEBIT">Debit</SelectItem>
                                        <SelectItem value="CREDIT">Credit</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-1.5">
                                <Label>As of</Label>
                                <TallyDateInput
                                    value={form.openingBalanceDate}
                                    onValueChange={(iso) => setForm((f) => ({ ...f, openingBalanceDate: iso }))}
                                />
                            </div>
                        </div>
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button onClick={save} disabled={saving}>
                        {saving && <Loader2 size={14} className="animate-spin" />} Create
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
