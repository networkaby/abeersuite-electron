"use client";
// Client-side combiner that fans out to the three voucher GET APIs in parallel,
// normalises the heterogeneous row shapes into a single CombinedRow, and sorts
// by date desc / id desc. No server-side pagination — fine for typical
// org-month volumes, gets slow past a few thousand rows. If that becomes a
// problem the right fix is to introduce a unified /api/accountancy/all-vouchers
// endpoint and switch this hook to a single fetch.

import { useCallback, useEffect, useState } from "react";
import axios from "axios";

export type CombinedSource = "inv" | "gl" | "je";

export type CombinedRow = {
    /** Stable React key: `${source}-${rawId}` (raw IDs may collide across sources). */
    id:          string;
    source:      CombinedSource;
    /** Voucher kind — InvVoucherType, GL VoucherType, or "JOURNAL". */
    kind:        string;
    reference:   string;
    date:        string;
    party:       string | null;
    narration:   string | null;
    totalAmount: number;
    status:      "DRAFT" | "POSTED" | "CANCELLED";
    /** Empty string when no detail page exists for that source+kind. */
    detailHref:  string;
    createdBy:   string | null;
};

// Detail-page map. Empty string = no detail route, chevron is hidden.
function invDetailHref(kind: string, id: number): string {
    switch (kind) {
        case "SALE":           return `/office/accountancy/sales/${id}`;
        case "PURCHASE":       return `/office/accountancy/purchases/${id}`;
        case "ESTIMATE":       return `/office/accountancy/estimates/${id}`;
        case "SALES_ORDER":    return `/vouchers/sales-orders/${id}`;
        case "PURCHASE_ORDER": return `/vouchers/purchase-orders/${id}`;
        case "GRN":            return `/vouchers/grn/${id}`;
        case "CHALLAN":        return `/vouchers/challans/${id}`;
        case "REJECTION_IN":   return `/vouchers/rejections-in/${id}`;
        case "REJECTION_OUT":  return `/vouchers/rejections-out/${id}`;
        default:               return "";  // sale-return, purchase-return, the 5 unused kinds
    }
}

function glDetailHref(kind: string, id: number): string {
    switch (kind) {
        case "PAYMENT":     return `/office/accountancy/payments/${id}`;
        case "RECEIPT":     return `/office/accountancy/receipts/${id}`;
        case "CONTRA":      return `/office/accountancy/contras/${id}`;
        case "CREDIT_NOTE": return `/office/accountancy/credit-notes/${id}`;
        case "DEBIT_NOTE":  return `/office/accountancy/debit-notes/${id}`;
        default:            return "";
    }
}

// Raw shapes as returned by each endpoint — only the fields we read.
type RawInv = {
    id: number; type: string; reference: string; date: string;
    description: string | null; status: "DRAFT" | "POSTED" | "CANCELLED";
    partyName: string | null; totalAmount: number | string;
    createdBy?: { name: string } | null;
};
type RawGl = {
    id: number; type: string; reference: string; date: string;
    narration: string | null; status: "DRAFT" | "POSTED" | "CANCELLED";
    partyAccount?: { name: string } | null;
    totalAmount: number | string;
    createdBy?: { name: string } | null;
};
type RawJe = {
    id: number | string; reference: string; date: string;
    description: string | null; status: "DRAFT" | "POSTED" | "CANCELLED";
    totalDebit?: number | string; totalAmount?: number | string;
    createdBy?: { name: string } | null;
};

export function useCombinedVouchers() {
    const [rows,    setRows]    = useState<CombinedRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error,   setError]   = useState<string | null>(null);
    const [tick,    setTick]    = useState(0);

    const reload = useCallback(() => setTick((t) => t + 1), []);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);

        Promise.all([
            axios.get<RawInv[]>("/api/inventory/vouchers"),
            axios.get<RawGl[]>("/api/accountancy/vouchers"),
            axios.get<RawJe[]>("/api/accountancy/journal-entries"),
        ])
            .then(([invRes, glRes, jeRes]) => {
                if (cancelled) return;
                const inv: CombinedRow[] = (invRes.data ?? []).map((v) => ({
                    id:          `inv-${v.id}`,
                    source:      "inv",
                    kind:        v.type,
                    reference:   v.reference,
                    date:        v.date,
                    party:       v.partyName,
                    narration:   v.description,
                    totalAmount: Number(v.totalAmount),
                    status:      v.status,
                    detailHref:  invDetailHref(v.type, v.id),
                    createdBy:   v.createdBy?.name ?? null,
                }));
                const gl: CombinedRow[] = (glRes.data ?? []).map((v) => ({
                    id:          `gl-${v.id}`,
                    source:      "gl",
                    kind:        v.type,
                    reference:   v.reference,
                    date:        v.date,
                    party:       v.partyAccount?.name ?? null,
                    narration:   v.narration,
                    totalAmount: Number(v.totalAmount),
                    status:      v.status,
                    detailHref:  glDetailHref(v.type, v.id),
                    createdBy:   v.createdBy?.name ?? null,
                }));
                const je: CombinedRow[] = (jeRes.data ?? []).map((e) => ({
                    id:          `je-${e.id}`,
                    source:      "je",
                    kind:        "JOURNAL",
                    reference:   e.reference,
                    date:        e.date,
                    party:       null,
                    narration:   e.description,
                    totalAmount: Number(e.totalDebit ?? e.totalAmount ?? 0),
                    status:      e.status,
                    detailHref:  `/office/accountancy/journal-entries/${e.id}`,
                    createdBy:   e.createdBy?.name ?? null,
                }));

                const merged = [...inv, ...gl, ...je].sort((a, b) => {
                    const dd = b.date.localeCompare(a.date);
                    if (dd !== 0) return dd;
                    return b.id.localeCompare(a.id);
                });
                setRows(merged);
            })
            .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load"); })
            .finally(() => { if (!cancelled) setLoading(false); });

        return () => { cancelled = true; };
    }, [tick]);

    return { rows, loading, error, reload };
}
