"use client";

import { useEffect, useState, useCallback, useRef, Fragment } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, ChevronLeft, ChevronRight, Search } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { fmt } from "@/utils/constants";
import { indianFiscalYearStart, formatDateInput } from "@/modules/accountancy/lib/period";

type Kind = "Sale" | "Purchase" | "Estimate" | "Invoice"
    | "Contra" | "Payment" | "Receipt" | "Credit Note" | "Debit Note"
    | "Journal";
type KindFilter = "All" | Kind;
const KIND_OPTIONS: KindFilter[] = ["All", "Sale", "Purchase", "Estimate", "Invoice",
    "Contra", "Payment", "Receipt", "Credit Note", "Debit Note", "Journal"];

interface SourceDoc {
    kind: "sale" | "purchase" | "estimate" | "invoice" | "voucher";
    id: number; reference?: string; number?: string; url: string;
}
interface DayBookLine {
    accountId: number;
    accountName: string;
    accountCode: string | null;
    side: "DEBIT" | "CREDIT";
    amount: number;
    description: string | null;
}
interface DayBookRow {
    id: number;
    date: string;
    reference: string;
    description: string;
    kind: Kind;
    debit: number;
    credit: number;
    principal: { accountId: number; accountName: string; side: "DEBIT" | "CREDIT"; amount: number } | null;
    lines: DayBookLine[];
    source: SourceDoc | null;
}
interface DayBookData {
    from: string; to: string;
    rows: DayBookRow[];
    total: number; page: number; limit: number;
}

const KIND_COLOR: Record<Kind, string> = {
    Sale:          "bg-green-50 text-green-700 border-green-200",
    Purchase:      "bg-blue-50 text-blue-700 border-blue-200",
    Estimate:      "bg-amber-50 text-amber-700 border-amber-200",
    Invoice:       "bg-purple-50 text-purple-700 border-purple-200",
    Contra:        "bg-cyan-50 text-cyan-700 border-cyan-200",
    Payment:       "bg-rose-50 text-rose-700 border-rose-200",
    Receipt:       "bg-teal-50 text-teal-700 border-teal-200",
    "Credit Note": "bg-pink-50 text-pink-700 border-pink-200",
    "Debit Note":  "bg-indigo-50 text-indigo-700 border-indigo-200",
    Journal:       "bg-muted text-muted-foreground border-border",
};

