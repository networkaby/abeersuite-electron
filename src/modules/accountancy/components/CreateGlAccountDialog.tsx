"use client";

// Create a new GL account (Chart of Accounts) — posts to
// /api/accountancy/gl-accounts. Runs in a dialog rather than inline so
// opening it doesn't push the account sections down the page (was the
// inline form on Masters -> Chart of Accounts).

import { useState } from "react";
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
import { defaultNormalBalanceForGroupType, type GroupTypeStr } from "@/modules/accountancy/lib/groupNature";
import { useValueChange } from "@/shared/hooks/useValueChange";

type NormalBalance = "DEBIT" | "CREDIT";

export interface GlAccountGroupOption {
    id: number;
    name: string;
    type: GroupTypeStr;
}

export function CreateGlAccountDialog({
    open,
    onOpenChange,
    groups,
    onCreated,
}: {
    open: boolean;
    onOpenChange: (v: boolean) => void;
    /** Group list — used as the "Group" picker. */
    groups: GlAccountGroupOption[];
    onCreated: () => void;
}) {
    const [saving, setSaving] = useState(false);
    const [form, setForm] = useState({
        name: "", groupId: 0,
        normalBalance: "DEBIT" as NormalBalance, description: "",
    });

    // Each open starts blank — reset while rendering, so the last entry never paints.
    if (useValueChange(open, false) && open) {
        setForm({ name: "", groupId: 0, normalBalance: "DEBIT", description: "" });
    }

    const save = async () => {
        if (!form.name || !form.groupId) {
            toast.error("Name and group required");
            return;
        }
        setSaving(true);
        try {
            await axios.post("/api/accountancy/gl-accounts", form);
            toast.success("Account created");
            onOpenChange(false);
            onCreated();
        } catch (err: unknown) {
            toast.error(extractApiError(err, "Failed to create account"));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>New GL Account</DialogTitle>
                    <DialogDescription>
                        Add an account directly to the general ledger — no person/company linkage.
                    </DialogDescription>
                </DialogHeader>

                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                        <Label>Name</Label>
                        <Input
                            value={form.name}
                            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                            placeholder="Account name"
                            onKeyDown={(e) => { if (e.key === "Enter") save(); }}
                            autoFocus
                        />
                    </div>
                    <div className="space-y-1.5">
                        <Label>Group</Label>
                        <Select
                            value={form.groupId ? String(form.groupId) : ""}
                            onValueChange={(v) => {
                                const g = groups.find((x) => x.id === Number(v));
                                if (!g) return;
                                setForm((f) => ({
                                    ...f,
                                    groupId: g.id,
                                    normalBalance: defaultNormalBalanceForGroupType(g.type),
                                }));
                            }}
                        >
                            <SelectTrigger><SelectValue placeholder="Pick a group" /></SelectTrigger>
                            <SelectContent>
                                {groups.map((g) => (
                                    <SelectItem key={g.id} value={String(g.id)}>
                                        {g.name} <span className="text-xs text-muted-foreground ml-1">({g.type})</span>
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-1.5">
                        <Label>Normal Balance</Label>
                        <Select
                            value={form.normalBalance}
                            onValueChange={(v) => setForm((f) => ({ ...f, normalBalance: v as NormalBalance }))}
                        >
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="DEBIT">DEBIT</SelectItem>
                                <SelectItem value="CREDIT">CREDIT</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="col-span-2 space-y-1.5">
                        <Label>Description</Label>
                        <Input
                            value={form.description}
                            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                            placeholder="Optional"
                        />
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
