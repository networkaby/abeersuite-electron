"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, ChevronLeft, ChevronRight, Search } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fmt } from "@/utils/constants";
import { indianFiscalYearStart, formatDateInput } from "@/modules/tally/lib/period";

type Kind = "Sale" | "Purchase" | "Estimate" | "Invoice" | "Journal";

interface SourceDoc {
    kind: "sale" | "purchase" | "estimate" | "invoice";
    id: number; reference?: string; number?: string; url: string;
}
interface DayBookRow {
    id: number;
    date: string;
    reference: string;
    description: string;
    kind: Kind;
    debit: number;
    credit: number;
    source: SourceDoc | null;
}
interface DayBookData {
    from: string; to: string;
    rows: DayBookRow[];
    total: number; page: number; limit: number;
}

const KIND_COLOR: Record<Kind, string> = {
    Sale:     "bg-green-50 text-green-700 border-green-200",
    Purchase: "bg-blue-50 text-blue-700 border-blue-200",
    Estimate: "bg-amber-50 text-amber-700 border-amber-200",
    Invoice:  "bg-purple-50 text-purple-700 border-purple-200",
    Journal:  "bg-muted text-muted-foreground border-border",
};

export default function DayBookPage() {
    const router = useRouter();
    const fyStart = indianFiscalYearStart();
    const [from, setFrom] = useState(formatDateInput(fyStart));
    const [to, setTo]     = useState(formatDateInput(new Date()));
    const [search, setSearch] = useState("");
    const [page, setPage] = useState(1);
    const [data, setData] = useState<DayBookData | null>(null);
    const [loading, setLoading] = useState(false);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const load = useCallback((p: number, q: string) => {
        setLoading(true);
        axios.get<DayBookData>(`/api/finance/reports/day-book?from=${from}&to=${to}&page=${p}&limit=50${q ? `&search=${encodeURIComponent(q)}` : ""}`)
            .then((r) => setData(r.data))
            .catch(() => toast.error("Failed to load day book"))
            .finally(() => setLoading(false));
    }, [from, to]);

    const loadFirst = useCallback(() => { setPage(1); load(1, ""); }, [load]);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(loadFirst, [loadFirst]);

    const handleSearch = (v: string) => {
        setSearch(v);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => { setPage(1); load(1, v); }, 400);
    };
    const goPage = (p: number) => { setPage(p); load(p, search); };

    const totalPages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

    return (
        <div className="max-w-7xl mx-auto space-y-5">
            <div className="flex items-end justify-between gap-3 flex-wrap">
                <div>
                    <h1 className="text-2xl font-bold text-foreground">Day Book</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">All posted vouchers, chronological</p>
                </div>
                <div className="flex items-end gap-2">
                    <div className="space-y-1"><Label>From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-auto" /></div>
                    <div className="space-y-1"><Label>To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-auto" /></div>
                    <Button onClick={() => { setPage(1); load(1, search); }}>Run</Button>
                </div>
            </div>

            <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input value={search} onChange={(e) => handleSearch(e.target.value)} placeholder="Search by reference or description…" className="pl-9" />
            </div>

            {loading && <div className="flex justify-center py-20"><Loader2 className="animate-spin text-muted-foreground" size={28} /></div>}

            {!loading && data && (
                <>
                    <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
                        <table className="w-full text-sm">
                            <thead className="border-b bg-muted text-xs text-muted-foreground">
                                <tr>
                                    <th className="px-3 py-2 text-left font-medium">Date</th>
                                    <th className="px-3 py-2 text-left font-medium">Type</th>
                                    <th className="px-3 py-2 text-left font-medium">Reference</th>
                                    <th className="px-3 py-2 text-left font-medium">Description</th>
                                    <th className="px-3 py-2 text-right font-medium">Debit</th>
                                    <th className="px-3 py-2 text-right font-medium">Credit</th>
                                    <th className="px-3 py-2 text-left font-medium">Source</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.rows.length === 0 ? (
                                    <tr><td colSpan={7} className="py-12 text-center text-muted-foreground text-sm">No vouchers in this period.</td></tr>
                                ) : data.rows.map((r) => (
                                    <tr
                                        key={r.id}
                                        className="border-b last:border-0 hover:bg-muted/40 cursor-pointer"
                                        onClick={() => router.push(`/office/finance/journal-entries/${r.id}`)}
                                    >
                                        <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">
                                            {new Date(r.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" })}
                                        </td>
                                        <td className="px-3 py-2.5">
                                            <span className={`text-xs px-2 py-0.5 border font-medium rounded-sm ${KIND_COLOR[r.kind]}`}>
                                                {r.kind}
                                            </span>
                                        </td>
                                        <td className="px-3 py-2.5 font-mono text-primary">{r.reference}</td>
                                        <td className="px-3 py-2.5 text-foreground truncate max-w-md">{r.description}</td>
                                        <td className="px-3 py-2.5 text-right font-mono">{r.debit > 0 ? fmt(r.debit) : <span className="text-muted-foreground/40">—</span>}</td>
                                        <td className="px-3 py-2.5 text-right font-mono">{r.credit > 0 ? fmt(r.credit) : <span className="text-muted-foreground/40">—</span>}</td>
                                        <td className="px-3 py-2.5">
                                            {r.source ? (
                                                <Link
                                                    href={r.source.url}
                                                    onClick={(e) => e.stopPropagation()}
                                                    className="text-xs text-primary hover:underline font-mono"
                                                >
                                                    {r.source.reference ?? r.source.number} ↗
                                                </Link>
                                            ) : <span className="text-muted-foreground/40 text-xs">—</span>}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {totalPages > 1 && (
                        <div className="flex items-center justify-between text-sm text-muted-foreground">
                            <span>Showing {(data.page - 1) * data.limit + 1}–{Math.min(data.page * data.limit, data.total)} of {data.total.toLocaleString()}</span>
                            <div className="flex items-center gap-2">
                                <Button variant="outline" size="sm" onClick={() => goPage(page - 1)} disabled={page <= 1}>
                                    <ChevronLeft size={14} /> Prev
                                </Button>
                                <span className="text-xs px-2">Page {page} of {totalPages}</span>
                                <Button variant="outline" size="sm" onClick={() => goPage(page + 1)} disabled={page >= totalPages}>
                                    Next <ChevronRight size={14} />
                                </Button>
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
