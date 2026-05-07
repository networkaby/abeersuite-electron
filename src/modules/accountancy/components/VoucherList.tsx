"use client";
// Shared list view for the unified Voucher table. Filters by type.

import { useEffect, useState } from "react";
import axios from "axios";
import Link from "next/link";
import { toast } from "sonner";
import { Plus, Loader2, ChevronRight, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fmt, JOURNAL_STATUS_COLORS } from "@/utils/constants";

import type { VoucherFormType } from "./VoucherForm";

export type VoucherRow = {
    id:           number;
    type:         VoucherFormType;
    reference:    string;
    date:         string;
    narration:    string | null;
    totalAmount:  number;
    status:       "DRAFT" | "POSTED" | "CANCELLED";
    deletedAt:    string | null;
    createdBy:    { name: string };
    partyAccount: { id: number; code: string; name: string } | null;
    _count:       { lines: number };
};

const STATUS_COLORS = JOURNAL_STATUS_COLORS;

export function VoucherList({
    type, title, subtitle, basePath, newPath,
}: {
    type:     VoucherFormType;
    title:    string;
    subtitle: string;
    basePath: string;  // /office/accountancy/contras
    newPath:  string;  // /office/accountancy/contras/new
}) {
    const [rows, setRows] = useState<VoucherRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [statusFilter, setStatusFilter] = useState("");

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setLoading(true);
        const q = new URLSearchParams({ type, ...(statusFilter && { status: statusFilter }) });
        axios.get<VoucherRow[]>(`/api/finance/vouchers?${q}`)
            .then((r) => setRows(r.data))
            .catch(() => toast.error("Failed to load"))
            .finally(() => setLoading(false));
    }, [type, statusFilter]);

    return (
        <div className="max-w-5xl mx-auto space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold">{title}</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>
                </div>
                <Link href={newPath}>
                    <Button><Plus size={16} /> New {title.replace(/s$/, "")}</Button>
                </Link>
            </div>

            <div className="flex gap-1">
                {(["", "DRAFT", "POSTED", "CANCELLED"] as const).map((s) => (
                    <Button key={s} variant="outline" size="xs"
                        onClick={() => setStatusFilter(s)}
                        className={`h-auto px-3 py-1.5 text-xs font-medium transition-colors ${statusFilter === s ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:bg-muted"}`}
                    >
                        {s || "All"}
                    </Button>
                ))}
            </div>

            {loading ? (
                <div className="flex justify-center py-12">
                    <Loader2 className="animate-spin text-muted-foreground" size={28} />
                </div>
            ) : rows.length === 0 ? (
                <div className="rounded-lg border border-border bg-card text-center py-16 text-muted-foreground">
                    No vouchers yet. <Link href={newPath} className="text-primary hover:underline">Create one</Link>
                </div>
            ) : (
                <div className="overflow-hidden rounded-lg border border-border bg-card shadow">
                    <table className="w-full text-sm">
                        <thead className="border-b border-border bg-muted text-xs text-muted-foreground">
                            <tr>
                                <th className="px-5 py-3 text-left font-medium">Reference</th>
                                <th className="px-5 py-3 text-left font-medium">Date</th>
                                <th className="px-5 py-3 text-left font-medium">Party</th>
                                <th className="px-5 py-3 text-left font-medium">Narration</th>
                                <th className="px-5 py-3 text-right font-medium">Amount</th>
                                <th className="px-5 py-3 text-center font-medium">Status</th>
                                <th className="px-5 py-3 text-left font-medium">By</th>
                                <th className="px-5 py-3" />
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((r) => (
                                <tr key={r.id} className={`border-b last:border-0 hover:bg-muted/40 ${r.deletedAt ? "opacity-60" : ""}`}>
                                    <td className="px-5 py-3 font-mono text-primary text-xs">{r.reference}</td>
                                    <td className="px-5 py-3 text-muted-foreground text-xs">
                                        {new Date(r.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                                    </td>
                                    <td className="px-5 py-3">{r.partyAccount?.name ?? <span className="text-muted-foreground/50">—</span>}</td>
                                    <td className="px-5 py-3 text-muted-foreground max-w-[200px] truncate">{r.narration ?? "—"}</td>
                                    <td className="px-5 py-3 text-right font-mono">₹ {fmt(Number(r.totalAmount))}</td>
                                    <td className="px-5 py-3 text-center">
                                        <span className={`text-xs px-2 py-0.5 font-medium ${STATUS_COLORS[r.status]}`}>{r.status}</span>
                                        {r.deletedAt && (
                                            <span className="ml-2 inline-flex items-center gap-1 rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium uppercase text-destructive">
                                                <Trash2 size={10} /> deleted
                                            </span>
                                        )}
                                    </td>
                                    <td className="px-5 py-3 text-muted-foreground text-xs">{r.createdBy.name}</td>
                                    <td className="px-5 py-3 text-right">
                                        <Link href={`${basePath}/${r.id}`} className="text-muted-foreground/40 hover:text-primary">
                                            <ChevronRight size={16} />
                                        </Link>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
