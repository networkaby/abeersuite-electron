"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import Link from "next/link";
import { toast } from "sonner";
import { Plus, Loader2, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fmt } from "@/utils/constants";
import { StatusBadge } from "@/shared/components/StatusBadge";

type JournalEntryRow = {
    id: string;
    reference: string;
    date: string;
    description: string | null;
    totalAmount: number;
    status: "DRAFT" | "POSTED" | "CANCELLED";
    createdBy: { name: string };
};

export default function JournalEntriesPage() {
    const [rows, setRows] = useState<JournalEntryRow[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchJournalEntries = async () => {
            try {
                const res = await axios.get("/api/accountancy/journal-entries");
                setRows(res.data.rows || []);
            } catch (err) {
                toast.error("Failed to load journal entries");
                console.error(err);
            } finally {
                setLoading(false);
            }
        };

        fetchJournalEntries();
    }, []);

    return (
        <div className="space-y-4 p-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold">Journal Entries</h1>
                    <p className="text-sm text-muted-foreground">
                        Double-entry GL adjustments with optional inventory attachment
                    </p>
                </div>
                <Button asChild variant="default">
                    <Link href="/vouchers/journal">
                        <Plus size={16} className="mr-2" />
                        New Journal Entry
                    </Link>
                </Button>
            </div>

            {loading ? (
                <div className="flex justify-center py-12">
                    <Loader2 size={24} className="animate-spin text-muted-foreground" />
                </div>
            ) : rows.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border bg-muted/30 py-12 text-center">
                    <p className="text-sm text-muted-foreground">No journal entries yet</p>
                </div>
            ) : (
                <div className="rounded-lg border border-border overflow-hidden">
                    <table className="w-full text-sm">
                        <thead className="bg-muted/50 border-b border-border">
                            <tr>
                                <th className="px-4 py-2 text-left font-medium">Reference</th>
                                <th className="px-4 py-2 text-left font-medium">Date</th>
                                <th className="px-4 py-2 text-left font-medium">Description</th>
                                <th className="px-4 py-2 text-right font-medium">Amount</th>
                                <th className="px-4 py-2 text-left font-medium">Status</th>
                                <th className="px-4 py-2 text-left font-medium">Created By</th>
                                <th className="px-4 py-2 text-center font-medium"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {rows.map((row) => (
                                <tr key={row.id} className="hover:bg-muted/30 transition-colors">
                                    <td className="px-4 py-2 font-mono text-xs">{row.reference}</td>
                                    <td className="px-4 py-2">{new Date(row.date).toLocaleDateString("en-GB")}</td>
                                    <td className="px-4 py-2 text-muted-foreground">{row.description || "—"}</td>
                                    <td className="px-4 py-2 text-right font-mono tabular-nums">₹ {fmt(row.totalAmount)}</td>
                                    <td className="px-4 py-2">
                                        <StatusBadge status={row.status} />
                                    </td>
                                    <td className="px-4 py-2 text-xs text-muted-foreground">{row.createdBy.name}</td>
                                    <td className="px-4 py-2 text-center">
                                        <Link href={`/office/accountancy/journal-entries/${row.id}`} className="inline-block p-1 hover:bg-muted rounded">
                                            <ChevronRight size={16} className="text-muted-foreground" />
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
