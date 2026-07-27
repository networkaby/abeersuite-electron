"use client";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { TallyDateInput } from "@/shared/components/TallyDateInput";

export interface BranchOption { id: string; name: string }

/** Shared period + branch filter row for every BI report page. */
export function BiFilterBar({
    from, to, branchId, branches, onFrom, onTo, onBranch, onRefresh, right,
}: {
    from: string;
    to: string;
    branchId: string;
    branches: BranchOption[];
    onFrom: (v: string) => void;
    onTo: (v: string) => void;
    onBranch: (v: string) => void;
    onRefresh: () => void;
    right?: React.ReactNode;
}) {
    return (
        <div className="flex items-end gap-2 flex-wrap">
            {right}
            <div className="space-y-1">
                <Label>From</Label>
                <TallyDateInput value={from} onValueChange={onFrom} className="w-auto" />
            </div>
            <div className="space-y-1">
                <Label>To</Label>
                <TallyDateInput value={to} onValueChange={onTo} monthMode="end" className="w-auto" />
            </div>
            <div className="space-y-1">
                <Label>Branch</Label>
                <select
                    value={branchId}
                    onChange={(e) => onBranch(e.target.value)}
                    className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                >
                    <option value="">All branches</option>
                    {branches.map((b) => (
                        <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                </select>
            </div>
            <Button onClick={onRefresh}>Refresh</Button>
        </div>
    );
}
