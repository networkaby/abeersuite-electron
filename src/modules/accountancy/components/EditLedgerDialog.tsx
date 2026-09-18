"use client";

// Edit an existing ledger account (name, parent group, group-specific
// particulars, opening balance) — PATCHes /api/accountancy/ledgers/[id].
// Used by Accountancy → Masters → Ledgers and by the Bank/Cash/Loans Book and
// Account Ledger explorers, so a ledger can be corrected without navigating
// away from the register. The particulars blocks come from PARTICULARS_SPECS,
// shared with CreateLedgerDialog.

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { extractApiError } from "@/shared/lib/api";
import { Loader2, ListTree } from "lucide-react";
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
import { OpeningBillsDialog } from "@/modules/accountancy/components/OpeningBillsDialog";
import { LedgerParticularsFields } from "@/modules/accountancy/components/LedgerParticularsFields";
import {
    emptyParticulars, parseParticulars, particularsPayload,
    type ParticularsState,
} from "@/modules/accountancy/lib/ledgerParticulars";
import {
    loadGroupOptions, type GroupOption,
} from "@/modules/accountancy/lib/groupOptions";
import { formatAliasInput, parseAliasInput } from "@/modules/accountancy/lib/accountAlias";

export interface EditableLedger {
    id: number;
    name: string;
    /** Alternate names, as returned flattened by the ledger routes. */
    aliases?: string[];
    groupId: number | null;
    bankJson?: unknown;
    loanJson?: unknown;
    creditCardJson?: unknown;
    bnplJson?: unknown;
    walletJson?: unknown;
    gatewayJson?: unknown;
    openingBalance?: number | null;
    openingBalanceType?: "DEBIT" | "CREDIT" | null;
}

export function EditLedgerDialog({
    open,
    onOpenChange,
    ledger,
    groups: groupsProp,
    onSaved,
}: {
    open: boolean;
    onOpenChange: (v: boolean) => void;
    /** Account being edited. Dialog stays closed (no-op save) if null. */
    ledger: EditableLedger | null;
    /** Group list to pick from. Fetched here when the caller has none. */
    groups?: GroupOption[];
    /** Fired after a successful save. The new name comes along so a caller
     *  holding its own copy of the row (a voucher picker) can re-label it
     *  without waiting for its list to re-read. */
    onSaved: (updated?: { id: number; name: string }) => void;
}) {
    const [fetchedGroups, setFetchedGroups] = useState<GroupOption[]>([]);
    const groups = groupsProp ?? fetchedGroups;
    const [saving, setSaving] = useState(false);

    const [name, setName] = useState("");
    const [aliases, setAliases] = useState("");
    const [groupId, setGroupId] = useState<number | null>(null);
    const [particulars, setParticulars] = useState<ParticularsState>(emptyParticulars);
    const [billsOpen, setBillsOpen] = useState(false);
    const [openingBalance, setOpeningBalance] = useState("");
    const [openingBalanceType, setOpeningBalanceType] = useState<"DEBIT" | "CREDIT">("DEBIT");

    // Reset the form from the target ledger whenever the dialog opens.
    useEffect(() => {
        if (!open || !ledger) return;
        setName(ledger.name);
        setAliases(formatAliasInput(ledger.aliases ?? []));
        setGroupId(ledger.groupId);
        setParticulars(parseParticulars(ledger as unknown as Record<string, unknown>));
        setOpeningBalance(ledger.openingBalance ? String(ledger.openingBalance) : "");
        setOpeningBalanceType(ledger.openingBalanceType ?? "DEBIT");
    }, [open, ledger]);

    // Only fetch the group list when the caller didn't hand one over.
    useEffect(() => {
        if (!open || groupsProp) return;
        loadGroupOptions()
            .then(setFetchedGroups)
            .catch(() => { /* group list is optional */ });
    }, [open, groupsProp]);

    const selectedGroupName = groups.find((g) => g.id === groupId)?.name;

    const save = async () => {
        if (!ledger) return;
        if (!name.trim()) { toast.error("Name is required"); return; }
        const hasOpening = openingBalance.trim() !== "";
        const amount = Number(openingBalance);
        if (hasOpening && (!Number.isFinite(amount) || amount < 0)) {
            toast.error("Opening balance must be a valid non-negative number");
            return;
        }

        setSaving(true);
        try {
            const payload: Record<string, unknown> = {
                name: name.trim(),
                // Only sent when the caller handed us the current aliases. A
                // surface that doesn't load them must not clear them — omitting
                // the key leaves them untouched (the route treats [] as "clear").
                ...(ledger.aliases !== undefined ? { aliases: parseAliasInput(aliases) } : {}),
                groupId,
                // Particulars for kinds the chosen group doesn't match are sent
                // as null, so moving a ledger between groups clears the stale set.
                ...particularsPayload(selectedGroupName, particulars),
                openingBalance: hasOpening ? amount : null,
                openingBalanceType: hasOpening ? openingBalanceType : null,
            };
            await axios.patch(`/api/accountancy/ledgers/${ledger.id}`, payload);
            toast.success("Ledger updated");
            onOpenChange(false);
            onSaved({ id: ledger.id, name: name.trim() });
        } catch (err: unknown) {
            toast.error(extractApiError(err, "Failed to update ledger"));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Edit Ledger Account</DialogTitle>
                    <DialogDescription>
                        Update the ledger&apos;s name, group, particulars, or opening balance.
                    </DialogDescription>
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
                        <Label>
                            Keywords <span className="font-normal text-muted-foreground">— optional, comma separated</span>
                        </Label>
                        <Input
                            value={aliases}
                            onChange={(e) => setAliases(e.target.value)}
                            placeholder="SBI, State Bank"
                            onKeyDown={(e) => { if (e.key === "Enter") save(); }}
                        />
                        <p className="text-[11px] text-muted-foreground">
                            Alternate names to find this ledger while typing — the same keyword can
                            sit on more than one ledger. Printing always uses the name above.
                        </p>
                    </div>
                    <div className="space-y-1.5 col-span-2">
                        <Label>Under (Group)</Label>
                        <GroupCombobox value={groupId} onChange={setGroupId} groups={groups} />
                    </div>
                    <div className="col-span-2 space-y-3 rounded-md border border-border bg-muted/30 p-4">
                        <p className="text-sm font-medium text-foreground">
                            Opening Balance <span className="font-normal text-muted-foreground">— leave blank to clear</span>
                        </p>
                        {/* For a party, one figure is rarely one bill. Breaking it up
                            lets each piece age and be settled on its own; the dialog
                            itself says so when this ledger is not a party. */}
                        {ledger && (
                            <Button
                                type="button" size="sm" variant="outline"
                                className="mb-3"
                                onClick={() => setBillsOpen(true)}
                            >
                                <ListTree size={14} className="mr-1" /> Bill-wise details
                            </Button>
                        )}
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

                    <LedgerParticularsFields
                        groupName={selectedGroupName}
                        value={particulars}
                        onChange={(key, next) => setParticulars((p) => ({ ...p, [key]: next }))}
                    />
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button onClick={save} disabled={saving}>
                        {saving && <Loader2 size={14} className="animate-spin" />} Save
                    </Button>
                </DialogFooter>
            </DialogContent>

            {billsOpen && ledger && (
                <OpeningBillsDialog
                    open
                    onOpenChange={(v) => { if (!v) setBillsOpen(false); }}
                    accountId={ledger.id}
                    onSaved={onSaved}
                />
            )}
        </Dialog>
    );
}
