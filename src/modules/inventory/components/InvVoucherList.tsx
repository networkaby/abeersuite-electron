"use client";
// Shared list view for inventory voucher registers (Sales Order, Purchase
// Order, GRN, Challan, Manufacturing Journal, Physical Stock, Rejection
// In/Out, Branch Transfer).
//
// Renders via the shared <VoucherRegisterTable> so every register inherits
// the same row markup, click-to-edit Reference link, ⋮ action menu, and
// Restore + Hard-Delete UX on soft-deleted rows.

import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import Link from "next/link";
import { toast } from "sonner";
import { Plus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    VoucherRegisterTable,
    type VoucherRegisterRow,
} from "@/modules/accountancy/components/VoucherRegisterTable";
import {
    useRegisterFilters,
    applyRegisterFilters,
} from "@/modules/accountancy/hooks/useRegisterFilters";
import { RegisterFilterBar } from "@/modules/accountancy/components/RegisterFilterBar";
import type { InvVoucherKind } from "./InvVoucherForm";

export type InvVoucherListKind = InvVoucherKind | "BRANCH_TRANSFER";

type ListRow = {
    id:           number;
    type?:        string;
    reference:    string;
    date:         string;
    description:  string;
    partyName:    string | null;
    totalAmount:  number;
    status:       "DRAFT" | "POSTED" | "CANCELLED";
    deletedAt:    string | null;
    cancelledAt?: string | null;
    branch?:      { id: string; name: string } | null;
    _count:       { lines: number };
    createdBy:    { name: string };
};

export function InvVoucherList({
    type, title, subtitle, basePath, newPath,
}: {
    type:     InvVoucherListKind;
    title:    string;
    subtitle: string;
    /** Unused — kept for call-site compatibility. The shared table builds
     *  the reference link via referenceHref() now. */
    basePath: string;
    /** Omit to hide the "New" button (read-only registers). */
    newPath?: string;
}) {
    void basePath;
    const [allRows, setAllRows] = useState<VoucherRegisterRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [tick, setTick]       = useState(0);
    const reload                = useCallback(() => setTick((t) => t + 1), []);

    const filters = useRegisterFilters(`reg:${type}`);

    useEffect(() => {
        setLoading(true);
        const params = new URLSearchParams({ type });
        if (filters.showDeleted) params.set("includeDeleted", "1");

        axios.get<ListRow[]>(`/api/inventory/vouchers?${params}`)
            .then((r) => {
                const mapped: VoucherRegisterRow[] = (r.data ?? []).map((v) => ({
                    id:          `inv-${v.id}`,
                    rawId:       v.id,
                    source:      "inv",
                    kind:        v.type ?? type,
                    reference:   v.reference,
                    date:        v.date,
                    party:       v.partyName,
                    narration:   v.description,
                    totalAmount: Number(v.totalAmount),
                    status:      v.status,
                    deletedAt:   v.deletedAt ?? null,
                    cancelledAt: v.cancelledAt ?? null,
                    branchId:    v.branch?.id   ?? null,
                    branchName:  v.branch?.name ?? null,
                    createdBy:   v.createdBy?.name ?? null,
                }));
                setAllRows(mapped);
            })
            .catch(() => toast.error("Failed to load"))
            .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [type, filters.showDeleted, tick]);

    const availableBranches = useMemo(() => {
        const seen = new Map<string, string>();
        for (const r of allRows) {
            if (r.branchId && r.branchName) seen.set(r.branchId, r.branchName);
        }
        return [...seen.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
    }, [allRows]);

    const filtered = useMemo(
        () => applyRegisterFilters(allRows, filters),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [allRows, filters.from, filters.to, filters.search, filters.statuses, filters.showDeleted, filters.branchFilter],
    );

    const postedTotal = useMemo(
        () => filtered.filter((r) => r.status === "POSTED").reduce((s, r) => s + r.totalAmount, 0),
        [filtered],
    );

    return (
        <div className="max-w-5xl mx-auto space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold">{title}</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>
                </div>
                {newPath && (
                    <Link href={newPath}>
                        <Button><Plus size={16} /> New {title.replace(/s$/, "")}</Button>
                    </Link>
                )}
            </div>

            <RegisterFilterBar
                {...filters}
                availableBranches={availableBranches}
                rowCount={filtered.length}
                totalRows={allRows.length}
                postedTotal={postedTotal}
                onReload={reload}
                onClearFilters={filters.clearFilters}
            />

            {loading ? (
                <div className="flex justify-center py-12">
                    <Loader2 className="animate-spin text-muted-foreground" size={28} />
                </div>
            ) : (
                <VoucherRegisterTable
                    rows={filtered}
                    onChanged={reload}
                    hideKind
                    statusInline
                    showBranch={availableBranches.length > 0}
                    emptyMessage={
                        filters.showDeleted
                            ? `No deleted ${title.toLowerCase()}.`
                            : `No ${title.toLowerCase()} yet.`
                    }
                />
            )}
        </div>
    );
}
