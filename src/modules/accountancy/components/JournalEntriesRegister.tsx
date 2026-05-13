"use client";

// Reusable Journal Entries register — used by /vouchers/journal-entries and /office/accountancy/journal-entries.
// Detail pages live at /office/accountancy/journal-entries/[id].
// API endpoint is /api/accountancy/journal-entries (different from InvVoucher / Voucher endpoints).

import { useEffect, useState } from "react";
import axios from "axios";
import Link from "next/link";
import { toast } from "sonner";
import { Plus, Loader2, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fmt } from "@/utils/constants";
import { StatusBadge } from "@/shared/components/StatusBadge";

type JournalEntryRow = {
    id:          string;
    reference:   string;
    date:        string;
    description: string | null;
    totalAmount: number;
    status:      "DRAFT" | "POSTED" | "CANCELLED";
    createdBy:   { name: string };
};

export function JournalEntriesRegister() {
    const [rows,    setRows]    = useState<JournalEntryRow[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        axios.get<{ rows: JournalEntryRow[] }>("/api/accountancy/journal-entries")
            .then((r) => setRows(r.data.rows || []))
            .catch(() => toast.error("Failed to load journal entries"))
            .finally(() => setLoading(false));
    }, []);

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

            {loading ? (
                <div className="flex justify-center py-12">
                    <Loader2 className="animate-spin text-muted-foreground" size={28} />
                </div>
            ) : rows.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border bg-muted/30 py-16 text-center text-muted-foreground">
                    No journal entries yet.{" "}
                    <Link href="/vouchers/journal-entries/new" className="text-primary hover:underline">
                        Create one
                    </Link>
                </div>
            ) : (
                <div className="overflow-hidden rounded-lg border border-border bg-card shadow">
                    <table className="w-full text-sm">
                        <thead className="border-b border-border bg-muted text-xs text-muted-foreground">
                            <tr>
                                <th className="px-5 py-3 text-left font-medium">Reference</th>
                                <th className="px-5 py-3 text-left font-medium">Date</th>
                                <th className="px-5 py-3 text-left font-medium">Description</th>
                                <th className="px-5 py-3 text-right font-medium">Amount</th>
                                <th className="px-5 py-3 text-center font-medium">Status</th>
                                <th className="px-5 py-3 text-left font-medium text-xs">By</th>
                                <th className="px-3 py-3" />
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((r) => (
                                <tr key={r.id} className="border-b last:border-0 hover:bg-muted/40">
                                    <td className="px-5 py-3 font-mono text-primary text-xs">{r.reference}</td>
                                    <td className="px-5 py-3 text-muted-foreground text-xs">
                                        {new Date(r.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                                    </td>
                                    <td className="px-5 py-3 text-muted-foreground max-w-[240px] truncate">{r.description || "—"}</td>
                                    <td className="px-5 py-3 text-right font-mono tabular-nums">₹ {fmt(Number(r.totalAmount))}</td>
                                    <td className="px-5 py-3 text-center">
                                        <StatusBadge kind="journal" value={r.status} />
                                    </td>
                                    <td className="px-5 py-3 text-muted-foreground text-xs">{r.createdBy.name}</td>
                                    <td className="px-3 py-3 text-right">
                                        <Link href={`/office/accountancy/journal-entries/${r.id}`} className="text-muted-foreground/40 hover:text-primary">
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
