"use client";
// Shared list view for inventory voucher registers (Sales Order, Purchase
// Order, GRN, Challan, Manufacturing Journal, Physical Stock, Rejection
// In/Out, Branch Transfer).
//
// Renders via the shared <VoucherRegisterTable> so every register inherits
// the same row markup, click-to-edit Reference link, and ⋮ action menu.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import Link from "next/link";
import { toast } from "sonner";
import { Plus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatUvNo } from "@/shared/lib/accountancy/uvNo";
import {
    VoucherRegisterTable,
    type VoucherRegisterRow,
    type VoucherRegisterExtraColumn,
} from "@/modules/accountancy/components/VoucherRegisterTable";
import {
    useRegisterFilters,
    applyRegisterFilters,
} from "@/modules/accountancy/hooks/useRegisterFilters";
import { RegisterFilterBar } from "@/modules/accountancy/components/RegisterFilterBar";
import { useRealtimeTopics } from "@/shared/hooks/useRealtimeTopics";
import type { InvVoucherKind } from "./InvVoucherForm";

export type InvVoucherListKind =
    | InvVoucherKind
    | "BRANCH_TRANSFER"
    | "SALE" | "PURCHASE"
    | "SALE_RETURN" | "PURCHASE_RETURN"
    | "ESTIMATE";

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
    paymentMode?:    string | null;
    totalAmount:     number | string;
    amountReceived?: number | string;
    status:          "DRAFT" | "POSTED" | "CANCELLED";
    cancelledAt?:    string | null;
    createdAt:       string;
    branch?:         { id: string; name: string } | null;
    _count:          { lines: number };
    createdBy:       { name: string };
    converted?:      boolean;
};

/** Row shape extended with optional fields injected for caller-supplied
 *  `extraColumns` to read (cast inside the cell callback). */
export interface InvVoucherListRow extends VoucherRegisterRow {
    paymentMode:    string | null;
    lineCount:      number;
    amountReceived: number;
}

export function InvVoucherList({
    type, title, subtitle, basePath, newPath, newLabel, emptyLabel, extraColumns,
}: {
    type:     InvVoucherListKind;
    title:    string;
    subtitle: string;
    /** Unused — kept for call-site compatibility. The shared table builds
     *  the reference link via referenceHref() now. */
    basePath?: string;
    /** Omit to hide the "New" button (read-only registers). */
    newPath?:  string;
    /** Override the auto-derived "New <singular>" button label. */
    newLabel?: string;
    /** Override the noun used in the empty-state text. Defaults to
     *  `title.toLowerCase()`. e.g. for "Sales" pass "sale vouchers" to get
     *  "No sale vouchers yet." instead of "No sales yet.". */
    emptyLabel?: string;
    /** Extra columns injected between Narration and Total. Cells receive
     *  an `InvVoucherListRow` (cast inside the callback). */
    extraColumns?: VoucherRegisterExtraColumn[];
}) {
    void basePath;
    const [allRows, setAllRows] = useState<InvVoucherListRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [tick, setTick]       = useState(0);

    /** A person pressing Reload should see it happen; a live signal must not blank
     *  a register someone is reading. Only the spinner differs — both re-read. */
    const silentRef             = useRef(false);
    const reload                = useCallback(() => { silentRef.current = false; setTick((t) => t + 1); }, []);
    const refreshSilently       = useCallback(() => { silentRef.current = true;  setTick((t) => t + 1); }, []);

    // A voucher posted at another counter lands in this register on its own —
    // every inventory voucher route announces both topics (see topics.ts).
    useRealtimeTopics(["ledger", "stock"], refreshSilently);

    const filters = useRegisterFilters(`reg:${type}`);

    useEffect(() => {
        if (!silentRef.current) setLoading(true);
        const params = new URLSearchParams({ type });

        axios.get<ListRow[]>(`/api/inventory/vouchers?${params}`)
            .then((r) => {
                const mapped: InvVoucherListRow[] = (r.data ?? []).map((v) => ({
                    id:             `inv-${v.id}`,
                    rawId:          v.id,
                    sortId:         v.id,
                    source:         "inv",
                    kind:           v.type ?? type,
                    reference:      v.reference || formatUvNo(v.id),
                    date:           v.date,
                    party:          v.partyName,
                    partyAccountId: v.partyAccountId ?? null,
                    partyKind:      v.partyPersonId != null ? "person" : v.partyCompanyId != null ? "company" : null,
                    partyEntityId:  v.partyPersonId ?? v.partyCompanyId ?? null,
                    narration:      v.description,
                    totalAmount:    Number(v.totalAmount),
                    amountReceived: v.amountReceived != null ? Number(v.amountReceived) : 0,
                    paymentMode:    v.paymentMode ?? null,
                    lineCount:      v._count?.lines ?? 0,
                    status:         v.status,
                    cancelledAt:    v.cancelledAt ?? null,
                    createdAt:      v.createdAt,
                    createdById:    null,
                    branchId:       v.branch?.id   ?? null,
                    branchName:     v.branch?.name ?? null,
                    createdBy:      v.createdBy?.name ?? null,
                    converted:      v.converted ?? false,
                }));
                setAllRows(mapped);
            })
            .catch(() => toast.error("Failed to load"))
            .finally(() => {
                setLoading(false);
                // Back to loud: the next read is a type switch or a person
                // pressing Reload, and both should show the spinner.
                silentRef.current = false;
            });
     
    }, [type, tick]);

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
        <div className="max-w-5xl mx-auto space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-foreground">{title}</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>
                </div>
                {newPath && (
                    <Link href={newPath}>
                        <Button><Plus size={16} /> {newLabel ?? `New ${title.replace(/s$/, "")}`}</Button>
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
                    extraColumns={extraColumns}
                    emptyMessage={`No ${emptyLabel ?? title.toLowerCase()} yet.`}
                />
            )}
        </div>
    );
}
