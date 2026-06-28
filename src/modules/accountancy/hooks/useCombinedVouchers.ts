"use client";
// Client-side combiner that fans out to the three voucher GET APIs in parallel,
// normalises the heterogeneous row shapes into a single CombinedRow, and sorts
// by date desc / id desc. No server-side pagination — fine for typical
// org-month volumes, gets slow past a few thousand rows. If that becomes a
// problem the right fix is to introduce a unified /api/accountancy/all-vouchers
// endpoint and switch this hook to a single fetch.

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { formatUvNo } from "@/shared/lib/accountancy/uvNo";

export type CombinedSource = "inv" | "gl" | "je";

export type CombinedRow = {
    /** Stable React key: `${source}-${rawId}` (raw IDs may collide across sources). */
    id:          string;
    /** Numeric ID of the underlying record — used for API calls and expand fetches. */
    rawId:       number;
    source:      CombinedSource;
    /** Voucher kind — InvVoucherType, GL VoucherType, or "JOURNAL". */
    kind:        string;
    reference:   string;
    date:        string;
    /** Branch the voucher was recorded in. `inv` rows always carry it; `gl` rows
     *  carry it when their JE lines are branch-stamped (POS receipts/expenditures);
     *  office/legacy `gl` and all `je` rows are org-level (null). */
    branchId?:   string | null;
    branchName?: string | null;
    party:       string | null;
    /** Account id for the party, when the row has one resolved. Used to link
     *  the Party cell to /office/customers/<accountId>. Inventory rows carry
     *  it server-side (resolved from Person/Company id); GL rows source it
     *  from partyAccount.id; JE rows have no party concept. Optional because
     *  per-kind register components fetch their own data and don't always
     *  surface this field. */
    partyAccountId?: number | null;
    /** Whether the party is a Person or a Company — needed so the Day Book
     *  can route to /office/customers/all?personId= or ?companyId= and the
     *  list page can pre-select the right tab. */
    partyKind?:     "person" | "company" | null;
    /** Person.id or Company.id (depending on partyKind) — the value the
     *  customer-list page uses to setSelected. */
    partyEntityId?: number | null;
    narration:   string | null;
    totalAmount: number;
    status:      "DRAFT" | "POSTED" | "CANCELLED";
    /** ISO timestamp when the row was soft-deleted, or null. Surfaced so the
     *  shared register table can show Restore + Hard-Delete in the row menu. */
    deletedAt:   string | null;
    cancelledAt: string | null;
    /** ISO timestamp when the row was created — used as the secondary sort
     *  key in the Day Book so rows on the same date stay in true creation
     *  order regardless of source (no inv/gl/je grouping). Optional because
     *  per-kind register components fetch their own data and don't always
     *  surface this field. */
    createdAt?:  string;
    createdBy:   string | null;
};

interface UseCombinedVouchersOptions {
    /** When true, fetches with `includeDeleted=1` on all three endpoints so
     *  soft-deleted rows are returned in addition to live ones. The caller is
     *  responsible for client-side filtering (e.g. "show only deleted"). */
    includeDeleted?: boolean;
}

// Raw shapes as returned by each endpoint — only the fields we read.
type RawInv = {
    id: number; type: string; reference: string; date: string;
    description: string | null; status: "DRAFT" | "POSTED" | "CANCELLED";
    partyName: string | null;
    partyAccountId?: number | null;
    partyPersonId?:  number | null;
    partyCompanyId?: number | null;
    totalAmount: number | string;
    deletedAt?: string | null; cancelledAt?: string | null;
    createdAt: string;
    createdBy?: { name: string } | null;
    branch?: { id: string; name: string } | null;
};
type RawGl = {
    id: number; type: string; voucherNo: string | null; date: string;
    narration: string | null; status: "DRAFT" | "POSTED" | "CANCELLED";
    partyAccount?: { id: number; name: string; personId: number | null; companyId: number | null } | null;
    totalAmount: number | string;
    deletedAt?: string | null; cancelledAt?: string | null;
    createdAt: string;
    createdBy?: { name: string } | null;
    // Branch derived from the voucher's JE lines (POS receipts/expenditures
    // stamp the counter's branch; office/legacy GL vouchers have none).
    branch?: { id: string; name: string } | null;
};
type RawJe = {
    id: number | string; voucherNo: string | null; date: string;
    description: string | null; status: "DRAFT" | "POSTED" | "CANCELLED";
    totalDebit?: number | string; totalAmount?: number | string;
    deletedAt?: string | null; cancelledAt?: string | null;
    createdAt: string;
    createdBy?: { name: string } | null;
};

