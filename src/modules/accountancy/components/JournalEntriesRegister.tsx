"use client";

// Reusable Journal Entries register — used by /vouchers/journal-entries.
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

interface RawEntry {
    id:           number | string;
    reference:    string;
    date:         string;
    description:  string | null;
    status:       "DRAFT" | "POSTED" | "CANCELLED";
    totalAmount?: number | string;
    totalDebit?:  number | string;
    deletedAt?:   string | null;
    cancelledAt?: string | null;
    createdBy:    { name: string };
}

export function JournalEntriesRegister() {
    const [allRows, setAllRows] = useState<VoucherRegisterRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [tick, setTick]       = useState(0);
    const reload                = useCallback(() => setTick((t) => t + 1), []);

    const filters = useRegisterFilters("reg:JOURNAL");

    useEffect(() => {
        setLoading(true);
        const params = new URLSearchParams();
        if (filters.showDeleted) params.set("includeDeleted", "1");

        axios.get<RawEntry[] | { rows: RawEntry[] }>(`/api/accountancy/journal-entries?${params}`)
            .then((r) => {
                const arr: RawEntry[] = Array.isArray(r.data)
                    ? r.data
                    : (r.data as { rows: RawEntry[] }).rows ?? [];
                const mapped: VoucherRegisterRow[] = arr.map((e) => ({
                    id:          `je-${e.id}`,
                    rawId:       Number(e.id),
                    source:      "je",
                    kind:        "JOURNAL",
                    reference:   e.reference,
                    date:        e.date,
                    party:       null,
                    narration:   e.description,
                    totalAmount: Number(e.totalDebit ?? e.totalAmount ?? 0),
                    status:      e.status,
                    deletedAt:   e.deletedAt ?? null,
                    cancelledAt: e.cancelledAt ?? null,
                    createdBy:   e.createdBy?.name ?? null,
                }));
                setAllRows(mapped);
            })
            .catch(() => toast.error("Failed to load journal entries"))
            .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filters.showDeleted, tick]);

    const filtered = useMemo(
        () => applyRegisterFilters(allRows, filters),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [allRows, filters.from, filters.to, filters.search, filters.statuses, filters.showDeleted],
    );

    const postedTotal = useMemo(
        () => filtered.filter((r) => r.status === "POSTED").reduce((s, r) => s + r.totalAmount, 0),
        [filtered],
    );

    return (
        <div className="max-w-5xl mx-auto space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-foreground">Journal Entries</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        Double-entry GL adjustments with optional inventory attachment
                    </p>
                </div>
                <Link href="/vouchers/journal-entries/new">
                    <Button><Plus size={16} /> New Journal Entry</Button>
                </Link>
            </div>

            <RegisterFilterBar
                {...filters}
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
                    emptyMessage={
                        filters.showDeleted
                            ? "No deleted journal entries."
                            : "No journal entries yet."
                    }
                />
            )}
        </div>
    );
}
