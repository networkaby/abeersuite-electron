"use client";

// Reusable Journal Entries register — used by /vouchers/journal-entries.
// Renders via the canonical <VoucherRegisterTable> for uniform behaviour.

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

type StatusFilter = "" | "DRAFT" | "POSTED" | "CANCELLED" | "DELETED";
const STATUSES: StatusFilter[] = ["", "DRAFT", "POSTED", "CANCELLED", "DELETED"];

export function JournalEntriesRegister() {
    const [rows, setRows]       = useState<VoucherRegisterRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [status, setStatus]   = useState<StatusFilter>("");
    const [tick, setTick]       = useState(0);
    const reload = useCallback(() => setTick((t) => t + 1), []);
    const showDeleted = status === "DELETED";

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setLoading(true);
        const params = new URLSearchParams();
        if (status && status !== "DELETED") params.set("status", status);
        if (showDeleted) params.set("includeDeleted", "1");

        // The journal-entries endpoint returns a plain array; the older shape
        // wrapping in { rows } is from a different endpoint.
        axios.get<RawEntry[] | { rows: RawEntry[] }>(`/api/accountancy/journal-entries?${params}`)
            .then((r) => {
                const arr: RawEntry[] = Array.isArray(r.data)
                    ? r.data
                    : (r.data as { rows: RawEntry[] }).rows ?? [];
                const mapped: VoucherRegisterRow[] = arr
                    .filter((e) => showDeleted ? !!e.deletedAt : !e.deletedAt)
                    .map((e) => ({
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
                setRows(mapped);
            })
            .catch(() => toast.error("Failed to load journal entries"))
            .finally(() => setLoading(false));
    }, [status, showDeleted, tick]);

    return (
        <div className="max-w-5xl mx-auto space-y-6">
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
                    emptyMessage={
                        showDeleted
                            ? "No deleted journal entries."
                            : "No journal entries yet."
                    }
                />
            )}
        </div>
    );
}
