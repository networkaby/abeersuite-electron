"use client";

// Optional Vouchers — consolidated chronological listing of the six non-GL
// inventory voucher types (Sales Order, Purchase Order, GRN, Challan,
// Rejection In, Rejection Out). "Optional" follows Tally convention — these
// vouchers store information and (where applicable) move stock, but do not
// post to the general ledger. Modelled on Day Book.

import { useEffect, useState, useCallback, useRef, Fragment } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, ChevronLeft, ChevronRight, Search, ArrowDownToLine, ArrowUpFromLine, Trash2 } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { fmt, JOURNAL_STATUS_COLORS } from "@/utils/constants";
import { indianFiscalYearStart } from "@/modules/accountancy/lib/period";
import { TallyDateInput } from "@/shared/components/TallyDateInput";
import { toIsoDate } from "@/shared/hooks/useTallyDate";
import { editFormUrl } from "@/modules/inventory/components/VoucherActionsMenu";

type OptionalType =
    | "SALES_ORDER" | "PURCHASE_ORDER"
    | "GRN" | "CHALLAN"
    | "REJECTION_IN" | "REJECTION_OUT";

const TYPE_LABEL: Record<OptionalType, string> = {
    SALES_ORDER:    "Sales Order",
    PURCHASE_ORDER: "Purchase Order",
    GRN:            "GRN",
    CHALLAN:        "Challan",
    REJECTION_IN:   "Rejection In",
    REJECTION_OUT:  "Rejection Out",
};

// (TYPE_ROUTE removed — use editFormUrl() from VoucherActionsMenu so
//  the drill goes to the editable form, not the read-only detail.)

const TYPE_COLOR: Record<OptionalType, string> = {
    SALES_ORDER:    "bg-green-50 text-green-700 border-green-200",
    PURCHASE_ORDER: "bg-blue-50 text-blue-700 border-blue-200",
    GRN:            "bg-cyan-50 text-cyan-700 border-cyan-200",
    CHALLAN:        "bg-amber-50 text-amber-700 border-amber-200",
    REJECTION_IN:   "bg-pink-50 text-pink-700 border-pink-200",
    REJECTION_OUT:  "bg-rose-50 text-rose-700 border-rose-200",
};

type TypeFilter = "All" | OptionalType;
const TYPE_FILTERS: TypeFilter[] = ["All", "SALES_ORDER", "PURCHASE_ORDER", "GRN", "CHALLAN", "REJECTION_IN", "REJECTION_OUT"];

type RowLine = {
    id:          number;
    productId:   number;
    productName: string;
    productSku:  string;
    description: string | null;
    quantity:    number;
    rate:        number;
    amount:      number;
};
type Row = {
    id:          number;
    date:        string;
    type:        OptionalType;
    reference:   string;
    description: string;
    partyName:   string | null;
    partyType:   string | null;
    partyId:     number | null;
    status:      "DRAFT" | "POSTED" | "CANCELLED";
    deletedAt:   string | null;
    totalAmount: number;
    stockDir:    "IN" | "OUT" | "NONE";
    refVoucher:  { id: number; reference: string; type: string } | null;
    lineCount:   number;
    lines:       RowLine[];
};
type Data = {
    from:  string | null;
    to:    string | null;
    rows:  Row[];
    total: number;
    page:  number;
    limit: number;
};

