"use client";

// Reusable Purchases register — used by /vouchers/purchases and /office/accountancy/purchases.
// Renders via the canonical <VoucherRegisterTable> for uniform row markup,
// click-to-edit Reference, 3-dot ⋮ action menu, and Restore + Hard-Delete UX.

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
    _count:       { lines: number };
    createdBy:    { name: string };
}

interface Row extends VoucherRegisterRow {
    lineCount: number;
}

type StatusFilter = "" | "DRAFT" | "POSTED" | "CANCELLED" | "DELETED";
const STATUSES: StatusFilter[] = ["", "DRAFT", "POSTED", "CANCELLED", "DELETED"];

export function PurchasesRegister() {
    const [rows, setRows]       = useState<Row[]>([]);
    const [loading, setLoading] = useState(true);
    const [status, setStatus]   = useState<StatusFilter>("");
    const [tick, setTick]       = useState(0);
    const reload = useCallback(() => setTick((t) => t + 1), []);
    const showDeleted = status === "DELETED";

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setLoading(true);
        const params = new URLSearchParams({ type: "PURCHASE" });
        if (status && status !== "DELETED") params.set("status", status);
        if (showDeleted) params.set("includeDeleted", "1");

        axios.get<RawVoucher[]>(`/api/inventory/vouchers?${params}`)
            .then((r) => {
                const mapped: Row[] = (r.data ?? [])
                    .filter((v) => showDeleted ? !!v.deletedAt : !v.deletedAt)
                    .map((v) => ({
                        id:          `inv-${v.id}`,
                        rawId:       v.id,
                        source:      "inv",
                        kind:        "PURCHASE",
                        reference:   v.reference,
                        date:        v.date,
                        party:       v.partyName,
                        narration:   v.description,
                        totalAmount: Number(v.totalAmount),
                        lineCount:   v._count?.lines ?? 0,
                        status:      v.status,
                        deletedAt:   v.deletedAt ?? null,
                        cancelledAt: v.cancelledAt ?? null,
                        createdBy:   v.createdBy?.name ?? null,
                    }));
                setRows(mapped);
            })
            .catch(() => toast.error("Failed to load"))
            .finally(() => setLoading(false));
    }, [status, showDeleted, tick]);

    return (
        <div className="max-w-5xl mx-auto space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-foreground">Purchases</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">Purchase vouchers — stock &amp; GL ledger</p>
                </div>
                <Link href="/vouchers/purchases/new">
                    <Button><Plus size={16} /> New Purchase</Button>
                </Link>
            </div>

            <div className="flex gap-1">
                {STATUSES.map((s) => (
                    <Button
                        key={s}
                        onClick={() => setStatus(s)}
                        variant="outline"
                        size="xs"
                        className={`h-auto px-3 py-1.5 text-xs font-medium transition-colors ${
                            status === s
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
                    extraColumns={[
                        {
                            header:    "Items",
                            className: "px-4 py-3 text-center text-xs font-medium",
                            cell:      (r) => <span className="text-muted-foreground">{(r as Row).lineCount}</span>,
                        },
                    ]}
                    emptyMessage={
                        showDeleted
                            ? "No deleted purchase vouchers."
                            : "No purchase vouchers yet."
                    }
                />
            )}
        </div>
    );
}
