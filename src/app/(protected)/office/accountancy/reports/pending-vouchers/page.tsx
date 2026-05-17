"use client";

// Pending Vouchers — inventory-in-flight vouchers (category 2b) awaiting
// settlement. Surfaces CHALLAN / GRN / REJECTION_IN / REJECTION_OUT rows
// whose refReturns has no active (non-CANCELLED) settling voucher.
// See plan: voucher taxonomy + per-type settlement rules.

import { useEffect, useState, useCallback, useRef, Fragment } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, ChevronLeft, ChevronRight, Search, Clock, ArrowRight, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { fmt } from "@/utils/constants";

type PendingType = "CHALLAN" | "GRN" | "REJECTION_IN" | "REJECTION_OUT";

const TYPE_LABEL: Record<PendingType, string> = {
    CHALLAN:       "Challan",
    GRN:           "GRN",
    REJECTION_IN:  "Rejection In",
    REJECTION_OUT: "Rejection Out",
};

const TYPE_ROUTE: Record<PendingType, string> = {
    CHALLAN:       "/vouchers/challans",
    GRN:           "/vouchers/grn",
    REJECTION_IN:  "/vouchers/rejections-in",
    REJECTION_OUT: "/vouchers/rejections-out",
};

const TYPE_COLOR: Record<PendingType, string> = {
    CHALLAN:       "bg-amber-50 text-amber-700 border-amber-200",
    GRN:           "bg-cyan-50  text-cyan-700  border-cyan-200",
    REJECTION_IN:  "bg-pink-50  text-pink-700  border-pink-200",
    REJECTION_OUT: "bg-rose-50  text-rose-700  border-rose-200",
};

const SETTLES_VIA: Record<PendingType, string> = {
    CHALLAN:       "Sale or Rejection In",
    GRN:           "Purchase or Rejection Out",
    REJECTION_IN:  "Challan or Sale Return",
    REJECTION_OUT: "GRN or Purchase Return",
};

// Types that can settle each pending type (API values).
const SETTLES_BY: Record<PendingType, string[]> = {
    CHALLAN:       ["SALE",    "REJECTION_IN"],
    GRN:           ["PURCHASE","REJECTION_OUT"],
    REJECTION_IN:  ["CHALLAN", "SALE_RETURN"],
    REJECTION_OUT: ["GRN",     "PURCHASE_RETURN"],
};

// Human labels for settling types (used in the dialog).
const SETTLING_LABEL: Record<string, string> = {
    SALE:             "Sale Invoice",
    REJECTION_IN:     "Rejection In",
    PURCHASE:         "Purchase Invoice",
    REJECTION_OUT:    "Rejection Out",
    CHALLAN:          "Challan",
    SALE_RETURN:      "Sale Return",
    GRN:              "GRN",
    PURCHASE_RETURN:  "Purchase Return",
};

// Badge colors for settling types in the dialog list.
const SETTLING_COLOR: Record<string, string> = {
    SALE:             "bg-blue-50 text-blue-700 border-blue-200",
    REJECTION_IN:     "bg-pink-50 text-pink-700 border-pink-200",
    PURCHASE:         "bg-violet-50 text-violet-700 border-violet-200",
    REJECTION_OUT:    "bg-rose-50 text-rose-700 border-rose-200",
    CHALLAN:          "bg-amber-50 text-amber-700 border-amber-200",
    SALE_RETURN:      "bg-orange-50 text-orange-700 border-orange-200",
    GRN:              "bg-cyan-50 text-cyan-700 border-cyan-200",
    PURCHASE_RETURN:  "bg-teal-50 text-teal-700 border-teal-200",
};

// Navigation routes for creating a new settling voucher.
const SETTLE_NEW_ROUTE: Record<string, string> = {
    SALE:             "/vouchers/sales/new",
    REJECTION_IN:     "/vouchers/rejections-in/new",
    PURCHASE:         "/vouchers/purchases/new",
    REJECTION_OUT:    "/vouchers/rejections-out/new",
    CHALLAN:          "/vouchers/challans/new",
    SALE_RETURN:      "/vouchers/sale-returns/new",
    GRN:              "/vouchers/grn/new",
    PURCHASE_RETURN:  "/vouchers/purchase-returns/new",
};

