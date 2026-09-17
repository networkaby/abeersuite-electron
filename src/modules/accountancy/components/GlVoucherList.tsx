"use client";
// Shared list view for the five GL voucher kinds (Contra, Payment, Receipt,
// Credit Note, Debit Note). Filters by type and status.
//
// Renders via the shared <VoucherRegisterTable> so every register inherits
// the same row markup, click-to-edit Reference link, 3-dot ⋮ action menu,
// and deleted-row Restore + Hard-Delete UX.

import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import Link from "next/link";
import { toast } from "sonner";
import { formatUvNo } from "@/shared/lib/accountancy/uvNo";
import type { SettlementState } from "@/modules/accountancy/lib/billLink";
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
import { useRealtimeTopics } from "@/shared/hooks/useRealtimeTopics";
import { useRegisterReads } from "@/shared/hooks/useRegisterReads";

export type GlVoucherKind = "CONTRA" | "PAYMENT" | "RECEIPT" | "CREDIT_NOTE" | "DEBIT_NOTE";

type RawRow = {
    id:           number;
    type:         GlVoucherKind;
    voucherNo:    string | null;
    date:         string;
    narration:    string | null;
    totalAmount:  number | string;
    status:       "DRAFT" | "POSTED" | "CANCELLED";
    cancelledAt?: string | null;
    createdAt:    string;
    sourceCreatedAt:    string | null;
    sourceCounterId:    number | null;
    createdById:  number;
    branch:       { id: string; name: string } | null;
    createdBy:    { name: string };
    partyAccount: { id: number; code: string; name: string; personId: number | null; companyId: number | null } | null;
    settlement?:     SettlementState | null;
    settlementOpen?: number;
};

/** Stable empty list, so a register with no rows of its own does not hand a
 *  fresh array to the filter memo on every render. */
const NO_ROWS: VoucherRegisterRow[] = [];

export function GlVoucherList({
    type, title, subtitle, basePath, newPath, newTab = false,
}: {
    type:     GlVoucherKind;
    title:    string;
    subtitle: string;
    basePath: string;
    newPath:  string;
    newTab?:  boolean;
}) {
    void basePath;
    // Rows belong to the register they were read for. Holding the two together
    // means a different `type` empties them in the same render, so one register's
    // vouchers can never sit under another's heading while the fresh read is
    // still in flight - which is what makes it safe to stop hiding them below.
    const [loaded, setLoaded] = useState<{ type: GlVoucherKind; rows: VoucherRegisterRow[] } | null>(null);
    const allRows = loaded?.type === type ? loaded.rows : NO_ROWS;

    const { tick, loading, reload, refreshSilently, beginRead, endRead } = useRegisterReads();

    // A receipt or payment entered at another counter appears here on its own.
    useRealtimeTopics(["ledger"], refreshSilently);

    const filters = useRegisterFilters(`reg:${type}`);

    useEffect(() => {
        beginRead();
        const params = new URLSearchParams({ type });

        axios.get<RawRow[]>(`/api/accountancy/vouchers?${params}`)
            .then((r) => {
                const mapped: VoucherRegisterRow[] = (r.data ?? []).map((v) => ({
                    id:             `gl-${v.id}`,
                    rawId:          v.id,
                    sortId:         v.id,
                    source:         "gl",
                    kind:           v.type,
                    reference:      v.voucherNo ?? formatUvNo(v.id),
                    date:           v.date,
                    party:          v.partyAccount?.name ?? null,
                    partyAccountId: v.partyAccount?.id ?? null,
                    partyKind:      v.partyAccount?.personId != null ? "person" : v.partyAccount?.companyId != null ? "company" : null,
                    partyEntityId:  v.partyAccount?.personId ?? v.partyAccount?.companyId ?? null,
                    narration:      v.narration,
                    totalAmount:    Number(v.totalAmount),
                    status:         v.status,
                    cancelledAt:    v.cancelledAt ?? null,
                    createdAt:      v.createdAt,
                    sourceCreatedAt:      v.sourceCreatedAt ?? null,
                    sourceCounterId:      v.sourceCounterId ?? null,
                    createdById:    v.createdById,
                    branchId:       v.branch?.id   ?? null,
                    branchName:     v.branch?.name ?? null,
                    createdBy:      v.createdBy?.name ?? null,
                    converted:      false,
                    // A GL voucher IS the spine, so its own id is the spine id.
                    universalVoucherId: v.id,
                    settlement:     v.settlement ?? null,
                    settlementOpen: v.settlementOpen ?? 0,
                }));
                setLoaded({ type, rows: mapped });
            })
            .catch(() => toast.error("Failed to load"))
            .finally(endRead);
    }, [type, tick, beginRead, endRead]);

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
                    <h1 className="text-2xl font-bold">{title}</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>
                </div>
                <Link href={newPath} {...(newTab ? { target: "_blank", rel: "noopener" } : {})}>
                    <Button><Plus size={16} /> New {title.replace(/s$/, "")}</Button>
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
                    showSettlement
                    emptyMessage={`No ${title.toLowerCase()} yet.`}
                />
            )}
        </div>
    );
}
