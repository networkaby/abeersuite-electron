"use client";

// Pending Vouchers — inventory-in-flight vouchers (category 2b) awaiting
// settlement. Surfaces CHALLAN / GRN / REJECTION_IN / REJECTION_OUT rows
// whose refReturns has no active (non-CANCELLED) settling voucher.
// See plan: voucher taxonomy + per-type settlement rules.

import { useEffect, useState, Fragment } from "react";
import { partyProfileHref, type PartyLinkKind } from "@/shared/lib/parties";
import { useRouter } from "next/navigation";
import { GatedLink } from "@/shared/components/GatedLink";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, ChevronLeft, ChevronRight as ChevronRightIcon, Search, Clock, ArrowRight, Link2, PackageSearch, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TallyDateInput } from "@/shared/components/TallyDateInput";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { fmt } from "@/shared/lib/format/moneyInr";
import { editFormUrl } from "@/modules/inventory/components/VoucherActionsMenu";
import { useApiResource } from "@/shared/hooks/useApiResource";
import { usePagedQuery } from "@/shared/hooks/usePagedQuery";
import { useDebouncedValue } from "@/shared/hooks/useDebouncedValue";
import { useEscape } from "@/shared/hooks/useEscape";

type PendingType = "CHALLAN" | "GRN" | "REJECTION_IN" | "REJECTION_OUT";

const TYPE_LABEL: Record<PendingType, string> = {
    CHALLAN: "Challan",
    GRN: "GRN",
    REJECTION_IN: "Rejection In",
    REJECTION_OUT: "Rejection Out",
};

const TYPE_ROUTE: Record<PendingType, string> = {
    CHALLAN: "/vouchers/challans",
    GRN: "/vouchers/grn",
    REJECTION_IN: "/vouchers/rejections-in",
    REJECTION_OUT: "/vouchers/rejections-out",
};

const TYPE_COLOR: Record<PendingType, string> = {
    CHALLAN: "bg-amber-50 text-amber-700 border-amber-200",
    GRN: "bg-cyan-50  text-cyan-700  border-cyan-200",
    REJECTION_IN: "bg-pink-50  text-pink-700  border-pink-200",
    REJECTION_OUT: "bg-rose-50  text-rose-700  border-rose-200",
};

const SETTLES_VIA: Record<PendingType, string> = {
    CHALLAN: "Sale or Rejection In",
    GRN: "Purchase or Rejection Out",
    REJECTION_IN: "Challan or Sale Return",
    REJECTION_OUT: "GRN or Purchase Return",
};

// Types that can settle each pending type (API values).
const SETTLES_BY: Record<PendingType, string[]> = {
    CHALLAN: ["SALE", "REJECTION_IN"],
    GRN: ["PURCHASE", "REJECTION_OUT"],
    REJECTION_IN: ["CHALLAN", "SALE_RETURN"],
    REJECTION_OUT: ["GRN", "PURCHASE_RETURN"],
};

// Human labels for settling types (used in the dialog).
const SETTLING_LABEL: Record<string, string> = {
    SALE: "Sale Invoice",
    REJECTION_IN: "Rejection In",
    PURCHASE: "Purchase Invoice",
    REJECTION_OUT: "Rejection Out",
    CHALLAN: "Challan",
    SALE_RETURN: "Sale Return",
    GRN: "GRN",
    PURCHASE_RETURN: "Purchase Return",
};

// Badge colors for settling types in the dialog list.
const SETTLING_COLOR: Record<string, string> = {
    SALE: "bg-blue-50 text-blue-700 border-blue-200",
    REJECTION_IN: "bg-pink-50 text-pink-700 border-pink-200",
    PURCHASE: "bg-violet-50 text-violet-700 border-violet-200",
    REJECTION_OUT: "bg-rose-50 text-rose-700 border-rose-200",
    CHALLAN: "bg-amber-50 text-amber-700 border-amber-200",
    SALE_RETURN: "bg-orange-50 text-orange-700 border-orange-200",
    GRN: "bg-cyan-50 text-cyan-700 border-cyan-200",
    PURCHASE_RETURN: "bg-teal-50 text-teal-700 border-teal-200",
};

