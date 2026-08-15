"use client";

// ── PosSalesRegister ──────────────────────────────────────────────────────────
// List of all POS sales (InvVoucher type=SALE, status=POSTED).
// Lives at /vouchers/pos — mirrors SalesRegister at /vouchers/sales.

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import axios from "axios";
import { toast } from "sonner";
import {
    Search, Loader2, Monitor, RotateCcw, ExternalLink, Printer, Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { TallyDateInput } from "@/shared/components/TallyDateInput";
import { fmt } from "@/utils/constants";
import { todayIso } from "@/shared/lib/format";
import { ActiveShiftBar, type ActiveShift } from "@/modules/pos/components/ActiveShiftBar";
import { ShiftOpenDialog } from "@/modules/pos/components/ShiftOpenDialog";

// ── Types ─────────────────────────────────────────────────────────────────────

type PosSale = {
    id: number;
    reference: string;
    date: string;
    description: string;
    paymentMode: string | null;
    refundMode: string | null;
    originalRef: string | null;
    totalAmount: string;
    amountReceived: string;
    branch: string;
    cashier: string;
    lineCount: number;
};

type ApiResponse = {
    total: number;
    items: PosSale[];
};

// Counter cash movements (Rcv receipts in / Exp expenditures out).
type CashMove = {
    id: string; voucherId: number | null; kind: "IN" | "OUT"; reference: string; date: string;
    amount: string; party: string; note: string | null; counter: string; cashier: string;
};

// Counter till cash book (ledger with running balance).
type CounterOpt = { id: number; name: string; tillAccount: { name: string } };
type LedgerRow = {
    id: number; date: string; reference: string; particulars: string;
    debit: number | null; credit: number | null; balance: number; printUrl: string | null;
};
type LedgerData = {
    counter: { id: number; name: string; tillAccountName: string };
    openingBalance: number; closingBalance: number; rows: LedgerRow[];
};

// POS Order / Estimate documents (POS_ORDER / POS_ESTIMATE InvVouchers).
// `_count.refReturns` > 0 ⇒ a sale was raised against it ⇒ converted (not pending).
type PosDoc = {
    id: number; reference: string; date: string;
    partyName: string | null; totalAmount: string; status: string; dealId: number | null;
    _count?: { refReturns: number };
};

const PAY_COLORS: Record<string, string> = {
    CASH: "bg-green-50 text-green-700",
    BANK_TRANSFER: "bg-blue-50 text-blue-700",
    CARD: "bg-purple-50 text-purple-700",
    MOBILE_PAYMENT: "bg-orange-50 text-orange-700",
};

const REFUND_COLORS: Record<string, string> = {
    CASH: "bg-green-50 text-green-700",
    CREDIT: "bg-blue-50 text-blue-700",
};

// ── Component ─────────────────────────────────────────────────────────────────

export function PosSalesRegister() {
    const [items, setItems] = useState<PosSale[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [q, setQ] = useState("");
    const [page, setPage] = useState(1);
    const limit = 50;

    // ── Active POS shift — the full status/money bar lives on this overview
    //    page (hidden on the billing screen to save space). Read + manage here.
    const [activeShift, setActiveShift] = useState<ActiveShift | null>(null);
    const [shiftLoaded, setShiftLoaded] = useState(false);
    const [shiftOpenOpen, setShiftOpenOpen] = useState(false);

    const refreshShift = useCallback(() => {
        axios.get<ActiveShift | null>("/api/pos/shifts/current")
            .then((r) => setActiveShift(r.data))
            .catch(() => setActiveShift(null))
            .finally(() => setShiftLoaded(true));
    }, []);
    useEffect(() => { refreshShift(); }, [refreshShift]);

    const [tab, setTab] = useState<"sales" | "returns" | "orders" | "estimates" | "cash" | "ledger">("sales");
    const [moves, setMoves] = useState<CashMove[]>([]);
    const [movesLoading, setMovesLoading] = useState(false);

    useEffect(() => {
        if (tab !== "cash") return;
        setMovesLoading(true);
        axios.get<{ items: CashMove[] }>("/api/pos/cash-movements?limit=100")
            .then((r) => setMoves(r.data.items))
            .catch(() => toast.error("Failed to load cash movements"))
            .finally(() => setMovesLoading(false));
    }, [tab]);

    // ── POS Orders / Estimates (POS_ORDER / POS_ESTIMATE vouchers) ───────────
    const [posDocs, setPosDocs] = useState<PosDoc[]>([]);
    const [posDocsLoading, setPosDocsLoading] = useState(false);
    const [docQuery, setDocQuery] = useState("");
    const [pendingOnly, setPendingOnly] = useState(false);
    // Shared OPTIONAL date range for Sales / Orders / Estimates / Cash tabs
    // (empty = all dates). The Cash Book tab keeps its own today-defaulted range.
    const [rangeFrom, setRangeFrom] = useState("");
    const [rangeTo, setRangeTo] = useState("");
    const inDateRange = (iso: string) => {
        const d = iso.slice(0, 10);
        if (rangeFrom && d < rangeFrom) return false;
        if (rangeTo && d > rangeTo) return false;
        return true;
    };
    // Client-side search match (Cash In/Out tab) over the given fields.
    const matchesQuery = (...fields: (string | null | undefined)[]) => {
        const t = docQuery.trim().toLowerCase();
        return !t || fields.some((f) => (f ?? "").toLowerCase().includes(t));
    };
    useEffect(() => {
        if (tab !== "orders" && tab !== "estimates") return;
        const type = tab === "orders" ? "POS_ORDER" : "POS_ESTIMATE";
        setPosDocsLoading(true);
        axios.get<PosDoc[]>(`/api/inventory/vouchers?type=${type}`)
            .then((r) => setPosDocs((Array.isArray(r.data) ? r.data : []).sort((a, b) => b.id - a.id)))
            .catch(() => toast.error(`Failed to load ${tab}`))
            .finally(() => setPosDocsLoading(false));
    }, [tab]);

    // Toggle a non-GL doc between Draft (not finalised) and Issued (given to party).
    async function toggleDocStatus(d: PosDoc) {
        const next = d.status === "POSTED" ? "DRAFT" : "POSTED";
        try {
            await axios.patch(`/api/inventory/vouchers/${d.id}/status`, { status: next });
            setPosDocs((arr) => arr.map((x) => (x.id === d.id ? { ...x, status: next } : x)));
            toast.success(next === "POSTED" ? "Marked Issued" : "Marked Draft");
        } catch {
            toast.error("Couldn't change status");
        }
    }

    // ── Till cash book (ledger) ──────────────────────────────────────────────
    const todayISO = todayIso();
    const [ledger, setLedger] = useState<LedgerData | null>(null);
    const [ledgerLoading, setLedgerLoading] = useState(false);

    // Lock to current counter from active shift
    useEffect(() => {
        if (tab !== "ledger" || !activeShift) return;
        // No need to fetch counters; use the counter from the active shift
    }, [tab, activeShift]);

    useEffect(() => {
        if (tab !== "ledger" || !activeShift) return;
        // Shared range; the cash book needs a bounded daily view, so empty ⇒ today.
        const effFrom = rangeFrom || todayISO;
        const effTo = rangeTo || todayISO;
        setLedgerLoading(true);
        axios.get<LedgerData>(`/api/pos/till-ledger?counterId=${activeShift.counter.id}&from=${effFrom}&to=${effTo}`)
            .then((r) => setLedger(r.data))
            .catch(() => toast.error("Failed to load till ledger"))
            .finally(() => setLedgerLoading(false));
    }, [tab, activeShift, rangeFrom, rangeTo, todayISO]);

    const listKind: "sale" | "returns" = tab === "returns" ? "returns" : "sale";
    const load = useCallback(async (kind: "sale" | "returns", search: string, pg: number, f: string, t: string) => {
        setLoading(true);
        try {
            const params = new URLSearchParams({
                kind: kind,
                limit: String(limit),
                page: String(pg),
                ...(search ? { q: search } : {}),
                ...(f ? { from: f } : {}),
                ...(t ? { to: t } : {}),
            });
            const { data } = await axios.get<ApiResponse>(`/api/pos/sales?${params}`);
            setItems(data.items);
            setTotal(data.total);
        } catch {
            toast.error(kind === "returns" ? "Failed to load POS returns" : "Failed to load POS sales");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { void load(listKind, q, page, rangeFrom, rangeTo); }, [load, listKind, q, page, rangeFrom, rangeTo]);

    const totalPages = Math.max(1, Math.ceil(total / limit));

    return (
        <div className="space-y-4 h-full">
            {/* ── Live shift bar ── the full status/money strip belongs here on
                the overview page; the billing screen (/vouchers/pos/new) keeps it
                folded into a ⋮ menu to save space. The ActiveShiftBar carries its
                own Office link; the "no shift" cover below adds its own so a way
                back home stays visible in both states. */}
            {activeShift ? (
                <div className="overflow-hidden rounded-lg border border-border">
                    <ActiveShiftBar
                        shift={activeShift}
                        onClosed={() => { setActiveShift(null); refreshShift(); }}
                        onHandoverCancelled={refreshShift}
                        rightSlot={
                            <Button asChild size="sm" className="h-7 text-xs">
                                <Link href="/vouchers/pos/new"><Plus size={14} /> New Sale</Link>
                            </Button>
                        }
                    />
                </div>
            ) : shiftLoaded ? (
                <div className="flex items-center gap-2 rounded-lg border border-amber-300/50 bg-amber-50 px-4 py-2 text-xs dark:bg-amber-950/30">
                    <span className="font-semibold text-amber-700 dark:text-amber-300">⚠ No shift open</span>
                    <span className="text-muted-foreground">Open a shift to start billing.</span>
                    <div className="ml-auto flex items-center gap-1.5">
                        <Button asChild size="sm" variant="outline" className="h-7 text-xs">
                            <a href="/office" target="_blank" rel="noopener noreferrer" title="Open the office in a new tab">
                                <ExternalLink size={12} /> Office
                            </a>
                        </Button>
                        <Button asChild size="sm" variant="outline" className="h-7 text-xs">
                            <Link href="/vouchers/pos/new"><Plus size={14} /> New Sale</Link>
                        </Button>
                        <Button size="sm" className="h-7 text-xs" onClick={() => setShiftOpenOpen(true)}>
                            Open shift
                        </Button>
                    </div>
                </div>
            ) : null}

            <ShiftOpenDialog
                open={shiftOpenOpen}
                onOpenChange={setShiftOpenOpen}
                onOpened={() => { setShiftOpenOpen(false); refreshShift(); }}
            />

            {/* ── Header ── */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-xl font-semibold flex items-center gap-2">
                        <Monitor size={18} className="text-primary" />
                        POS Sales  -  {total} {tab === "returns" ? `return${total !== 1 ? "s" : ""}` : `sale${total !== 1 ? "s" : ""}`} recorded
                    </h1>
                    {/* <p className="text-sm text-muted-foreground mt-0.5">
                        {total} {tab === "returns" ? `return${total !== 1 ? "s" : ""}` : `sale${total !== 1 ? "s" : ""}`} recorded
                    </p> */}
                </div>
            </div>

            {/* ── Tabs ── */}
            <div className="flex gap-1 border-b border-border">
                {([["sales", "Sales"], ["returns", "Returns"], ["orders", "Orders"], ["estimates", "Estimates"], ["cash", "Payment/Reciept"], ["ledger", "Cash Book"]] as const).map(([k, label]) => (
                    <button
                        key={k}
                        type="button"
                        onClick={() => setTab(k)}
                        className={`-mb-px border-b-2 px-3 py-1.5 text-sm transition-colors ${tab === k ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
                    >
                        {label}
                    </button>
                ))}
            </div>

            {/* One DRY filter bar for ALL tabs. Counter → Cash Book only (locked to active shift); search →
                Sales/Orders/Estimates; pending → Orders/Estimates; date range → all. */}
            <div className="flex flex-wrap items-center gap-2">
                {tab === "ledger" && activeShift && (
                    <div className="h-9 rounded-md border border-input bg-muted/50 px-3 py-2 text-sm flex items-center">
                        <span className="text-muted-foreground text-xs">Counter:</span>
                        <span className="ml-2 font-medium">{activeShift.counter.name}</span>
                    </div>
                )}
                <TallyDateInput value={rangeFrom} onValueChange={setRangeFrom} className="h-9 w-32" placeholder="From" />
                <span className="text-sm text-muted-foreground">–</span>
                <TallyDateInput value={rangeTo} onValueChange={setRangeTo} monthMode="end" className="h-9 w-32" placeholder="To" />
                <Button variant="outline" size="sm" className="h-9" onClick={() => { setRangeFrom(todayISO); setRangeTo(todayISO); }}>Today</Button>
                {(rangeFrom || rangeTo) && (
                    <Button variant="ghost" size="sm" className="h-9 text-muted-foreground" onClick={() => { setRangeFrom(""); setRangeTo(""); }}>Clear</Button>
                )}
                <div className="relative w-64">
                    <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        className="h-9 pl-8 text-sm"
                        placeholder="Search…"
                        value={tab === "sales" || tab === "returns" ? q : docQuery}
                        onChange={(e) => { if (tab === "sales" || tab === "returns") { setQ(e.target.value); setPage(1); } else { setDocQuery(e.target.value); } }}
                    />
                </div>
                {(tab === "orders" || tab === "estimates") && (
                    <label className="flex h-9 shrink-0 cursor-pointer items-center gap-1.5 text-sm text-muted-foreground">
                        <Checkbox checked={pendingOnly} onCheckedChange={(v) => setPendingOnly(!!v)} />
                        Pending only <span className="text-xs">(no sale)</span>
                    </label>
                )}
            </div>

            {(tab === "sales" || tab === "returns") && (
                <>
                    {/* ── Table ── (search + date filter live in the shared bar above) */}
                    {loading ? (
                        <div className="flex justify-center py-12">
                            <Loader2 size={24} className="animate-spin text-muted-foreground" />
                        </div>
                    ) : items.length === 0 ? (
                        <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground text-sm">
                            <Monitor size={32} className="opacity-30" />
                            <p>{tab === "returns" ? "No POS returns found" : "No POS sales found"}{q ? " matching that search" : ""}.</p>
                            <Button variant="outline" size="sm" asChild>
                                <a href="/vouchers/pos/new" target="_blank" rel="noopener noreferrer">
                                    <ExternalLink size={13} /> Open POS Register
                                </a>
                            </Button>
                        </div>
                    ) : (
                        <>
                            <div className="max-h-[65vh] overflow-y-auto rounded-lg border border-border">
                                <table className="w-full text-sm">
                                    <thead className="sticky top-0 z-10 bg-muted text-xs text-muted-foreground">
                                        <tr>
                                            <th className="px-4 py-2.5 text-left font-medium">Reference</th>
                                            <th className="px-4 py-2.5 text-left font-medium">Date</th>
                                            {tab === "returns" && <th className="px-4 py-2.5 text-left font-medium">Original</th>}
                                            <th className="px-4 py-2.5 text-left font-medium">Branch</th>
                                            <th className="px-4 py-2.5 text-left font-medium">Cashier</th>
                                            <th className="px-4 py-2.5 text-left font-medium">{tab === "returns" ? "Refund" : "Payment"}</th>
                                            <th className="px-4 py-2.5 text-right font-medium">Items</th>
                                            <th className="px-4 py-2.5 text-right font-medium">Total</th>
                                            <th className="px-4 py-2.5 text-right font-medium">Print</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border">
                                        {items.map((s) => (
                                            <tr key={s.id} className="hover:bg-muted/30 transition-colors">
                                                <td className="px-4 py-2.5">
                                                    <span className="font-mono text-xs font-medium">{s.reference}</span>
                                                    {s.description && (
                                                        <p className="text-[11px] text-muted-foreground truncate max-w-45">
                                                            {s.description}
                                                        </p>
                                                    )}
                                                </td>
                                                <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">
                                                    {new Date(s.date).toLocaleDateString("en-IN", {
                                                        day: "2-digit", month: "short", year: "numeric",
                                                    })}
                                                </td>
                                                {tab === "returns" && (
                                                    <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                                                        {s.originalRef ?? <span className="text-[11px] not-italic text-muted-foreground">Lost invoice</span>}
                                                    </td>
                                                )}
                                                <td className="px-4 py-2.5 text-muted-foreground">{s.branch}</td>
                                                <td className="px-4 py-2.5 text-muted-foreground">{s.cashier}</td>
                                                <td className="px-4 py-2.5">
                                                    {tab === "returns" ? (
                                                        s.refundMode && (
                                                            <Badge
                                                                variant="secondary"
                                                                className={`text-[10px] font-medium ${REFUND_COLORS[s.refundMode] ?? "bg-muted text-muted-foreground"}`}
                                                            >
                                                                {s.refundMode}
                                                            </Badge>
                                                        )
                                                    ) : s.paymentMode && (
                                                        <Badge
                                                            variant="secondary"
                                                            className={`text-[10px] font-medium ${PAY_COLORS[s.paymentMode] ?? "bg-muted text-muted-foreground"}`}
                                                        >
                                                            {s.paymentMode.replace("_", " ")}
                                                        </Badge>
                                                    )}
                                                </td>
                                                <td className="px-4 py-2.5 text-right text-muted-foreground">
                                                    {s.lineCount}
                                                </td>
                                                <td className="px-4 py-2.5 text-right font-semibold font-mono">
                                                    ₹{fmt(Number(s.totalAmount))}
                                                </td>
                                                <td className="px-4 py-2.5 text-right">
                                                    <button
                                                        type="button"
                                                        title={tab === "returns" ? "Print return voucher" : "Print receipt (thermal → browser fallback)"}
                                                        onClick={() => window.open(tab === "returns" ? `/receipt/voucher/inv/${s.id}` : `/receipt/invoice/${s.id}?kind=POS`, "_blank", "noopener")}
                                                        className="inline-flex text-muted-foreground hover:text-foreground"
                                                    >
                                                        <Printer size={14} />
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            {/* ── Pagination ── */}
                            {totalPages > 1 && (
                                <div className="flex items-center justify-between text-sm text-muted-foreground">
                                    <span>Page {page} of {totalPages} · {total} total</span>
                                    <div className="flex gap-2">
                                        <Button
                                            variant="outline" size="sm"
                                            disabled={page <= 1}
                                            onClick={() => setPage((p) => p - 1)}
                                        >
                                            Previous
                                        </Button>
                                        <Button
                                            variant="outline" size="sm"
                                            disabled={page >= totalPages}
                                            onClick={() => setPage((p) => p + 1)}
                                        >
                                            Next
                                        </Button>
                                    </div>
                                </div>
                            )}
                        </>
                    )}

                    {/* ── Quick-access return link ── */}
                    {/* <p className="text-xs text-muted-foreground">
                        <RotateCcw size={11} className="inline mr-1" />
                        To process a return, open the POS Register and click the <strong>Return</strong> button in the top bar.
                    </p> */}
                </>
            )}

            {(tab === "orders" || tab === "estimates") && (() => {
                const t = docQuery.trim().toLowerCase();
                const filtered = posDocs.filter((d) => {
                    if (!inDateRange(d.date)) return false;
                    if (pendingOnly && d.status !== "POSTED") return false;             // draft = not finalised → not a pending order
                    if (pendingOnly && (d._count?.refReturns ?? 0) > 0) return false;   // converted (a sale references it) → not pending
                    return !t || d.reference.toLowerCase().includes(t) || (d.partyName ?? "").toLowerCase().includes(t);
                });
                if (posDocsLoading) {
                    return <div className="flex justify-center py-12"><Loader2 size={24} className="animate-spin text-muted-foreground" /></div>;
                }
                return (
                    <div className="space-y-3">
                        {posDocs.length === 0 ? (
                            <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground text-sm">
                                <Monitor size={32} className="opacity-30" />
                                <p>No POS {tab === "orders" ? "orders" : "estimates"} yet.</p>
                                <Button variant="outline" size="sm" asChild>
                                    <a href={tab === "orders" ? "/vouchers/pos/order" : "/vouchers/pos/estimate"} target="_blank" rel="noopener noreferrer">
                                        <ExternalLink size={13} /> Open {tab === "orders" ? "Order" : "Estimate"} screen
                                    </a>
                                </Button>
                            </div>
                        ) : filtered.length === 0 ? (
                            <p className="py-12 text-center text-sm text-muted-foreground">No {tab === "orders" ? "orders" : "estimates"} match “{docQuery}”.</p>
                        ) : (
                            <div className="max-h-[65vh] overflow-y-auto rounded-lg border border-border">
                                <table className="w-full text-sm">
                                    <thead className="sticky top-0 z-10 bg-muted text-xs text-muted-foreground">
                                        <tr className="border-b border-border">
                                            <th className="px-3 py-2 text-left font-medium">Reference</th>
                                            <th className="px-3 py-2 text-left font-medium">Date</th>
                                            <th className="px-3 py-2 text-left font-medium">Customer</th>
                                            <th className="px-3 py-2 text-right font-medium">Total</th>
                                            <th className="px-3 py-2 text-center font-medium">Status</th>
                                            <th className="px-3 py-2 text-center font-medium">Lead</th>
                                            <th className="w-10" />
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filtered.map((d) => (
                                            <tr key={d.id} className="border-b border-border/60 hover:bg-muted/30">
                                                <td className="px-3 py-2 font-mono text-xs">{d.reference}</td>
                                                <td className="px-3 py-2 text-muted-foreground">{d.date.slice(0, 10)}</td>
                                                <td className="px-3 py-2">{d.partyName ?? "Walk-in"}</td>
                                                <td className="px-3 py-2 text-right tabular-nums">₹{fmt(Number(d.totalAmount))}</td>
                                                <td className="px-3 py-2 text-center">
                                                    <button
                                                        type="button"
                                                        onClick={() => toggleDocStatus(d)}
                                                        title="Click to toggle Draft / Issued"
                                                        className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors ${d.status === "POSTED" ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300" : "bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-500/15 dark:text-amber-300"}`}
                                                    >
                                                        {d.status === "POSTED" ? "Issued" : "Draft"}
                                                    </button>
                                                </td>
                                                <td className="px-3 py-2 text-center">
                                                    {d.dealId ? <Badge variant="outline" className="text-[10px]">Deal #{d.dealId}</Badge> : <span className="text-muted-foreground">—</span>}
                                                </td>
                                                <td className="px-2 py-2 text-right">
                                                    <a href={`/receipt/voucher/inv/${d.id}`} target="_blank" rel="noopener noreferrer" className="inline-flex text-muted-foreground hover:text-foreground" title="Print">
                                                        <Printer size={14} />
                                                    </a>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                );
            })()}

            {tab === "cash" && (
                movesLoading ? (
                    <div className="flex justify-center py-12"><Loader2 size={24} className="animate-spin text-muted-foreground" /></div>
                ) : moves.length === 0 ? (
                    <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground text-sm">
                        <Monitor size={32} className="opacity-30" />
                        <p>No counter receipts or expenditures yet.</p>
                    </div>
                ) : (
                    <div className="max-h-[65vh] overflow-y-auto rounded-lg border border-border">
                        <table className="w-full text-sm">
                            <thead className="sticky top-0 z-10 bg-muted text-xs text-muted-foreground">
                                <tr>
                                    <th className="px-4 py-2.5 text-left font-medium">Type</th>
                                    <th className="px-4 py-2.5 text-left font-medium">Reference</th>
                                    <th className="px-4 py-2.5 text-left font-medium">Date</th>
                                    <th className="px-4 py-2.5 text-left font-medium">Party / Ledger</th>
                                    <th className="px-4 py-2.5 text-left font-medium">Counter</th>
                                    <th className="px-4 py-2.5 text-left font-medium">Cashier</th>
                                    <th className="px-4 py-2.5 text-right font-medium">Amount</th>
                                    <th className="px-4 py-2.5 text-right font-medium">Print</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {moves.filter((m) => inDateRange(m.date) && matchesQuery(m.reference, m.party, m.note)).map((m) => (
                                    <tr key={m.id} className="transition-colors hover:bg-muted/30">
                                        <td className="px-4 py-2.5">
                                            <Badge variant="secondary" className={`text-[10px] font-medium ${m.kind === "IN" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
                                                {m.kind === "IN" ? "Receipt" : "Expense"}
                                            </Badge>
                                        </td>
                                        <td className="px-4 py-2.5"><span className="font-mono text-xs font-medium">{m.reference}</span></td>
                                        <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">
                                            {new Date(m.date).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                                        </td>
                                        <td className="px-4 py-2.5">
                                            {m.party}
                                            {m.note && <p className="max-w-45 truncate text-[11px] text-muted-foreground">{m.note}</p>}
                                        </td>
                                        <td className="px-4 py-2.5 text-muted-foreground">{m.counter}</td>
                                        <td className="px-4 py-2.5 text-muted-foreground">{m.cashier}</td>
                                        <td className={`px-4 py-2.5 text-right font-mono font-semibold ${m.kind === "IN" ? "text-green-700" : "text-red-700"}`}>
                                            {m.kind === "IN" ? "+" : "−"}₹{fmt(Number(m.amount))}
                                        </td>
                                        <td className="px-4 py-2.5 text-right">
                                            {m.voucherId != null && (
                                                <button
                                                    type="button"
                                                    title="Print voucher (thermal → browser fallback)"
                                                    onClick={() => window.open(`/receipt/payment/${m.voucherId}`, "_blank", "noopener")}
                                                    className="inline-flex text-muted-foreground hover:text-foreground"
                                                >
                                                    <Printer size={14} />
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )
            )}

            {tab === "ledger" && (
                <div className="space-y-3">
                    {/* Counter locked to active shift; date range lives in the shared filter bar above. */}

                    {!activeShift ? (
                        <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground text-sm">
                            <Monitor size={32} className="opacity-30" />
                            <p>Open a shift to view the cash book.</p>
                        </div>
                    ) : ledgerLoading ? (
                        <div className="flex justify-center py-12"><Loader2 size={24} className="animate-spin text-muted-foreground" /></div>
                    ) : !ledger ? (
                        <p className="py-8 text-center text-sm text-muted-foreground">Unable to load cash book.</p>
                    ) : (
                        <div className="max-h-[65vh] overflow-y-auto rounded-lg border border-border">
                            <table className="w-full text-sm">
                                <thead className="sticky top-0 z-10 bg-muted text-xs text-muted-foreground">
                                    <tr>
                                        <th className="px-4 py-2.5 text-left font-medium">Date</th>
                                        <th className="px-4 py-2.5 text-left font-medium">Particulars</th>
                                        <th className="px-4 py-2.5 text-left font-medium">Voucher</th>
                                        <th className="px-4 py-2.5 text-right font-medium">In</th>
                                        <th className="px-4 py-2.5 text-right font-medium">Out</th>
                                        <th className="px-4 py-2.5 text-right font-medium">Balance</th>
                                        <th className="px-4 py-2.5" />
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border">
                                    <tr className="bg-muted/30 font-medium">
                                        <td className="px-4 py-2" colSpan={5}>Opening balance</td>
                                        <td className="px-4 py-2 text-right font-mono">₹{fmt(ledger.openingBalance)}</td>
                                        <td />
                                    </tr>
                                    {ledger.rows.length === 0 ? (
                                        <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">No cash movements in this period.</td></tr>
                                    ) : ledger.rows.filter((r) => matchesQuery(r.particulars, r.reference)).map((r) => (
                                        <tr key={r.id} className="transition-colors hover:bg-muted/30">
                                            <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">
                                                {new Date(r.date).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                                            </td>
                                            <td className="px-4 py-2.5">{r.particulars}</td>
                                            <td className="px-4 py-2.5"><span className="font-mono text-xs">{r.reference}</span></td>
                                            <td className="px-4 py-2.5 text-right font-mono text-green-700">{r.debit != null ? fmt(r.debit) : ""}</td>
                                            <td className="px-4 py-2.5 text-right font-mono text-red-700">{r.credit != null ? fmt(r.credit) : ""}</td>
                                            <td className="px-4 py-2.5 text-right font-mono">{fmt(r.balance)}</td>
                                            <td className="px-4 py-2.5 text-right">
                                                {r.printUrl && (
                                                    <a href={r.printUrl} target="_blank" rel="noopener noreferrer" title="Print (thermal → browser fallback)" className="inline-flex text-muted-foreground hover:text-foreground">
                                                        <Printer size={14} />
                                                    </a>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                    <tr className="border-t-2 border-border bg-muted/30 font-semibold">
                                        <td className="px-4 py-2" colSpan={5}>Closing balance</td>
                                        <td className="px-4 py-2 text-right font-mono">₹{fmt(ledger.closingBalance)}</td>
                                        <td />
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
