"use client";

// Create a new account group — posts to /api/accountancy/account-groups.
// Runs in a dialog rather than inline so opening it doesn't push the group
// tree table down the page (was the inline form on Masters -> Account Groups).

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

type GroupType = "ASSET" | "LIABILITY" | "INCOME" | "EXPENSE";

export interface ParentGroupOption {
    id: number;
    name: string;
    type: GroupType;
}

const TYPE_COLORS: Record<GroupType, string> = {
    ASSET: "bg-blue-50 text-blue-700 border-blue-200",
    LIABILITY: "bg-purple-50 text-purple-700 border-purple-200",
    INCOME: "bg-green-50 text-green-700 border-green-200",
    EXPENSE: "bg-red-50 text-red-700 border-red-200",
};

const TYPE_LABELS: Record<GroupType, string> = {
    ASSET: "Asset", LIABILITY: "Liability", INCOME: "Income", EXPENSE: "Expense",
};

export function CreateGroupDialog({
    open,
    onOpenChange,
    groups,
    onCreated,
}: {
    open: boolean;
    onOpenChange: (v: boolean) => void;
    /** Flat group list — used as the "Under (parent group)" picker. */
    groups: ParentGroupOption[];
    onCreated: () => void;
}) {
    const [saving, setSaving] = useState(false);
    // "none" sentinel instead of "" — SelectItem disallows an empty string value.
    const [name, setName] = useState("");
    const [type, setType] = useState<GroupType>("ASSET");
    const [parent, setParent] = useState<string>("none");
    const [sortOrder, setSortOrder] = useState("0");

    useEffect(() => {
        if (!open) return;
        setName(""); setType("ASSET"); setParent("none"); setSortOrder("0");
    }, [open]);

    const parentGroup = parent !== "none" ? groups.find((g) => g.id === Number(parent)) : null;
    const effectiveType = parentGroup ? parentGroup.type : type;

    const save = async () => {
        if (!name.trim()) { toast.error("Name is required"); return; }
        setSaving(true);
        try {
            await axios.post("/api/accountancy/account-groups", {
                name: name.trim(),
                type,
                parentId: parent !== "none" ? Number(parent) : null,
                sortOrder: Number(sortOrder) || 0,
            });
            toast.success("Group created");
            onOpenChange(false);
            onCreated();
        } catch (err: unknown) {
            toast.error(extractApiError(err, "Failed to create group"));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>New Account Group</DialogTitle>
                    <DialogDescription>
                        A sub-group inherits its accounting type from its parent.
                    </DialogDescription>
                </DialogHeader>

                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                        <Label>Name</Label>
                        <Input
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Group name"
                            autoFocus
                            onKeyDown={(e) => { if (e.key === "Enter") save(); }}
                        />
                    </div>
                    <div className="space-y-1.5">
                        <Label>Under (parent group)</Label>
                        <Select value={parent} onValueChange={setParent}>
                            <SelectTrigger><SelectValue placeholder="Primary (no parent)" /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="none">Primary (no parent)</SelectItem>
                                {groups.map((g) => (
                                    <SelectItem key={g.id} value={String(g.id)}>{g.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-1.5">
                        <Label>Type</Label>
                        {parentGroup ? (
                            <div className="flex items-center gap-2 h-9 px-3 rounded-md border border-input bg-muted text-sm text-muted-foreground">
                                <span className={`text-xs px-2 py-0.5 border font-medium rounded-sm ${TYPE_COLORS[effectiveType]}`}>
                                    {TYPE_LABELS[effectiveType]}
                                </span>
                                <span className="text-xs">inherited from parent</span>
                            </div>
                        ) : (
                            <Select value={type} onValueChange={(v) => setType(v as GroupType)}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="ASSET">Asset</SelectItem>
                                    <SelectItem value="LIABILITY">Liability</SelectItem>
                                    <SelectItem value="INCOME">Income</SelectItem>
                                    <SelectItem value="EXPENSE">Expense</SelectItem>
                                </SelectContent>
                            </Select>
                        )}
                    </div>
                    <div className="space-y-1.5">
                        <Label>Sort Order</Label>
                        <Input
                            type="text"
                            inputMode="numeric"
                            value={sortOrder}
                            onChange={(e) => setSortOrder(e.target.value)}
                            placeholder="0"
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
