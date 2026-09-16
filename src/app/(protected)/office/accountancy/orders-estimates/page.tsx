"use client";

// Orders & Estimates register — a normal voucher register scoped to the
// convertible commercial documents: estimates (Estimate / POS Estimate) and
// orders (Sales / POS / Online / Purchase Order). Each row carries a Convert
// button (see ConvertVoucherButton) that raises the next document in the chain
// — accountancy only, no pipeline. Modelled on <InvVoucherList>, but multi-type.

import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatUvNo } from "@/shared/lib/accountancy/uvNo";
import {
    VoucherRegisterTable,
    type VoucherRegisterRow,
} from "@/modules/accountancy/components/VoucherRegisterTable";
import {
    useRegisterFilters,
    applyRegisterFilters,
} from "@/modules/accountancy/hooks/useRegisterFilters";
import { RegisterFilterBar } from "@/modules/accountancy/components/RegisterFilterBar";
import { ConvertVoucherButton } from "@/modules/accountancy/components/ConvertVoucherButton";
import { useRealtimeTopics } from "@/shared/hooks/useRealtimeTopics";
import { useRegisterReads } from "@/shared/hooks/useRegisterReads";

// The convertible commercial documents this register lists.
const TYPES = "ESTIMATE,POS_ESTIMATE,SALES_ORDER,POS_ORDER,ONLINE_ORDER,PURCHASE_ORDER";

type ListRow = {
    id:              number;
    type?:           string;
    reference:       string;
    date:            string;
    description:     string;
    partyName:       string | null;
    partyAccountId?: number | null;
    partyPersonId?:  number | null;
    partyCompanyId?: number | null;
    totalAmount:     number | string;
    status:          "DRAFT" | "POSTED" | "CANCELLED";
    cancelledAt?:    string | null;
    createdAt:       string;
    sourceCreatedAt:       string | null;
    sourceCounterId:       number | null;
    branch?:         { id: string; name: string } | null;
    createdBy:       { name: string } | null;
    converted?:      boolean;
};

export default function OrdersEstimatesPage() {
    const [allRows, setAllRows] = useState<VoucherRegisterRow[]>([]);

    // This register is a fixed set of types, so its rows have only one identity.
    const { tick, loading, reload, refreshSilently, beginRead, endRead } = useRegisterReads();

    const filters = useRegisterFilters("reg:orders-estimates");
    // A new estimate, order or conversion anywhere re-reads the register - and
    // silently, because nobody here asked for it.
    useRealtimeTopics(["ledger", "stock"], refreshSilently);

    useEffect(() => {
        beginRead();
        const params = new URLSearchParams({ types: TYPES });

        axios.get<ListRow[]>(`/api/inventory/vouchers?${params}`)
            .then((r) => {
                const mapped: VoucherRegisterRow[] = (r.data ?? []).map((v) => ({
                    id:             `inv-${v.id}`,
                    rawId:          v.id,
                    sortId:         v.id,
                    source:         "inv",
                    kind:           v.type ?? "",
                    reference:      v.reference || formatUvNo(v.id),
                    date:           v.date,
                    party:          v.partyName,
                    partyAccountId: v.partyAccountId ?? null,
                    partyKind:      v.partyPersonId != null ? "person" : v.partyCompanyId != null ? "company" : null,
                    partyEntityId:  v.partyPersonId ?? v.partyCompanyId ?? null,
                    narration:      v.description,
                    totalAmount:    Number(v.totalAmount),
                    status:         v.status,
                    cancelledAt:    v.cancelledAt ?? null,
                    createdAt:      v.createdAt,
                    sourceCreatedAt:      v.sourceCreatedAt ?? null,
                    sourceCounterId:      v.sourceCounterId ?? null,
                    createdById:    null,
                    branchId:       v.branch?.id   ?? null,
                    branchName:     v.branch?.name ?? null,
                    createdBy:      v.createdBy?.name ?? null,
                    converted:      v.converted ?? false,
                }));
                setAllRows(mapped);
            })
            .catch(() => toast.error("Failed to load orders & estimates"))
            .finally(endRead);
    }, [tick, beginRead, endRead]);

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
        [allRows, filters.from, filters.to, filters.search, filters.statuses, filters.branchFilter],
    );

    const postedTotal = useMemo(
        () => filtered.filter((r) => r.status === "POSTED").reduce((s, r) => s + r.totalAmount, 0),
        [filtered],
    );

    return (
        <ScrollArea className="h-full" type="always">
            <div className="max-w-6xl mx-auto space-y-4 px-6 pt-3 pb-6">
                <div>
                    <h1 className="text-2xl font-bold text-foreground">Orders &amp; Estimates</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        Estimates and orders (counter, office &amp; online) — no stock or GL impact until converted.
                        Use <span className="font-medium">Convert</span> on a row to raise the next document.
                    </p>
                </div>

                <RegisterFilterBar
                    {...filters}
                    availableBranches={availableBranches}
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
                        statusInline
                        showBranch={availableBranches.length > 0}
                        extraColumns={[
                            {
                                header:    "Convert",
                                className: "px-3 py-3 text-center",
                                cell:      (r) => r.converted ? null : <ConvertVoucherButton rawId={r.rawId} kind={r.kind} onConverted={reload} />,
                            },
                        ]}
                        emptyMessage="No orders or estimates yet."
                    />
                )}
            </div>
        </ScrollArea>
    );
}