// Navigation routes for creating a new settling voucher.
const SETTLE_NEW_ROUTE: Record<string, string> = {
    SALE: "/vouchers/sales/new",
    REJECTION_IN: "/vouchers/rejections-in/new",
    PURCHASE: "/vouchers/purchases/new",
    REJECTION_OUT: "/vouchers/rejections-out/new",
    CHALLAN: "/vouchers/challans/new",
    SALE_RETURN: "/vouchers/sale-returns/new",
    GRN: "/vouchers/grn/new",
    PURCHASE_RETURN: "/vouchers/purchase-returns/new",
};

type TypeFilter = "All" | PendingType;
const TYPE_FILTERS: TypeFilter[] = ["All", "CHALLAN", "GRN", "REJECTION_IN", "REJECTION_OUT"];

type RowLine = {
    id: number;
    productId: number;
    productName: string;
    productSku: string;
    description: string | null;
    quantity: number;
    rate: number;
    amount: number;
};
type Row = {
    id: number;
    reference: string;
    type: PendingType;
    date: string;
    partyId: number | null;
    partyType: string | null;
    partyKind: PartyLinkKind | null;
    partyEntityId: number | null;
    partyName: string | null;
    description: string;
    totalAmount: number;
    lineCount: number;
    branchName: string | null;
    daysOpen: number;
    lines: RowLine[];
};
type Data = {
    from: string | null;
    to: string | null;
    rows: Row[];
    total: number;
    page: number;
    limit: number;
};

type LinkableRow = {
    id: number;
    reference: string;
    type: string;
    date: string;
    partyId: number | null;
    partyName: string | null;
    totalAmount: number;
};

// ── Stock tab types ──────────────────────────────────────────────────────────

type StockLine = {
    voucherId: number;
    reference: string;
    type: string;
    date: string;
    quantity: number;
    direction: "in" | "out";
    branchId: string;
    branchName: string | null;
    daysOpen: number;
};

type StockRow = {
    productId: number;
    productName: string;
    productSku: string;
    unitCode: string;
    totalIn: number;
    totalOut: number;
    pendingLines: StockLine[];
};

const DIRECTION_COLOR: Record<"in" | "out", string> = {
    in: "bg-cyan-50 text-cyan-700 border-cyan-200",
    out: "bg-amber-50 text-amber-700 border-amber-200",
};

function ageClass(days: number): string {
    if (days < 7) return "text-green-600";
    if (days < 30) return "text-amber-600";
    return "text-red-600 font-semibold";
}

// ── Settle dialog ────────────────────────────────────────────────────────────

