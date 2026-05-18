"use client";

// Reusable Sales register — used by /vouchers/sales and /office/accountancy/sales (backward compat).
// Renders via the canonical <VoucherRegisterTable> so every register inherits
// identical row markup, click-to-edit Reference, 3-dot ⋮ action menu, and
// Restore + Hard-Delete UX on soft-deleted rows.  SALE-specific columns
// (Payment Mode, Items count, Balance due) are injected via `extraColumns`.

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import Link from "next/link";
import { toast } from "sonner";
import { Plus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fmt } from "@/utils/constants";
import {
    VoucherRegisterTable,
    type VoucherRegisterRow,
} from "@/modules/accountancy/components/VoucherRegisterTable";

const PAY_MODE_COLORS: Record<string, string> = {
    CASH:   "bg-blue-50 text-blue-700",
    CREDIT: "bg-purple-50 text-purple-700",
};

interface RawVoucher {
    id:             number;
    type:           string;
    reference:      string;
    date:           string;
    description:    string;
    status:         "DRAFT" | "POSTED" | "CANCELLED";
    partyName:      string | null;
    partyAccountId: number | null;
    paymentMode:    string | null;
    totalAmount:    number | string;
    amountReceived: number | string;
    deletedAt?:     string | null;
    cancelledAt?:   string | null;
    _count:         { lines: number };
    createdBy:      { name: string };
}

interface Row extends VoucherRegisterRow {
    paymentMode:    string | null;
    lineCount:      number;
    amountReceived: number;
}

type StatusFilter = "" | "DRAFT" | "POSTED" | "CANCELLED" | "DELETED";
const STATUSES: StatusFilter[] = ["", "DRAFT", "POSTED", "CANCELLED", "DELETED"];

export function SalesRegister() {
    const [rows, setRows]         = useState<Row[]>([]);
    const [loading, setLoading]   = useState(true);
    const [status, setStatus]     = useState<StatusFilter>("");
    const [tick, setTick]         = useState(0);
    const reload = useCallback(() => setTick((t) => t + 1), []);
    const showDeleted = status === "DELETED";

    useEffect(() => {
        setLoading(true);
        const params = new URLSearchParams({ type: "SALE" });
        if (status && status !== "DELETED") params.set("status", status);
        if (showDeleted) params.set("includeDeleted", "1");

        axios.get<RawVoucher[]>(`/api/inventory/vouchers?${params}`)
            .then((r) => {
                const mapped: Row[] = (r.data ?? [])
                    .filter((v) => showDeleted ? !!v.deletedAt : !v.deletedAt)
                    .map((v) => ({
                        id:             `inv-${v.id}`,
                        rawId:          v.id,
                        source:         "inv",
                        kind:           "SALE",
                        reference:      v.reference,
                        date:           v.date,
                        party:          v.partyName,
                        partyAccountId: v.partyAccountId,
                        narration:      v.description,
                        totalAmount:    Number(v.totalAmount),
                        amountReceived: Number(v.amountReceived),
                        paymentMode:    v.paymentMode,
                        lineCount:      v._count?.lines ?? 0,
                        status:         v.status,
                        deletedAt:      v.deletedAt ?? null,
                        cancelledAt:    v.cancelledAt ?? null,
                        createdBy:      v.createdBy?.name ?? null,
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
                    <h1 className="text-2xl font-bold text-foreground">Sales</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">Sale vouchers — stock &amp; GL ledger</p>
                </div>
                <Link href="/vouchers/sales/new">
                    <Button><Plus size={16} /> New Sale</Button>
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
                            header:    "Mode",
                            className: "px-4 py-3 text-center text-xs font-medium",
                            cell:      (r) => {
                                const row = r as Row;
                                return row.paymentMode
                                    ? <span className={`text-xs px-1.5 py-0.5 font-medium rounded-sm ${PAY_MODE_COLORS[row.paymentMode] ?? ""}`}>{row.paymentMode}</span>
                                    : null;
                            },
                        },
                        {
                            header:    "Items",
                            className: "px-4 py-3 text-center text-xs font-medium",
                            cell:      (r) => <span className="text-muted-foreground">{(r as Row).lineCount}</span>,
                        },
                        {
                            header:    "Balance",
                            className: "px-4 py-3 text-right text-xs font-medium",
                            cell:      (r) => {
                                const bal = r.totalAmount - (r as Row).amountReceived;
                                return bal > 0.005
                                    ? <span className="font-mono text-destructive">₹ {fmt(bal)}</span>
                                    : <span className="text-green-600">Paid</span>;
                            },
                        },
                    ]}
                    emptyMessage={
                        showDeleted
                            ? "No deleted sale vouchers."
                            : "No sale vouchers yet."
                    }
                />
            )}
        </div>
    );
}
