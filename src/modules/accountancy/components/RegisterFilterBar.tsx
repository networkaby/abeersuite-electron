"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TallyDateInput } from "@/shared/components/TallyDateInput";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { fmt } from "@/utils/constants";
import type { DatePreset } from "@/modules/accountancy/hooks/useRegisterFilters";

const STATUS_OPTS = ["DRAFT", "POSTED", "CANCELLED"] as const;

type Props = {
    preset: DatePreset;
    setPreset: (p: DatePreset) => void;
    from: string;
    handleFrom: (v: string) => void;
    to: string;
    handleTo: (v: string) => void;
    search: string;
    setSearch: (v: string) => void;
    statuses: Set<string>;
    toggleStatus: (s: string) => void;
    clearStatuses: () => void;
    /** Branch filter — only rendered when availableBranches is non-empty */
    branchFilter?: string;
    setBranchFilter?: (v: string) => void;
    availableBranches?: { id: string; name: string }[];
    /** Filtered (visible) row count */
    rowCount: number;
    /** Total rows before client-side filter */
    totalRows: number;
    /** Sum of totalAmount for POSTED rows in filtered set */
    postedTotal: number;
    onReload: () => void;
    onClearFilters: () => void;
};

export function RegisterFilterBar({
    preset, setPreset, from, handleFrom, to, handleTo,
    search, setSearch, statuses, toggleStatus, clearStatuses,
    branchFilter, setBranchFilter, availableBranches,
    rowCount, totalRows, postedTotal, onReload, onClearFilters,
}: Props) {
    const hiddenCount = totalRows - rowCount;
    const hasBranches = availableBranches && availableBranches.length > 0;

    return (
        <div className="space-y-0">
            <div className="flex flex-wrap items-end gap-x-4 gap-y-3 rounded-lg border bg-card p-3">

                {/* Period preset + date range */}
                <div className="flex items-end gap-2">
                    <div className="flex flex-col gap-1">
                        <label className="text-xs font-medium text-muted-foreground">Period</label>
                        <Select value={preset} onValueChange={(v) => setPreset(v as DatePreset)}>
                            <SelectTrigger className="h-8 w-34">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="today">Today</SelectItem>
                                <SelectItem value="yesterday">Yesterday</SelectItem>
                                <SelectItem value="last7">Last 7 days</SelectItem>
                                <SelectItem value="thisMonth">This month</SelectItem>
                                <SelectItem value="thisFY">This FY</SelectItem>
                                <SelectItem value="custom">Custom</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="flex flex-col gap-1">
                        <label className="text-xs font-medium text-muted-foreground">From</label>
                        <TallyDateInput value={from} onValueChange={handleFrom} className="h-8 w-36" />
                    </div>
                    <span className="pb-1.5 text-xs text-muted-foreground">→</span>
                    <div className="flex flex-col gap-1">
                        <label className="text-xs font-medium text-muted-foreground">To</label>
                        <TallyDateInput value={to} onValueChange={handleTo} monthMode="end" className="h-8 w-36" />
                    </div>
                </div>

                {/* Search */}
                <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-muted-foreground">Search</label>
                    <Input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="ref / party / narration"
                        className="h-8 w-52"
                    />
                </div>

                {/* Branch filter — only when branches are present */}
                {hasBranches && setBranchFilter && (
                    <div className="flex flex-col gap-1">
                        <label className="text-xs font-medium text-muted-foreground">Branch</label>
                        <Select value={branchFilter ?? "__all__"} onValueChange={setBranchFilter}>
                            <SelectTrigger className="h-8 w-40">
                                <SelectValue placeholder="All branches" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="__all__">All branches</SelectItem>
                                {availableBranches!.map((b) => (
                                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                )}

                {/* Status checkboxes */}
                <div className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-muted-foreground">Status</span>
                    <div className="flex h-8 items-center gap-3">
                        <div className="flex items-center gap-1.5">
                            <Checkbox
                                id="rf-status-all"
                                checked={statuses.size === 0}
                                onCheckedChange={clearStatuses}
                            />
                            <Label htmlFor="rf-status-all" className="cursor-pointer text-xs">All</Label>
                        </div>
                        {STATUS_OPTS.map((s) => (
                            <div key={s} className="flex items-center gap-1.5">
                                <Checkbox
                                    id={`rf-status-${s}`}
                                    checked={statuses.has(s)}
                                    onCheckedChange={() => toggleStatus(s)}
                                />
                                <Label htmlFor={`rf-status-${s}`} className="cursor-pointer text-xs">
                                    {s.charAt(0) + s.slice(1).toLowerCase()}
                                </Label>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Summary + reload */}
                <div className="ml-auto flex items-end gap-3">
                    <div className="text-right">
                        <div className="text-xs text-muted-foreground">{rowCount} of {totalRows} rows</div>
                        <div className="text-sm font-mono font-medium">Posted ₹ {fmt(postedTotal)}</div>
                    </div>
                    <Button variant="outline" size="sm" onClick={onReload}>Refresh</Button>
                </div>
            </div>

            {/* Hidden-rows banner */}
            {hiddenCount > 0 && (
                <div className="flex items-center gap-3 rounded-b-lg border border-t-0 bg-amber-50 px-4 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                    <span className="font-medium">
                        {rowCount === 0
                            ? `All ${totalRows} voucher${totalRows === 1 ? "" : "s"} are hidden by the current filters.`
                            : `${hiddenCount} of ${totalRows} vouchers are hidden by the current filters.`}
                    </span>
                    <Button variant="outline" size="xs" className="h-6 text-xs" onClick={onClearFilters}>
                        Clear filters (show all this FY)
                    </Button>
                </div>
            )}
        </div>
    );
}