export function useCombinedVouchers(options: UseCombinedVouchersOptions = {}) {
    const { includeDeleted = false } = options;
    const [rows,    setRows]    = useState<CombinedRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error,   setError]   = useState<string | null>(null);
    const [tick,    setTick]    = useState(0);

    const reload = useCallback(() => setTick((t) => t + 1), []);

    useEffect(() => {
        let cancelled = false;
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setLoading(true);
        setError(null);

        // Reports default to org-wide. The inventory vouchers route returns
        // every branch when `branchId` is omitted (post the top-bar / report
        // split); GL voucher and JE endpoints have never been branch-scoped.
        const qs = includeDeleted ? "?includeDeleted=1" : "";

        Promise.all([
            axios.get<RawInv[]>(`/api/inventory/vouchers${qs}`),
            axios.get<RawGl[]>(`/api/accountancy/vouchers${qs}`),
            axios.get<RawJe[]>(`/api/accountancy/journal-entries${qs}`),
        ])
            .then(([invRes, glRes, jeRes]) => {
                if (cancelled) return;
                const inv: CombinedRow[] = (invRes.data ?? []).map((v) => ({
                    id:          `inv-${v.id}`,
                    rawId:       v.id,
                    source:      "inv",
                    kind:        v.type,
                    // Display reader: per-kind Voucher No, else the UVNo label (UV-<id>).
                    reference:   v.reference || formatUvNo(v.id),
                    date:        v.date,
                    branchId:    v.branch?.id   ?? null,
                    branchName:  v.branch?.name ?? null,
                    party:       v.partyName,
                    partyAccountId: v.partyAccountId ?? null,
                    partyKind:     v.partyPersonId != null ? "person" : v.partyCompanyId != null ? "company" : null,
                    partyEntityId: v.partyPersonId ?? v.partyCompanyId ?? null,
                    narration:   v.description,
                    totalAmount: Number(v.totalAmount),
                    status:      v.status,
                    deletedAt:   v.deletedAt ?? null,
                    cancelledAt: v.cancelledAt ?? null,
                    createdAt:   v.createdAt,
                    createdBy:   v.createdBy?.name ?? null,
                }));
                const gl: CombinedRow[] = (glRes.data ?? []).map((v) => ({
                    id:          `gl-${v.id}`,
                    rawId:       v.id,
                    source:      "gl",
                    kind:        v.type,
                    // GL spine has no `reference` column — show voucherNo (PMT-/RCT-…)
                    // or fall back to the UVNo label so the cell is never blank.
                    reference:   v.voucherNo ?? formatUvNo(v.id),
                    date:        v.date,
                    branchId:    v.branch?.id   ?? null,
                    branchName:  v.branch?.name ?? null,
                    party:       v.partyAccount?.name ?? null,
                    partyAccountId: v.partyAccount?.id ?? null,
                    partyKind:     v.partyAccount?.personId != null ? "person"
                                  : v.partyAccount?.companyId != null ? "company"
                                  : null,
                    partyEntityId: v.partyAccount?.personId ?? v.partyAccount?.companyId ?? null,
                    narration:   v.narration,
                    totalAmount: Number(v.totalAmount),
                    status:      v.status,
                    deletedAt:   v.deletedAt ?? null,
                    cancelledAt: v.cancelledAt ?? null,
                    createdAt:   v.createdAt,
                    createdBy:   v.createdBy?.name ?? null,
                }));
                const je: CombinedRow[] = (jeRes.data ?? []).map((e) => ({
                    id:          `je-${e.id}`,
                    rawId:       Number(e.id),
                    source:      "je",
                    kind:        "JOURNAL",
                    reference:   e.voucherNo ?? formatUvNo(Number(e.id)),
                    date:        e.date,
                    party:       null,
                    partyAccountId: null,
                    partyKind:     null,
                    partyEntityId: null,
                    narration:   e.description,
                    totalAmount: Number(e.totalDebit ?? e.totalAmount ?? 0),
                    status:      e.status,
                    deletedAt:   e.deletedAt ?? null,
                    cancelledAt: e.cancelledAt ?? null,
                    createdAt:   e.createdAt,
                    createdBy:   e.createdBy?.name ?? null,
                }));

                // Age-wise sort: newest date first, then newest creation time
                // first within the same date.  createdAt (not the source-prefixed
                // id) is used as the tie-breaker so rows are NOT grouped by
                // source (inv/gl/je) — the Day Book interleaves all sources
                // chronologically.
                const merged = [...inv, ...gl, ...je].sort((a, b) => {
                    const dd = b.date.localeCompare(a.date);
                    if (dd !== 0) return dd;
                    return (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
                });
                setRows(merged);
            })
            .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load"); })
            .finally(() => { if (!cancelled) setLoading(false); });

        return () => { cancelled = true; };
    }, [tick, includeDeleted]);

    return { rows, loading, error, reload };
}
