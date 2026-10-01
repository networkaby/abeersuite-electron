"use client";

// Create a new ledger account (Account row) under a group. Posts to
// /api/accountancy/ledgers and hands the created account back via onCreated.
// Fields mirror the create schema in that route — note there is no per-account
// "type"; the accounting nature is inherited from the chosen group.
// Opening balance is optional and reconciled against the suspense ledger.
// Group-specific particulars come from PARTICULARS_SPECS, shared with
// EditLedgerDialog.

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
import { LedgerParticularsFields } from "@/modules/accountancy/components/LedgerParticularsFields";
import {
    emptyParticulars, particularsPayload, type ParticularsState,
} from "@/modules/accountancy/lib/ledgerParticulars";
import {
    loadGroupOptions, inheritedNormalBalance, type GroupOption,
} from "@/modules/accountancy/lib/groupOptions";
import { parseAliasInput } from "@/modules/accountancy/lib/accountAlias";

/**
 * The ledger just made: the Account row the create API returns, plus the aliases
 * typed here (the API does not send them back). Complete on purpose — a picker
 * hands this straight to the edit box (Ctrl+Enter), and EditLedgerDialog saves
 * every particular, so a partial row would post the missing ones back as blank.
 */
export interface CreatedLedger {
    id: number;
    name: string;
    groupId: number | null;
    aliases?: string[];
    openingBalance?: number | string | null;
    openingBalanceType?: "DEBIT" | "CREDIT" | null;
    bankJson?: unknown;
    loanJson?: unknown;
    creditCardJson?: unknown;
    bnplJson?: unknown;
    walletJson?: unknown;
    gatewayJson?: unknown;
}

export function CreateLedgerDialog({
    open,
    onOpenChange,
    onCreated,
    groups: groupsProp,
    defaultGroupId = null,
    defaultName = "",
}: {
    open: boolean;
    onOpenChange: (v: boolean) => void;
    onCreated: (account: CreatedLedger) => void;
    /** Group list to pick from. Fetched here when the caller has none. */
    groups?: GroupOption[];
    /** Pre-select this group when the dialog opens. */
    defaultGroupId?: number | null;
    /** Pre-fill the name — what the user had already typed in the picker. */
    defaultName?: string;
}) {
    const [fetchedGroups, setFetchedGroups] = useState<GroupOption[]>([]);
    const groups = groupsProp ?? fetchedGroups;
    const [saving, setSaving] = useState(false);
    const [form, setForm] = useState<{
        name: string;
        aliases: string;
        groupId: number | null;
        description: string;
        openingBalance: string;
        openingBalanceType: "DEBIT" | "CREDIT";
    }>({
        name: "",
        aliases: "",
        groupId: null,
        description: "",
        openingBalance: "",
        openingBalanceType: "DEBIT",
    });
    const [particulars, setParticulars] = useState<ParticularsState>(emptyParticulars);

    // Reset to a blank form whenever the dialog opens.
    useEffect(() => {
        if (!open) return;
        setForm({
            name: defaultName,
            aliases: "",
            groupId: defaultGroupId ?? null,
            description: "",
            openingBalance: "",
            openingBalanceType: "DEBIT",
        });
        setParticulars(emptyParticulars());
    }, [open, defaultGroupId, defaultName]);

    // Only fetch the group list when the caller didn't hand one over.
    useEffect(() => {
        if (!open || groupsProp) return;
        loadGroupOptions()
            .then(setFetchedGroups)
            .catch(() => { /* group list is optional */ });
    }, [open, groupsProp]);

    const selectedGroup = groups.find((g) => g.id === form.groupId);

    const save = async () => {
        if (!form.name.trim()) { toast.error("Name is required"); return; }
        if (!form.groupId) { toast.error("Group is required"); return; }

        // Opening balance is optional. The Dr/Cr select always holds a value, so
        // the amount alone decides whether an opening balance was entered.
        // Universal opening — no date; always effective from the start of the books.
        const obAmount = form.openingBalance.trim();
        const hasOpening = obAmount !== "";
        if (hasOpening) {
            const amount = Number(obAmount);
            if (!Number.isFinite(amount) || amount <= 0) {
                toast.error("Opening balance must be greater than zero");
                return;
            }
        }

        setSaving(true);
        try {
            // normalBalance is left unset → inherited from the group's nature
            // (loadNormalBalanceMap infers it from group.type at read time).
            const aliases = parseAliasInput(form.aliases);
            const payload: Record<string, unknown> = {
                name: form.name.trim(),
                aliases,
                groupId: form.groupId,
                description: form.description.trim() || null,
                ...particularsPayload(selectedGroup?.name, particulars),
            };
            if (hasOpening) {
                payload.openingBalance = Number(obAmount);
                payload.openingBalanceType = form.openingBalanceType;
            }
            const r = await axios.post<CreatedLedger>("/api/accountancy/ledgers", payload);
            toast.success("Ledger created");
            onCreated({ ...r.data, aliases });
            onOpenChange(false);
        } catch (err: unknown) {
            toast.error(extractApiError(err, "Failed to create ledger"));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-y-auto">
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
                    <div className="space-y-1.5 col-span-2">
                        <Label>
                            Keywords <span className="font-normal text-muted-foreground">— optional, comma separated</span>
                        </Label>
                        <Input
                            value={form.aliases}
                            onChange={(e) => setForm((f) => ({ ...f, aliases: e.target.value }))}
                            placeholder="SBI, State Bank"
                            onKeyDown={(e) => { if (e.key === "Enter") save(); }}
                        />
                        <p className="text-[11px] text-muted-foreground">
                            Alternate names to find this ledger while typing — the same keyword can
                            sit on more than one ledger. Printing always uses the name above.
                        </p>
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
                            Opening Balance <span className="font-normal text-muted-foreground">— optional</span>
                        </p>
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
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
                        </div>
                    </div>

                    <LedgerParticularsFields
                        groupName={selectedGroup?.name}
                        value={particulars}
                        onChange={(key, next) => setParticulars((p) => ({ ...p, [key]: next }))}
                    />
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