export default function OptionalVouchersPage() {
    const router = useRouter();
    const fyStart = indianFiscalYearStart();
    const [from, setFrom] = useState(toIsoDate(fyStart));
    const [to, setTo]     = useState(toIsoDate(new Date()));
    const [search, setSearch] = useState("");
    const [typeFilter, setTypeFilter] = useState<TypeFilter>("All");
    const [page, setPage] = useState(1);
    const [data, setData] = useState<Data | null>(null);
    const [loading, setLoading] = useState(false);
    const [expanded, setExpanded] = useState<Set<number>>(new Set());
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Esc collapses expanded rows; if none expanded, goes back.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== "Escape") return;
            const t = e.target as HTMLElement | null;
            if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
            if (document.querySelector('[data-state="open"][role="dialog"]')) return;
            if (expanded.size > 0) setExpanded(new Set());
            else                   router.back();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [expanded, router]);

    const toggleExpand = (id: number) => setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
    });

    const load = useCallback((p: number, q: string, t: TypeFilter) => {
        setLoading(true);
        const params = new URLSearchParams({ from, to, page: String(p), limit: "50" });
        if (q)            params.set("search", q);
        if (t !== "All")  params.set("type",   t);
        axios.get<Data>(`/api/inventory/vouchers/optional?${params}`)
            .then((r) => setData(r.data))
            .catch(() => toast.error("Failed to load optional vouchers"))
            .finally(() => setLoading(false));
    }, [from, to]);

    const loadFirst = useCallback(() => { setPage(1); load(1, "", "All"); }, [load]);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(loadFirst, [loadFirst]);

    const handleSearch = (v: string) => {
        setSearch(v);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => { setPage(1); load(1, v, typeFilter); }, 400);
    };
    const handleType = (t: TypeFilter) => { setTypeFilter(t); setPage(1); load(1, search, t); };
    const goPage = (p: number) => { setPage(p); load(p, search, typeFilter); };

    const totalPages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

    return (
        <ScrollArea className="h-full" type="always">
        <div className="max-w-7xl mx-auto space-y-5 px-6 pt-3 pb-6">
            <div className="flex items-end justify-between gap-3 flex-wrap">
                <div>
                    <h1 className="text-2xl font-bold text-foreground">Optional Vouchers</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        SO · PO · GRN · Challan · Rejection In/Out — stock-only entries that don&apos;t post to the GL. Right-click a row to peek at line items.
                    </p>
                </div>
                <div className="flex items-end gap-2">
                    <div className="space-y-1"><Label>From</Label><TallyDateInput value={from} onValueChange={setFrom} className="w-auto" /></div>
                    <div className="space-y-1"><Label>To</Label><TallyDateInput value={to} onValueChange={setTo} monthMode="end" className="w-auto" /></div>
                    <Button onClick={() => { setPage(1); load(1, search, typeFilter); }}>Refresh</Button>
                </div>
            </div>

            <div className="flex items-center gap-2">
                <div className="relative flex-1">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        value={search}
                        onChange={(e) => handleSearch(e.target.value)}
                        placeholder="Search by reference, narration or party…"
                        className="pl-9"
                    />
                </div>
                <Select value={typeFilter} onValueChange={(v) => handleType(v as TypeFilter)}>
                    <SelectTrigger className="w-52" aria-label="Filter by voucher type">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {TYPE_FILTERS.map((t) => (
                            <SelectItem key={t} value={t}>
                                {t === "All" ? "All types" : TYPE_LABEL[t]}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            {loading && (
                <div className="flex justify-center py-20">
                    <Loader2 className="animate-spin text-muted-foreground" size={28} />
                </div>
            )}

            {!loading && data && (
                <>
                    <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
                        <table className="w-full text-sm">
                            <thead className="border-b bg-muted text-xs text-muted-foreground">
                                <tr>
                                    <th className="px-3 py-2 text-left font-medium">Date</th>
                                    <th className="px-3 py-2 text-left font-medium">Type</th>
                                    <th className="px-3 py-2 text-left font-medium">Voucher No</th>
                                    <th className="px-3 py-2 text-left font-medium">Party</th>
                                    <th className="px-3 py-2 text-left font-medium">Narration</th>
                                    <th className="px-3 py-2 text-center font-medium w-14">Stock</th>
                                    <th className="px-3 py-2 text-right font-medium">Total</th>
                                    <th className="px-3 py-2 text-left font-medium">Linked</th>
                                    <th className="px-3 py-2 text-center font-medium w-16">Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.rows.length === 0 ? (
                                    <tr><td colSpan={9} className="py-12 text-center text-muted-foreground text-sm">No optional vouchers in this period.</td></tr>
                                ) : data.rows.map((r) => {
                                    const isOpen = expanded.has(r.id);
                                    // Edit form — uses editFormUrl so the drill opens the editable
                                    // page (?voucherId=…) instead of read-only detail.
                                    const drillUrl = editFormUrl(r.type, r.id) ?? "";
                                    // Party link — customer/supplier → /office/customers/all?personId=N
                                    const partyHref = r.partyId != null
                                        && (r.partyType === "customer" || r.partyType === "supplier")
                                        ? `/office/customers/all?personId=${r.partyId}`
                                        : null;
                                    return (
                                        <Fragment key={r.id}>
                                            <tr
                                                className={`border-b last:border-0 hover:bg-muted/40 cursor-pointer ${r.deletedAt ? "opacity-60" : ""}`}
                                                title="Left-click to open voucher · Right-click to see line items"
                                                onClick={() => router.push(drillUrl)}
                                                onContextMenu={(e) => { e.preventDefault(); toggleExpand(r.id); }}
                                            >
                                                <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">
                                                    {new Date(r.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" })}
                                                </td>
                                                <td className="px-3 py-2.5">
                                                    <span className={`text-xs px-2 py-0.5 border font-medium rounded-sm ${TYPE_COLOR[r.type]}`}>
                                                        {TYPE_LABEL[r.type]}
                                                    </span>
                                                </td>
                                                <td className="px-3 py-2.5 font-mono text-primary text-xs whitespace-nowrap">{r.reference}</td>
                                                <td className="px-3 py-2.5 truncate max-w-[180px]" onClick={(e) => { if (partyHref) e.stopPropagation(); }}>
                                                    {r.partyName == null
                                                        ? <span className="text-muted-foreground/65">—</span>
                                                        : partyHref
                                                            ? <Link href={partyHref} className="text-primary hover:underline">{r.partyName}</Link>
                                                            : r.partyName}
                                                </td>
                                                <td className="px-3 py-2.5 text-muted-foreground truncate max-w-[260px]">{r.description}</td>
                                                <td className="px-3 py-2.5 text-center">
                                                    {r.stockDir === "IN"  ? <ArrowDownToLine size={14} className="inline text-green-600" />
                                                  : r.stockDir === "OUT" ? <ArrowUpFromLine size={14} className="inline text-blue-600" />
                                                  :                        <span className="text-muted-foreground/65">—</span>}
                                                </td>
                                                <td className="px-3 py-2.5 text-right font-mono tabular-nums whitespace-nowrap">
                                                    {r.totalAmount > 0 ? `₹ ${fmt(r.totalAmount)}` : <span className="text-muted-foreground/65">—</span>}
                                                </td>
                                                <td className="px-3 py-2.5">
                                                    {r.refVoucher ? (
                                                        <Link
                                                            href={editFormUrl(r.refVoucher.type, r.refVoucher.id) ?? drillUrl}
                                                            onClick={(e) => e.stopPropagation()}
                                                            className="text-xs text-primary hover:underline font-mono"
                                                        >
                                                            {r.refVoucher.reference} ↗
                                                        </Link>
                                                    ) : <span className="text-muted-foreground/65 text-xs">—</span>}
                                                </td>
                                                <td className="px-3 py-2.5 text-center">
                                                    <span className={`text-xs px-2 py-0.5 font-medium rounded-sm ${JOURNAL_STATUS_COLORS[r.status]}`}>{r.status}</span>
                                                    {r.deletedAt && (
                                                        <span className="ml-1 inline-flex items-center rounded bg-destructive/10 px-1 py-0.5 text-[10px] uppercase text-destructive">
                                                            <Trash2 size={9} />
                                                        </span>
                                                    )}
                                                </td>
                                            </tr>
                                            {isOpen && r.lines.map((l, i) => (
                                                <tr key={`${r.id}-line-${i}`} className="bg-muted/20 border-b last:border-0">
                                                    <td />
                                                    <td />
                                                    <td className="px-3 py-1 text-xs text-muted-foreground italic">
                                                        Item #{i + 1}
                                                    </td>
                                                    <td colSpan={3} className="px-3 py-1 text-xs">
                                                        <span className="font-medium">{l.productName}</span>
                                                        <span className="text-muted-foreground ml-2 font-mono">{l.productSku}</span>
                                                        {l.description && <span className="ml-2 text-muted-foreground">— {l.description}</span>}
                                                    </td>
                                                    <td className="px-3 py-1 text-right font-mono text-xs tabular-nums">
                                                        {l.quantity} × ₹{fmt(l.rate)}
                                                    </td>
                                                    <td className="px-3 py-1 text-right font-mono text-xs tabular-nums">
                                                        {l.amount > 0 ? `₹ ${fmt(l.amount)}` : "—"}
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
        </ScrollArea>
    );
}
