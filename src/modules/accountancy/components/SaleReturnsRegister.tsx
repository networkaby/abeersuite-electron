"use client";

// Reusable Sale Returns register — used by /vouchers/sale-returns.
// Renders via the canonical <VoucherRegisterTable> for uniform behaviour.

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

interface RawVoucher {
    id:           number;
    reference:    string;
    date:         string;
    description:  string;
    status:       "DRAFT" | "POSTED" | "CANCELLED";
    partyName:    string | null;
    totalAmount:  number | string;
    deletedAt?:   string | null;
    cancelledAt?: string | null;
    branch?:      { id: string; name: string } | null;
    _count:       { lines: number };
    createdBy:    { name: string };
}

interface Row extends VoucherRegisterRow {
    lineCount: number;
}

export function SaleReturnsRegister() {
    const [allRows, setAllRows] = useState<Row[]>([]);
    const [loading, setLoading] = useState(true);
    const [tick, setTick]       = useState(0);
    const reload                = useCallback(() => setTick((t) => t + 1), []);

    const filters = useRegisterFilters("reg:SALE_RETURN");

    useEffect(() => {
        setLoading(true);
        const params = new URLSearchParams({ type: "SALE_RETURN" });
        if (filters.showDeleted) params.set("includeDeleted", "1");

        axios.get<RawVoucher[]>(`/api/inventory/vouchers?${params}`)
            .then((r) => {
                const mapped: Row[] = (r.data ?? []).map((v) => ({
                    id:          `inv-${v.id}`,
                    rawId:       v.id,
                    source:      "inv",
                    kind:        "SALE_RETURN",
                    reference:   v.reference,
                    date:        v.date,
                    party:       v.partyName,
                    narration:   v.description,
                    totalAmount: Number(v.totalAmount),
                    lineCount:   v._count?.lines ?? 0,
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
    }, [filters.showDeleted, tick]);

    const availableBranches = useMemo(() => {
        const seen = new Map<string, string>();
        for (const r of allRows) {
            if (r.branchId && r.branchName) seen.set(r.branchId, r.branchName);
        }
        return [...seen.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
    }, [allRows]);

    const filtered = useMemo(
        () => applyRegisterFilters(allRows, filters) as Row[],
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
                    <h1 className="text-2xl font-bold text-foreground">Sale Returns</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">Customer returns — stock in, GL reversed</p>
                </div>
                <Link href="/vouchers/sale-returns/new">
                    <Button><Plus size={16} /> New Sale Return</Button>
                </Link>
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
                    extraColumns={[
                        {
                            header:    "Items",
                            className: "px-4 py-3 text-center text-xs font-medium",
                            cell:      (r) => <span className="text-muted-foreground">{(r as Row).lineCount}</span>,
                        },
                    ]}
                    emptyMessage={
                        filters.showDeleted
                            ? "No deleted sale returns."
                            : "No sale returns yet."
                    }
                />
            )}
        </div>
    );
}