export default function DayBookPage() {
    const router = useRouter();
    const fyStart = indianFiscalYearStart();
    const [from, setFrom] = useState(formatDateInput(fyStart));
    const [to, setTo]     = useState(formatDateInput(new Date()));
    const [search, setSearch] = useState("");
    const [kind, setKind] = useState<KindFilter>("All");
    const [page, setPage] = useState(1);
    const [data, setData] = useState<DayBookData | null>(null);
    const [loading, setLoading] = useState(false);
    const [expanded, setExpanded] = useState<Set<number>>(new Set());
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Esc behavior:
    //   • If any row is expanded → collapse all (don't navigate).
    //   • Otherwise → router.back() to the previous page.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== "Escape") return;
            const t = e.target as HTMLElement | null;
            if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
            if (document.querySelector('[data-state="open"][role="dialog"]')) return;
            if (expanded.size > 0) {
                setExpanded(new Set());
            } else {
                router.back();
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [expanded, router]);

    const toggleExpand = (id: number) => setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
    });

    const load = useCallback((p: number, q: string, k: KindFilter) => {
        setLoading(true);
        const url = `/api/finance/reports/day-book?from=${from}&to=${to}&page=${p}&limit=50`
            + (q ? `&search=${encodeURIComponent(q)}` : "")
            + (k !== "All" ? `&kind=${encodeURIComponent(k)}` : "");
        axios.get<DayBookData>(url)
            .then((r) => setData(r.data))
            .catch(() => toast.error("Failed to load day book"))
            .finally(() => setLoading(false));
    }, [from, to]);

    const loadFirst = useCallback(() => { setPage(1); load(1, "", "All"); }, [load]);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(loadFirst, [loadFirst]);

    const handleSearch = (v: string) => {
        setSearch(v);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => { setPage(1); load(1, v, kind); }, 400);
    };
    const handleKind = (k: KindFilter) => { setKind(k); setPage(1); load(1, search, k); };
    const goPage = (p: number) => { setPage(p); load(p, search, kind); };

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
                    <Button onClick={() => { setPage(1); load(1, search, kind); }}>Refresh</Button>
                </div>
            </div>

            <div className="flex items-center gap-2">
                <div className="relative flex-1">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input value={search} onChange={(e) => handleSearch(e.target.value)} placeholder="Search by reference or description…" className="pl-9" />
                </div>
                <Select value={kind} onValueChange={(v) => handleKind(v as KindFilter)}>
                    <SelectTrigger className="w-44" aria-label="Filter by voucher type">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {KIND_OPTIONS.map((k) => (
                            <SelectItem key={k} value={k}>{k === "All" ? "All types" : k}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
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
                                    {/* Reference column hidden by default — uncomment for troubleshooting.
                                        <th className="px-3 py-2 text-left font-medium">Reference</th>  */}
                                    <th className="px-3 py-2 text-left font-medium">Description</th>
                                    <th className="px-3 py-2 text-right font-medium">Amount</th>
                                    <th className="px-3 py-2 text-left font-medium">Source</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.rows.length === 0 ? (
                                    <tr><td colSpan={5} className="py-12 text-center text-muted-foreground text-sm">No vouchers in this period.</td></tr>
                                ) : data.rows.map((r) => {
                                    const drillUrl = r.source?.url ?? `/office/accountancy/journal-entries/${r.id}`;
                                    const isOpen = expanded.has(r.id);
                                    return (
                                        <Fragment key={r.id}>
                                            <tr
                                                className="border-b last:border-0 hover:bg-muted/40 cursor-pointer"
                                                title="Right-click to see accounts · Left-click to open voucher"
                                                onClick={() => router.push(drillUrl)}
                                                onContextMenu={(e) => { e.preventDefault(); toggleExpand(r.id); }}
                                            >
                                                <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">
                                                    {new Date(r.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" })}
                                                </td>
                                                <td className="px-3 py-2.5">
                                                    <span className={`text-xs px-2 py-0.5 border font-medium rounded-sm ${KIND_COLOR[r.kind]}`}>
                                                        {r.kind}
                                                    </span>
                                                </td>
                                                {/* Reference column hidden by default — uncomment for troubleshooting.
                                                    <td className="px-3 py-2.5 font-mono text-primary">{r.reference}</td>  */}
                                                <td className="px-3 py-2.5 text-foreground truncate max-w-md">{r.description}</td>
                                                <td className="px-3 py-2.5 text-right font-mono whitespace-nowrap">
                                                    {r.principal ? (
                                                        <>
                                                            {fmt(r.principal.amount)}
                                                            <span className="ml-1 text-[10px] uppercase text-muted-foreground">
                                                                {r.principal.side === "DEBIT" ? "Dr" : "Cr"}
                                                            </span>
                                                        </>
                                                    ) : <span className="text-muted-foreground/40">—</span>}
                                                </td>
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
                                            {isOpen && r.lines.map((l, i) => (
                                                <tr key={`${r.id}-line-${i}`} className="bg-muted/20 border-b last:border-0">
                                                    <td />
                                                    <td />
                                                    <td className="px-3 py-1 italic text-sm" style={{ paddingLeft: 28 }}>
                                                        <span className="text-muted-foreground mr-1">{l.side === "DEBIT" ? "By" : "To"}</span>
                                                        <Link
                                                            href={`/office/accountancy/account/${l.accountId}`}
                                                            onClick={(e) => e.stopPropagation()}
                                                            className="hover:underline hover:text-primary"
                                                        >
                                                            {l.accountName}
                                                        </Link>
                                                        {l.description && <span className="ml-2 text-xs text-muted-foreground">— {l.description}</span>}
                                                    </td>
                                                    <td className="px-3 py-1 text-right font-mono text-xs whitespace-nowrap">
                                                        {fmt(l.amount)}
                                                        <span className="ml-1 text-[10px] text-muted-foreground">
                                                            {l.side === "DEBIT" ? "Dr" : "Cr"}
                                                        </span>
                                                    </td>
                                                    <td />
                                                </tr>
                                            ))}
                                        </Fragment>
                                    );
                                })}
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
