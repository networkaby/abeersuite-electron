"use client";

// Reusable Journal Entries register — used by /vouchers/journal-entries.
// Renders via the canonical <VoucherRegisterTable> for uniform behaviour.

import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import Link from "next/link";
import { toast } from "sonner";
import { Plus, Loader2 } from "lucide-react";
import { formatUvNo } from "@/shared/lib/accountancy/uvNo";
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
import { useRealtimeTopics } from "@/shared/hooks/useRealtimeTopics";
import { useRegisterReads } from "@/shared/hooks/useRegisterReads";

interface RawEntry {
    id:           number | string;
    voucherNo:    string | null;
    date:         string;
    description:  string | null;
    status:       "DRAFT" | "POSTED" | "CANCELLED";
    totalAmount?: number | string;
    totalDebit?:  number | string;
    cancelledAt?: string | null;
    createdAt:    string;
    sourceCreatedAt:    string | null;
    sourceCounterId:    number | null;
    createdById:  number;
    branchId:     string | null;
    createdBy:    { name: string };
}

export function JournalEntriesRegister() {
    const [allRows, setAllRows] = useState<VoucherRegisterRow[]>([]);

    // This register is only ever journals, so there is no second identity its
    // rows could be mistaken for - unlike GlVoucherList, which is one component
    // serving five.
    const { tick, loading, reload, refreshSilently, beginRead, endRead } = useRegisterReads();

    // A journal posted at another counter appears here on its own.
    useRealtimeTopics(["ledger"], refreshSilently);

    const filters = useRegisterFilters("reg:JOURNAL");

    useEffect(() => {
        beginRead();
        const params = new URLSearchParams();

        axios.get<RawEntry[] | { rows: RawEntry[] }>(`/api/accountancy/journal-entries?${params}`)
            .then((r) => {
                const arr: RawEntry[] = Array.isArray(r.data)
                    ? r.data
                    : (r.data as { rows: RawEntry[] }).rows ?? [];
                const mapped: VoucherRegisterRow[] = arr.map((e) => ({
                    id:             `je-${e.id}`,
                    rawId:          Number(e.id),
                    sortId:         Number(e.id),
                    source:         "je",
                    kind:           "JOURNAL",
                    reference:      e.voucherNo ?? formatUvNo(Number(e.id)),
                    date:           e.date,
                    party:          null,
                    partyAccountId: null,
                    partyKind:      null,
                    partyEntityId:  null,
                    narration:      e.description,
                    totalAmount:    Number(e.totalDebit ?? e.totalAmount ?? 0),
                    status:         e.status,
                    cancelledAt:    e.cancelledAt ?? null,
                    createdAt:      e.createdAt,
                    sourceCreatedAt:      e.sourceCreatedAt ?? null,
                    sourceCounterId:      e.sourceCounterId ?? null,
                    createdById:    e.createdById,
                    branchId:       e.branchId ?? null,
                    branchName:     null,
                    createdBy:      e.createdBy?.name ?? null,
                    converted:      false,
                }));
                setAllRows(mapped);
            })
            .catch(() => toast.error("Failed to load journal entries"))
            .finally(endRead);
    }, [tick, beginRead, endRead]);

    const filtered = useMemo(
        () => applyRegisterFilters(allRows, filters),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [allRows, filters.from, filters.to, filters.search, filters.statuses],
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
                refreshing={loading}
            />

            {/* Only while there is nothing to show. A voucher posted at another
                counter refreshes these rows in place, and Refresh spins its own
                icon in the bar above - neither has to empty the register to prove
                it happened (AGENTS.md §7). */}
            {loading && allRows.length === 0 ? (
                <div className="flex justify-center py-12">
                    <Loader2 className="animate-spin text-muted-foreground" size={28} />
                </div>
            ) : (
                <VoucherRegisterTable
                    rows={filtered}
                    onChanged={reload}
                    hideKind
                    statusInline
                    emptyMessage="No journal entries yet."
                />
            )}
        </div>
    );
}
