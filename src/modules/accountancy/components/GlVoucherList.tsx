"use client";
// Shared list view for the five GL voucher kinds (Contra, Payment, Receipt,
// Credit Note, Debit Note). Filters by type and status.
//
// Renders via the shared <VoucherRegisterTable> so every register inherits
// the same row markup, click-to-edit Reference link, 3-dot ⋮ action menu,
// and deleted-row Restore + Hard-Delete UX.

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import Link from "next/link";
import { toast } from "sonner";
import { Plus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    VoucherRegisterTable,
    type VoucherRegisterRow,
} from "@/modules/accountancy/components/VoucherRegisterTable";

export type GlVoucherKind = "CONTRA" | "PAYMENT" | "RECEIPT" | "CREDIT_NOTE" | "DEBIT_NOTE";

type RawRow = {
    id:           number;
    type:         GlVoucherKind;
    reference:    string;
    date:         string;
    narration:    string | null;
    totalAmount:  number | string;
    status:       "DRAFT" | "POSTED" | "CANCELLED";
    deletedAt:    string | null;
    cancelledAt?: string | null;
    createdBy:    { name: string };
    partyAccount: { id: number; code: string; name: string } | null;
};

type StatusFilter = "" | "DRAFT" | "POSTED" | "CANCELLED" | "DELETED";
const STATUSES: StatusFilter[] = ["", "DRAFT", "POSTED", "CANCELLED", "DELETED"];

export function GlVoucherList({
    type, title, subtitle, basePath, newPath, newTab = false,
}: {
    type:     GlVoucherKind;
    title:    string;
    subtitle: string;
    basePath: string;   // e.g. /vouchers/payments  (unused — kept for call-site compatibility)
    newPath:  string;   // e.g. /vouchers/payments/new
    newTab?:  boolean;
}) {
    void basePath;  // shared table uses referenceHref() instead
    const [rows, setRows]             = useState<VoucherRegisterRow[]>([]);
    const [loading, setLoading]       = useState(true);
    const [statusFilter, setStatusFilter] = useState<StatusFilter>("");
    const [tick, setTick]             = useState(0);

    const reload = useCallback(() => setTick((t) => t + 1), []);
    const showDeleted = statusFilter === "DELETED";

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setLoading(true);
        const params = new URLSearchParams({ type });
        if (statusFilter && statusFilter !== "DELETED") params.set("status", statusFilter);
        if (showDeleted) params.set("includeDeleted", "1");

        axios.get<RawRow[]>(`/api/accountancy/vouchers?${params}`)
            .then((r) => {
                const mapped: VoucherRegisterRow[] = (r.data ?? [])
                    .filter((v) => showDeleted ? !!v.deletedAt : !v.deletedAt)
                    .map((v) => ({
                        id:          `gl-${v.id}`,
                        rawId:       v.id,
                        source:      "gl",
                        kind:        v.type,
                        reference:   v.reference,
                        date:        v.date,
                        party:       v.partyAccount?.name ?? null,
                        narration:   v.narration,
                        totalAmount: Number(v.totalAmount),
                        status:      v.status,
                        deletedAt:   v.deletedAt ?? null,
                        cancelledAt: v.cancelledAt ?? null,
                        createdBy:   v.createdBy?.name ?? null,
                    }));
                setRows(mapped);
            })
            .catch(() => toast.error("Failed to load"))
            .finally(() => setLoading(false));
    }, [type, statusFilter, showDeleted, tick]);

    return (
        <div className="max-w-5xl mx-auto space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold">{title}</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>
                </div>
                <Link href={newPath} {...(newTab ? { target: "_blank", rel: "noopener" } : {})}>
                    <Button><Plus size={16} /> New {title.replace(/s$/, "")}</Button>
                </Link>
            </div>

            <div className="flex gap-1">
                {STATUSES.map((s) => (
                    <Button
                        key={s}
                        variant="outline"
                        size="xs"
                        onClick={() => setStatusFilter(s)}
                        className={`h-auto px-3 py-1.5 text-xs font-medium transition-colors ${
                            statusFilter === s
                                ? (s === "DELETED"
                                    ? "border-rose-600 bg-rose-600 text-white"
                                    : "border-primary bg-primary text-primary-foreground")
                                : "border-border bg-card text-muted-foreground hover:bg-muted"
                        }`}
                    >
                        {s || "All"}
                    </Button>
                ))}
            </div>

            {loading ? (
                <div className="flex justify-center py-12">
                    <Loader2 className="animate-spin text-muted-foreground" size={28} />
                </div>
            ) : (
                <VoucherRegisterTable
                    rows={rows}
                    onChanged={reload}
                    hideKind
                    emptyMessage={
                        showDeleted
                            ? `No deleted ${title.toLowerCase()}.`
                            : `No ${title.toLowerCase()} yet.`
                    }
                />
            )}
        </div>
    );
}