type TypeFilter = "All" | PendingType;
const TYPE_FILTERS: TypeFilter[] = ["All", "CHALLAN", "GRN", "REJECTION_IN", "REJECTION_OUT"];

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
    reference:   string;
    type:        PendingType;
    date:        string;
    partyId:     number | null;
    partyName:   string | null;
    description: string;
    totalAmount: number;
    lineCount:   number;
    daysOpen:    number;
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

type LinkableRow = {
    id:          number;
    reference:   string;
    type:        string;
    date:        string;
    partyId:     number | null;
    partyName:   string | null;
    totalAmount: number;
};

function ageClass(days: number): string {
    if (days < 7)  return "text-green-600";
    if (days < 30) return "text-amber-600";
    return "text-red-600 font-semibold";
}

// ── Settle dialog ────────────────────────────────────────────────────────────

function SettleDialog({
    target,
    onClose,
    onLinked,
}: {
    target:   Row | null;
    onClose:  () => void;
    onLinked: () => void;
}) {
    const router = useRouter();
    const [linkable, setLinkable] = useState<LinkableRow[]>([]);
    const [loading, setLoading]   = useState(false);
    const [linking, setLinking]   = useState<number | null>(null);

    useEffect(() => {
        if (!target) { setLinkable([]); return; }
        const params = new URLSearchParams({ types: SETTLES_BY[target.type].join(",") });
        // Party filter — only show vouchers for the same customer/supplier.
        if (target.partyId)        params.set("partyId",   String(target.partyId));
        else if (target.partyName) params.set("partyName", target.partyName);
        setLoading(true);
        axios.get<{ rows: LinkableRow[] }>(`/api/inventory/vouchers/linkable?${params}`)
            .then((r) => setLinkable(r.data.rows))
            .catch(() => toast.error("Failed to load vouchers"))
            .finally(() => setLoading(false));
    }, [target]);

    const handleLink = async (settlingId: number) => {
        if (!target) return;
        setLinking(settlingId);
        try {
            await axios.post(`/api/inventory/vouchers/${settlingId}/link`, { refVoucherId: target.id });
            toast.success("Linked — voucher removed from pending list");
            onLinked();
            onClose();
        } catch (err: unknown) {
            const msg = axios.isAxiosError(err) ? err.response?.data?.error : null;
            toast.error(msg ?? "Failed to link voucher");
        } finally {
            setLinking(null);
        }
    };

    if (!target) return null;

    const settleTypes = SETTLES_BY[target.type];
    const dateStr = new Date(target.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" });

    return (
        <Dialog open={!!target} onOpenChange={(o) => { if (!o) onClose(); }}>
            <DialogContent className="max-w-2xl">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Link2 size={16} className="text-muted-foreground" />
                        Settle {TYPE_LABEL[target.type]} — {target.reference}
                    </DialogTitle>
                    <DialogDescription>
                        {target.partyName && <span>{target.partyName} · </span>}
                        {dateStr}
                        {target.totalAmount > 0 && <span> · ₹ {fmt(target.totalAmount)}</span>}
                    </DialogDescription>
                </DialogHeader>

                {/* ── Link to existing ── */}
                <div className="space-y-2">
                    <p className="text-sm font-medium">
                        Link to an existing voucher
                        {(target.partyName || target.partyId) && (
                            <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                                — showing only vouchers for <span className="font-medium text-foreground">{target.partyName ?? `party #${target.partyId}`}</span>
                            </span>
                        )}
                    </p>
                    {loading && (
                        <div className="flex justify-center py-6">
                            <Loader2 className="animate-spin text-muted-foreground" size={20} />
                        </div>
                    )}
                    {!loading && linkable.length === 0 && (
                        <p className="text-sm text-muted-foreground py-4 text-center border rounded-md bg-muted/30">
                            No unlinked {settleTypes.map((t) => SETTLING_LABEL[t]).join(" or ")} vouchers
                            {(target.partyName || target.partyId) && (
                                <> for <span className="font-medium">{target.partyName ?? `party #${target.partyId}`}</span></>
                            )} found.
                        </p>
                    )}
                    {!loading && linkable.length > 0 && (
                        <div className="border rounded-md overflow-hidden">
                            <table className="w-full text-sm">
                                <thead className="bg-muted border-b text-xs text-muted-foreground">
                                    <tr>
                                        <th className="px-3 py-2 text-left font-medium">Date</th>
                                        <th className="px-3 py-2 text-left font-medium">Type</th>
                                        <th className="px-3 py-2 text-left font-medium">Reference</th>
                                        <th className="px-3 py-2 text-left font-medium">Party</th>
                                        <th className="px-3 py-2 text-right font-medium">Amount</th>
                                        <th className="px-3 py-2" />
                                    </tr>
                                </thead>
                                <tbody>
                                    {linkable.map((v) => (
                                        <tr key={v.id} className="border-b last:border-0 hover:bg-muted/30">
                                            <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                                                {new Date(v.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" })}
                                            </td>
                                            <td className="px-3 py-2">
                                                <span className={`text-xs px-2 py-0.5 border font-medium rounded-sm ${SETTLING_COLOR[v.type] ?? "bg-muted text-muted-foreground border-border"}`}>
                                                    {SETTLING_LABEL[v.type] ?? v.type}
                                                </span>
                                            </td>
                                            <td className="px-3 py-2 font-mono text-primary text-xs whitespace-nowrap">{v.reference}</td>
                                            <td className="px-3 py-2 text-muted-foreground truncate max-w-[140px]">
                                                {v.partyName ?? <span className="text-muted-foreground/40">—</span>}
                                            </td>
                                            <td className="px-3 py-2 text-right font-mono tabular-nums whitespace-nowrap">
                                                {v.totalAmount > 0 ? `₹ ${fmt(v.totalAmount)}` : "—"}
                                            </td>
                                            <td className="px-3 py-2 text-right">
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    className="h-7 text-xs"
                                                    disabled={!!linking}
                                                    onClick={() => handleLink(v.id)}
                                                >
                                                    {linking === v.id
                                                        ? <Loader2 size={11} className="animate-spin" />
                                                        : "Link ↗"}
                                                </Button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>

                {/* ── Create new ── */}
                <div className="space-y-2 pt-3 border-t">
                    <p className="text-sm font-medium">Or create a new settling voucher</p>
                    <p className="text-xs text-muted-foreground">
                        In the new form, use the <span className="font-medium">"Convert from {TYPE_LABEL[target.type]}"</span> picker to link it back automatically.
                    </p>
                    <div className="flex gap-2 flex-wrap">
                        {settleTypes.map((t) => (
                            <Button
                                key={t}
                                variant="outline"
                                size="sm"
                                onClick={() => { router.push(SETTLE_NEW_ROUTE[t]); onClose(); }}
                            >
                                + {SETTLING_LABEL[t]}
                            </Button>
                        ))}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function PendingVouchersPage() {
    const router = useRouter();
    const [from, setFrom]   = useState("");
    const [to, setTo]       = useState("");
    const [search, setSearch] = useState("");
    const [typeFilter, setTypeFilter] = useState<TypeFilter>("All");
    const [page, setPage]   = useState(1);
    const [data, setData]   = useState<Data | null>(null);
    const [loading, setLoading] = useState(false);
    const [expanded, setExpanded] = useState<Set<number>>(new Set());
    const [settleTarget, setSettleTarget] = useState<Row | null>(null);
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

    const load = useCallback((p: number, q: string, t: TypeFilter, f: string, x: string) => {
        setLoading(true);
        const params = new URLSearchParams({ page: String(p), limit: "50" });
        if (f)            params.set("from",   f);
        if (x)            params.set("to",     x);
        if (q)            params.set("search", q);
        if (t !== "All")  params.set("type",   t);
        axios.get<Data>(`/api/accountancy/reports/pending-vouchers?${params}`)
            .then((r) => setData(r.data))
            .catch(() => toast.error("Failed to load pending vouchers"))
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => { load(1, "", "All", "", ""); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

    const handleSearch = (v: string) => {
        setSearch(v);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => { setPage(1); load(1, v, typeFilter, from, to); }, 400);
    };
    const handleType   = (t: TypeFilter) => { setTypeFilter(t); setPage(1); load(1, search, t, from, to); };
    const handleRange  = ()              => { setPage(1); load(1, search, typeFilter, from, to); };
    const goPage       = (p: number)     => { setPage(p); load(p, search, typeFilter, from, to); };

    const totalPages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

    // Summary stats — across the loaded page only (server-side pagination keeps memory tight).
    const totalValue = data?.rows.reduce((s, r) => s + r.totalAmount, 0) ?? 0;
    const oldestDays = data && data.rows.length > 0 ? Math.max(...data.rows.map((r) => r.daysOpen)) : 0;

    return (
        <div className="max-w-7xl mx-auto space-y-5">
            <div className="flex items-end justify-between gap-3 flex-wrap">
                <div>
                    <h1 className="text-2xl font-bold text-foreground">Pending Vouchers</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        Posted Challans · GRNs · Rejection In/Out waiting for their settling voucher. Right-click a row to peek at line items.
                    </p>
                </div>
                <div className="flex items-end gap-2">
                    <div className="space-y-1"><Label>From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-auto" /></div>
                    <div className="space-y-1"><Label>To</Label><Input type="date" value={to}   onChange={(e) => setTo(e.target.value)}   className="w-auto" /></div>
                    <Button onClick={handleRange}>Refresh</Button>
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
                <div className="flex items-center gap-1">
                    {TYPE_FILTERS.map((t) => (
                        <Button
                            key={t}
                            variant={typeFilter === t ? "default" : "outline"}
                            size="sm"
                            onClick={() => handleType(t)}
                            className="text-xs"
                        >
                            {t === "All" ? "All" : TYPE_LABEL[t]}
                        </Button>
                    ))}
                </div>
            </div>

            {data && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="rounded-lg border border-border bg-card p-3">
                        <div className="text-xs text-muted-foreground">Pending count</div>
                        <div className="text-2xl font-semibold mt-0.5">{data.total.toLocaleString()}</div>
                    </div>
                    <div className="rounded-lg border border-border bg-card p-3">
                        <div className="text-xs text-muted-foreground">Total value (this page)</div>
                        <div className="text-2xl font-semibold mt-0.5 font-mono">₹ {fmt(totalValue)}</div>
                    </div>
                    <div className="rounded-lg border border-border bg-card p-3">
                        <div className="text-xs text-muted-foreground">Oldest open (this page)</div>
                        <div className={`text-2xl font-semibold mt-0.5 ${ageClass(oldestDays)}`}>
                            <Clock size={16} className="inline mr-1 -mt-1" />
                            {oldestDays} {oldestDays === 1 ? "day" : "days"}
                        </div>
                    </div>
                </div>
            )}

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
                                    <th className="px-3 py-2 text-left font-medium">Reference</th>
                                    <th className="px-3 py-2 text-left font-medium">Party</th>
                                    <th className="px-3 py-2 text-left font-medium">Narration</th>
                                    <th className="px-3 py-2 text-right font-medium">Total</th>
                                    <th className="px-3 py-2 text-right font-medium">Open</th>
                                    <th className="px-3 py-2 text-left font-medium">Settles via</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.rows.length === 0 ? (
                                    <tr><td colSpan={8} className="py-12 text-center text-muted-foreground text-sm">
                                        No pending vouchers — everything is settled.
                                    </td></tr>
                                ) : data.rows.map((r) => {
                                    const isOpen = expanded.has(r.id);
                                    const drillUrl = `${TYPE_ROUTE[r.type]}/${r.id}`;
                                    return (
                                        <Fragment key={r.id}>
                                            <tr
                                                className="border-b last:border-0 hover:bg-muted/40 cursor-pointer"
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
                                                <td className="px-3 py-2.5 truncate max-w-[180px]">{r.partyName ?? <span className="text-muted-foreground/50">—</span>}</td>
                                                <td className="px-3 py-2.5 text-muted-foreground truncate max-w-[260px]">{r.description}</td>
                                                <td className="px-3 py-2.5 text-right font-mono tabular-nums whitespace-nowrap">
                                                    {r.totalAmount > 0 ? `₹ ${fmt(r.totalAmount)}` : <span className="text-muted-foreground/40">—</span>}
                                                </td>
                                                <td className={`px-3 py-2.5 text-right font-mono tabular-nums whitespace-nowrap ${ageClass(r.daysOpen)}`}>
                                                    {r.daysOpen}d
                                                </td>
                                                {/* Clickable "Settles via" — opens the settle dialog */}
                                                <td
                                                    className="px-3 py-2.5 text-xs whitespace-nowrap group"
                                                    onClick={(e) => { e.stopPropagation(); setSettleTarget(r); }}
                                                >
                                                    <span className="inline-flex items-center gap-1 text-primary underline-offset-2 group-hover:underline cursor-pointer">
                                                        <ArrowRight size={11} className="opacity-60 shrink-0" />
                                                        {SETTLES_VIA[r.type]}
                                                    </span>
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

            {/* Settle dialog — opens when user clicks "Settles via" on a row */}
            <SettleDialog
                target={settleTarget}
                onClose={() => setSettleTarget(null)}
                onLinked={() => load(page, search, typeFilter, from, to)}
            />
        </div>
    );
}