function SettleDialog({
    target,
    onClose,
    onLinked,
}: {
    target: Row | null;
    onClose: () => void;
    onLinked: () => void;
}) {
    const router = useRouter();
    const [linkable, setLinkable] = useState<LinkableRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [linking, setLinking] = useState<number | null>(null);

    useEffect(() => {
        if (!target) { setLinkable([]); return; }
        const params = new URLSearchParams({ types: SETTLES_BY[target.type].join(",") });
        // Party filter — only show vouchers for the same customer/supplier.
        if (target.partyId) params.set("partyId", String(target.partyId));
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
                                        <th className="px-3 py-2 text-left font-medium">Voucher No</th>
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
                                                {v.partyName ?? <span className="text-muted-foreground/65">—</span>}
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
                        In the new form, use the <span className="font-medium">&ldquo;Convert from {TYPE_LABEL[target.type]}&rdquo;</span> picker to link it back automatically.
                    </p>
                    <div className="flex gap-2 flex-wrap">
                        {settleTypes.map((t) => (
                            <Button
                                key={t}
                                variant="outline"
                                size="sm"
                                onClick={() => { router.push(`${SETTLE_NEW_ROUTE[t]}?parentId=${target.id}`); onClose(); }}
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

const NO_STOCK: StockRow[] = [];

export default function PendingVouchersPage() {
    const router = useRouter();

    // ── Shared filter state ───────────────────────────────────────────────────
    const [tab, setTab] = useState<"vouchers" | "stock">("vouchers");
    const [from, setFrom] = useState("");
    const [to, setTo] = useState("");
    const [branchId, setBranchId] = useState("all");
    const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);

    // ── Vouchers tab state ────────────────────────────────────────────────────
    const [search, setSearch] = useState("");
    const [typeFilter, setTypeFilter] = useState<TypeFilter>("All");
    const [expanded, setExpanded] = useState<Set<number>>(new Set());
    const [settleTarget, setSettleTarget] = useState<Row | null>(null);
    // The dates the lists were last asked for — the boxes apply on Refresh.
    const [range, setRange] = useState({ from: "", to: "" });

    // ── Stock tab state ───────────────────────────────────────────────────────
    // Read once the tab is first opened, then it follows the filters.
    const [stockOpened, setStockOpened] = useState(false);
    const [stockExpanded, setStockExpanded] = useState<Set<number>>(new Set());

    useEffect(() => {
        axios.get<{ id: string; name: string }[]>("/api/branches")
            .then((r) => setBranches(r.data))
            .catch(() => { });
    }, []);

    // Esc collapses expanded rows; if none expanded, goes back. An open dialog or
    // menu takes its own Esc first (see useEscape).
    useEscape(() => {
        if (expanded.size > 0) { setExpanded(new Set()); return; }
        if (stockExpanded.size > 0) { setStockExpanded(new Set()); return; }
        router.back();
    });

    const toggleExpand = (id: number) => setExpanded((prev) => {
        const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next;
    });
    const toggleStockExpand = (id: number) => setStockExpanded((prev) => {
        const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next;
    });

    // ── Vouchers fetch ────────────────────────────────────────────────────────
    // Each list is asked for from what the boxes say, so a reply for filters
    // the screen has moved away from is dropped, and any filter change starts
    // at page 1 in one read (usePagedQuery). Only the visible tab follows the
    // books live; a realtime refresh keeps the rows on screen.
    const debouncedSearch = useDebouncedValue(search, 400);
    const branchParam = branchId !== "all" ? branchId : null;
    const {
        data = null, loading, error, reload, page, setPage,
    } = usePagedQuery<Data>(
        "/api/accountancy/reports/pending-vouchers",
        {
            limit: 50, from: range.from, to: range.to, search: debouncedSearch,
            type: typeFilter !== "All" ? typeFilter : null, branchId: branchParam,
        },
        { topics: tab === "vouchers" ? ["ledger"] : [] },
    );
    useEffect(() => { if (error) toast.error("Failed to load pending vouchers"); }, [error]);

    // ── Stock fetch ───────────────────────────────────────────────────────────
    const stockQuery = new URLSearchParams();
    if (range.from) stockQuery.set("from", range.from);
    if (range.to) stockQuery.set("to", range.to);
    if (branchParam) stockQuery.set("branchId", branchParam);
    const stock = useApiResource<{ rows: StockRow[] }>(
        stockOpened ? `/api/accountancy/reports/pending-stock?${stockQuery}` : null,
        { topics: tab === "stock" ? ["ledger"] : [] },
    );
    useEffect(() => { if (stock.error) toast.error("Failed to load pending stock"); }, [stock.error]);
    const stockRows = stock.data?.rows ?? NO_STOCK;
    const stockLoading = stock.loading;

    // Refresh applies the dates; with the dates unchanged it re-reads the tab.
    const handleRange = () => {
        if (range.from !== from || range.to !== to) setRange({ from, to });
        else if (tab === "vouchers") void reload();
        else void stock.reload();
    };

    const switchTab = (t: "vouchers" | "stock") => {
        setTab(t);
        if (t === "stock") setStockOpened(true);
    };

    const totalPages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;
    const totalValue = data?.rows.reduce((s, r) => s + r.totalAmount, 0) ?? 0;
    const oldestDays = data && data.rows.length > 0 ? Math.max(...data.rows.map((r) => r.daysOpen)) : 0;

    // stock summary
    const stockProductCount = stockRows.length;
    const stockOldestDays = stockRows.length > 0
        ? Math.max(...stockRows.flatMap((r) => r.pendingLines.map((l) => l.daysOpen)))
        : 0;

    return (
        <ScrollArea className="h-full" type="always">
            <div className="w-full mx-auto space-y-5 px-2 pt-3 pb-6">

                {/* ── Header ─────────────────────────────────────────────────── */}
                <div className="flex items-end justify-between gap-3 flex-wrap">
                    <div>
                        <h1 className="text-2xl font-bold text-foreground">Pending Vouchers &amp; Stock</h1>
                        <p className="text-sm text-muted-foreground mt-0.5">
                            Unsettled Challans · GRNs · Rejections — both by voucher and by product.
                        </p>
                    </div>
                    <div className="flex items-end gap-2 flex-wrap">
                        <div className="space-y-1"><Label>From</Label><TallyDateInput value={from} onValueChange={setFrom} className="w-auto" /></div>
                        <div className="space-y-1"><Label>To</Label><TallyDateInput value={to} onValueChange={setTo} monthMode="end" className="w-auto" /></div>
                        {branches.length > 1 && (
                            <div className="space-y-1">
                                <Label>Branch</Label>
                                <Select value={branchId} onValueChange={setBranchId}>
                                    <SelectTrigger className="h-9 w-36">
                                        <SelectValue placeholder="All branches" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All branches</SelectItem>
                                        {branches.map((b) => (
                                            <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        )}
                        <Button onClick={handleRange}>Refresh</Button>
                    </div>
                </div>

                {/* ── Tabs ───────────────────────────────────────────────────── */}
                <div className="flex gap-1 border-b">
                    <button
                        className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === "vouchers" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
                        onClick={() => switchTab("vouchers")}
                    >
                        Pending Vouchers
                        {data && <span className="ml-2 text-xs bg-muted px-1.5 py-0.5 rounded-full">{data.total}</span>}
                    </button>
                    <button
                        className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${tab === "stock" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
                        onClick={() => switchTab("stock")}
                    >
                        <PackageSearch size={14} />
                        Pending Stock
                        {stockRows.length > 0 && <span className="text-xs bg-muted px-1.5 py-0.5 rounded-full">{stockProductCount}</span>}
                    </button>
                </div>

                {/* ══════════════════════════════════════════════════════════════
                TAB: PENDING VOUCHERS
            ══════════════════════════════════════════════════════════════ */}
                {tab === "vouchers" && (
                    <>
                        <div className="flex items-center gap-2">
                            <div className="relative flex-1">
                                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                                <Input
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
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
                                        onClick={() => setTypeFilter(t)}
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

                        {loading && <div className="flex justify-center py-20"><Loader2 className="animate-spin text-muted-foreground" size={28} /></div>}

                        {!loading && data && (
                            <>
                                <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
                                    <table className="w-full text-sm">
                                        <thead className="border-b bg-muted text-xs text-muted-foreground">
                                            <tr>
                                                <th className="px-3 py-2 text-left font-medium">Date</th>
                                                <th className="px-3 py-2 text-left font-medium">Type</th>
                                                <th className="px-3 py-2 text-left font-medium">Voucher No</th>
                                                <th className="px-3 py-2 text-left font-medium">Branch</th>
                                                <th className="px-3 py-2 text-left font-medium">Party</th>
                                                <th className="px-3 py-2 text-left font-medium">Narration</th>
                                                <th className="px-3 py-2 text-right font-medium">Total</th>
                                                <th className="px-3 py-2 text-right font-medium">Open</th>
                                                <th className="px-3 py-2 text-left font-medium">Settles via</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {data.rows.length === 0 ? (
                                                <tr><td colSpan={9} className="py-12 text-center text-muted-foreground text-sm">
                                                    No pending vouchers — everything is settled.
                                                </td></tr>
                                            ) : data.rows.map((r) => {
                                                const isOpen = expanded.has(r.id);
                                                // Edit form — `editFormUrl` produces /vouchers/{kind}/new?voucherId=N.
                                                // The local TYPE_ROUTE map is kept (and used for the StockRow tab below
                                                // + for SETTLE_NEW_ROUTE) to avoid touching unrelated code paths.
                                                const drillUrl = editFormUrl(r.type, r.id) ?? `${TYPE_ROUTE[r.type]}/new?voucherId=${r.id}`;
                                                // The server decided Person vs Company (following a conversion
                                                // where needed); `partyType` is only the role on the document.
                                                const partyHref = partyProfileHref(r.partyKind, r.partyEntityId);
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
                                                            <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{r.branchName ?? <span className="text-muted-foreground/65">—</span>}</td>
                                                            <td className="px-3 py-2.5 truncate max-w-[180px]" onClick={(e) => { if (partyHref) e.stopPropagation(); }}>
                                                                {r.partyName == null
                                                                    ? <span className="text-muted-foreground/65">—</span>
                                                                    : partyHref
                                                                        ? <GatedLink whenLocked="text" href={partyHref} className="text-primary hover:underline">{r.partyName}</GatedLink>
                                                                        : r.partyName}
                                                            </td>
                                                            <td className="px-3 py-2.5 text-muted-foreground truncate max-w-[260px]">{r.description}</td>
                                                            <td className="px-3 py-2.5 text-right font-mono tabular-nums whitespace-nowrap">
                                                                {r.totalAmount > 0 ? `₹ ${fmt(r.totalAmount)}` : <span className="text-muted-foreground/65">—</span>}
                                                            </td>
                                                            <td className={`px-3 py-2.5 text-right font-mono tabular-nums whitespace-nowrap ${ageClass(r.daysOpen)}`}>
                                                                {r.daysOpen}d
                                                            </td>
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
                                                                <td /><td /><td />
                                                                <td className="px-3 py-1 text-xs text-muted-foreground italic">Item #{i + 1}</td>
                                                                <td colSpan={3} className="px-3 py-1 text-xs">
                                                                    <span className="font-medium">{l.productName}</span>
                                                                    <span className="text-muted-foreground ml-2 font-mono">{l.productSku}</span>
                                                                    {l.description && <span className="ml-2 text-muted-foreground">— {l.description}</span>}
                                                                </td>
                                                                <td className="px-3 py-1 text-right font-mono text-xs tabular-nums">{l.quantity} × ₹{fmt(l.rate)}</td>
                                                                <td className="px-3 py-1 text-right font-mono text-xs tabular-nums">{l.amount > 0 ? `₹ ${fmt(l.amount)}` : "—"}</td>
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
                                            <Button variant="outline" size="sm" onClick={() => setPage(page - 1)} disabled={page <= 1}>
                                                <ChevronLeft size={14} /> Prev
                                            </Button>
                                            <span className="text-xs px-2">Page {page} of {totalPages}</span>
                                            <Button variant="outline" size="sm" onClick={() => setPage(page + 1)} disabled={page >= totalPages}>
                                                Next <ChevronRightIcon size={14} />
                                            </Button>
                                        </div>
                                    </div>
                                )}
                            </>
                        )}

                        <SettleDialog
                            target={settleTarget}
                            onClose={() => setSettleTarget(null)}
                            onLinked={() => { void reload(); }}
                        />
                    </>
                )}

                {/* ══════════════════════════════════════════════════════════════
                TAB: PENDING STOCK
            ══════════════════════════════════════════════════════════════ */}
                {tab === "stock" && (
                    <>
                        {stockRows.length > 0 && (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div className="rounded-lg border border-border bg-card p-3">
                                    <div className="text-xs text-muted-foreground">Products with pending stock</div>
                                    <div className="text-2xl font-semibold mt-0.5">{stockProductCount}</div>
                                </div>
                                <div className="rounded-lg border border-border bg-card p-3">
                                    <div className="text-xs text-muted-foreground">Oldest pending</div>
                                    <div className={`text-2xl font-semibold mt-0.5 ${ageClass(stockOldestDays)}`}>
                                        <Clock size={16} className="inline mr-1 -mt-1" />
                                        {stockOldestDays} {stockOldestDays === 1 ? "day" : "days"}
                                    </div>
                                </div>
                            </div>
                        )}

                        {stockLoading && <div className="flex justify-center py-20"><Loader2 className="animate-spin text-muted-foreground" size={28} /></div>}

                        {!stockLoading && (
                            <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
                                <table className="w-full text-sm">
                                    <thead className="border-b bg-muted text-xs text-muted-foreground">
                                        <tr>
                                            <th className="px-3 py-2 w-6" />
                                            <th className="px-3 py-2 text-left font-medium">Product</th>
                                            <th className="px-3 py-2 text-left font-medium">SKU</th>
                                            <th className="px-3 py-2 text-left font-medium">Unit</th>
                                            <th className="px-3 py-2 text-right font-medium text-cyan-700">Pending In</th>
                                            <th className="px-3 py-2 text-right font-medium text-amber-700">Pending Out</th>
                                            <th className="px-3 py-2 text-right font-medium">Net</th>
                                            <th className="px-3 py-2 text-right font-medium">Vouchers</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {stockRows.length === 0 ? (
                                            <tr><td colSpan={8} className="py-12 text-center text-muted-foreground text-sm">
                                                No pending stock — all vouchers are settled.
                                            </td></tr>
                                        ) : stockRows.map((r) => {
                                            const isOpen = stockExpanded.has(r.productId);
                                            const net = r.totalIn - r.totalOut;
                                            return (
                                                <Fragment key={r.productId}>
                                                    <tr
                                                        className="border-b hover:bg-muted/40 cursor-pointer"
                                                        onClick={() => toggleStockExpand(r.productId)}
                                                    >
                                                        <td className="px-3 py-2.5 text-muted-foreground">
                                                            {isOpen
                                                                ? <ChevronDown size={14} />
                                                                : <ChevronRightIcon size={14} />}
                                                        </td>
                                                        <td className="px-3 py-2.5 font-medium">{r.productName}</td>
                                                        <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{r.productSku}</td>
                                                        <td className="px-3 py-2.5 text-xs text-muted-foreground">{r.unitCode}</td>
                                                        <td className="px-3 py-2.5 text-right font-mono tabular-nums text-cyan-700">
                                                            {r.totalIn > 0 ? `+${r.totalIn}` : <span className="text-muted-foreground/65">—</span>}
                                                        </td>
                                                        <td className="px-3 py-2.5 text-right font-mono tabular-nums text-amber-700">
                                                            {r.totalOut > 0 ? `-${r.totalOut}` : <span className="text-muted-foreground/65">—</span>}
                                                        </td>
                                                        <td className={`px-3 py-2.5 text-right font-mono tabular-nums font-semibold ${net > 0 ? "text-cyan-700" : net < 0 ? "text-amber-700" : "text-muted-foreground"}`}>
                                                            {net > 0 ? `+${net}` : net}
                                                        </td>
                                                        <td className="px-3 py-2.5 text-right text-xs text-muted-foreground">
                                                            {r.pendingLines.length}
                                                        </td>
                                                    </tr>
                                                    {isOpen && r.pendingLines.map((l, i) => (
                                                        <tr
                                                            key={`${r.productId}-line-${i}`}
                                                            className="bg-muted/20 border-b last:border-0 hover:bg-muted/40 cursor-pointer"
                                                            onClick={() => router.push(`${TYPE_ROUTE[l.type as PendingType]}/new?voucherId=${l.voucherId}`)}
                                                            title="Click to open voucher"
                                                        >
                                                            <td />
                                                            <td className="px-3 py-1.5 text-xs text-muted-foreground" colSpan={2}>
                                                                <span className={`inline-block text-xs px-1.5 py-0.5 border font-medium rounded-sm mr-2 ${DIRECTION_COLOR[l.direction]}`}>
                                                                    {l.direction === "in" ? "↓ IN" : "↑ OUT"}
                                                                </span>
                                                                <span className="font-mono text-primary">{l.reference}</span>
                                                                {l.branchName && <span className="ml-2 text-muted-foreground">{l.branchName}</span>}
                                                            </td>
                                                            <td className="px-3 py-1.5 text-xs text-muted-foreground">
                                                                {new Date(l.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" })}
                                                            </td>
                                                            <td className="px-3 py-1.5 text-right font-mono text-xs tabular-nums text-cyan-700">
                                                                {l.direction === "in" ? `+${l.quantity}` : ""}
                                                            </td>
                                                            <td className="px-3 py-1.5 text-right font-mono text-xs tabular-nums text-amber-700">
                                                                {l.direction === "out" ? `-${l.quantity}` : ""}
                                                            </td>
                                                            <td />
                                                            <td className={`px-3 py-1.5 text-right text-xs ${ageClass(l.daysOpen)}`}>
                                                                {l.daysOpen}d
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </Fragment>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </>
                )}
            </div>
        </ScrollArea>
    );
}
