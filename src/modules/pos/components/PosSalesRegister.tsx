"use client";

// ── PosSalesRegister ──────────────────────────────────────────────────────────
// List of all POS sales (InvVoucher type=SALE, status=POSTED).
// Lives at /vouchers/pos — mirrors SalesRegister at /vouchers/sales.

import { useEffect, useState, useCallback } from "react";
import axios from "axios";
import { toast } from "sonner";
import {
    Search, Loader2, Monitor, RotateCcw, ExternalLink, Printer, Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { TallyDateInput } from "@/shared/components/TallyDateInput";
import { fmt } from "@/utils/constants";
import { ActiveShiftBar, type ActiveShift } from "@/modules/pos/components/ActiveShiftBar";
import { ShiftOpenDialog, type OpenedShift } from "@/modules/pos/components/ShiftOpenDialog";

// ── Types ─────────────────────────────────────────────────────────────────────

type PosSale = {
    id:             number;
    reference:      string;
    date:           string;
    description:    string;
    paymentMode:    string | null;
    totalAmount:    string;
    amountReceived: string;
    branch:         string;
    cashier:        string;
    lineCount:      number;
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
type LedgerRow  = {
    id: number; date: string; reference: string; particulars: string;
    debit: number | null; credit: number | null; balance: number; printUrl: string | null;
};
type LedgerData = {
    counter: { id: number; name: string; tillAccountName: string };
    openingBalance: number; closingBalance: number; rows: LedgerRow[];
};

const PAY_COLORS: Record<string, string> = {
    CASH:           "bg-green-50 text-green-700",
    BANK_TRANSFER:  "bg-blue-50 text-blue-700",
    CARD:           "bg-purple-50 text-purple-700",
    MOBILE_PAYMENT: "bg-orange-50 text-orange-700",
};

// ── Component ─────────────────────────────────────────────────────────────────

export function PosSalesRegister() {
    const [items, setItems]       = useState<PosSale[]>([]);
    const [total, setTotal]       = useState(0);
    const [loading, setLoading]   = useState(true);
    const [q, setQ]               = useState("");
    const [page, setPage]         = useState(1);
    const limit                   = 50;

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

    const [tab, setTab]                 = useState<"sales" | "cash" | "ledger">("sales");
    const [moves, setMoves]             = useState<CashMove[]>([]);
    const [movesLoading, setMovesLoading] = useState(false);

    useEffect(() => {
        if (tab !== "cash") return;
        setMovesLoading(true);
        axios.get<{ items: CashMove[] }>("/api/pos/cash-movements?limit=100")
            .then((r) => setMoves(r.data.items))
            .catch(() => toast.error("Failed to load cash movements"))
            .finally(() => setMovesLoading(false));
    }, [tab]);

    // ── Till cash book (ledger) ──────────────────────────────────────────────
    const todayISO = new Date().toISOString().slice(0, 10);
    const [counters, setCounters]   = useState<CounterOpt[]>([]);
    const [counterId, setCounterId] = useState<number | null>(null);
    const [from, setFrom]           = useState(todayISO);
    const [to, setTo]               = useState(todayISO);
    const [ledger, setLedger]       = useState<LedgerData | null>(null);
    const [ledgerLoading, setLedgerLoading] = useState(false);

    useEffect(() => {
        if (tab !== "ledger" || counters.length) return;
        axios.get<CounterOpt[]>("/api/pos/counters?scope=all")
            .then((r) => { setCounters(r.data); if (r.data[0]) setCounterId(r.data[0].id); })
            .catch(() => toast.error("Failed to load counters"));
    }, [tab, counters.length]);

    useEffect(() => {
        if (tab !== "ledger" || counterId == null) return;
        setLedgerLoading(true);
        axios.get<LedgerData>(`/api/pos/till-ledger?counterId=${counterId}&from=${from}&to=${to}`)
            .then((r) => setLedger(r.data))
            .catch(() => toast.error("Failed to load till ledger"))
            .finally(() => setLedgerLoading(false));
    }, [tab, counterId, from, to]);

    const load = useCallback(async (search: string, pg: number) => {
        setLoading(true);
        try {
            const params = new URLSearchParams({
                limit: String(limit),
                page:  String(pg),
                ...(search ? { q: search } : {}),
            });
            const { data } = await axios.get<ApiResponse>(`/api/pos/sales?${params}`);
            setItems(data.items);
            setTotal(data.total);
        } catch {
            toast.error("Failed to load POS sales");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { void load(q, page); }, [load, q, page]);

    const totalPages = Math.max(1, Math.ceil(total / limit));

    return (
        <div className="space-y-4">
            {/* ── Live shift bar ── the full status/money strip belongs here on
                the overview page; the billing screen (/vouchers/pos/new) keeps it
                folded into a ⋮ menu to save space. */}
            {activeShift ? (
                <div className="overflow-hidden rounded-lg border border-border">
                    <ActiveShiftBar
                        shift={activeShift}
                        onClosed={() => { setActiveShift(null); refreshShift(); }}
                        onHandoverCancelled={refreshShift}
                        rightSlot={
                            <Button asChild size="sm" className="h-7 text-xs">
                                <a href="/vouchers/pos/new"><Plus size={14} /> New Sale</a>
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
                            <a href="/vouchers/pos/new"><Plus size={14} /> New Sale</a>
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
                onOpened={(_s: OpenedShift) => { setShiftOpenOpen(false); refreshShift(); }}
            />

            {/* ── Header ── */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-xl font-semibold flex items-center gap-2">
                        <Monitor size={18} className="text-primary" />
                        POS Sales
                    </h1>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        {total} sale{total !== 1 ? "s" : ""} recorded
                    </p>
                </div>
            </div>

            {/* ── Tabs ── */}
            <div className="flex gap-1 border-b border-border">
                {([["sales", "Sales"], ["cash", "Cash In / Out"], ["ledger", "Cash Book"]] as const).map(([k, label]) => (
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

            {tab === "sales" && (
            <>
            {/* ── Search ── */}
            <div className="relative max-w-sm">
                <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                    className="pl-8 text-sm"
                    placeholder="Search by reference or description…"
                    value={q}
                    onChange={(e) => { setQ(e.target.value); setPage(1); }}
                />
            </div>

            {/* ── Table ── */}
            {loading ? (
                <div className="flex justify-center py-12">
                    <Loader2 size={24} className="animate-spin text-muted-foreground" />
                </div>
            ) : items.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground text-sm">
                    <Monitor size={32} className="opacity-30" />
                    <p>No POS sales found{q ? " matching that search" : ""}.</p>
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
                                    <th className="px-4 py-2.5 text-left font-medium">Branch</th>
                                    <th className="px-4 py-2.5 text-left font-medium">Cashier</th>
                                    <th className="px-4 py-2.5 text-left font-medium">Payment</th>
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
                                                <p className="text-[11px] text-muted-foreground truncate max-w-[180px]">
                                                    {s.description}
                                                </p>
                                            )}
                                        </td>
                                        <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">
                                            {new Date(s.date).toLocaleDateString("en-IN", {
                                                day: "2-digit", month: "short", year: "numeric",
                                            })}
                                        </td>
                                        <td className="px-4 py-2.5 text-muted-foreground">{s.branch}</td>
                                        <td className="px-4 py-2.5 text-muted-foreground">{s.cashier}</td>
                                        <td className="px-4 py-2.5">
                                            {s.paymentMode && (
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
                                                title="Print receipt (thermal → browser fallback)"
                                                onClick={() => window.open(`/receipt/invoice/${s.id}?kind=POS`, "_blank", "noopener")}
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
            <p className="text-xs text-muted-foreground">
                <RotateCcw size={11} className="inline mr-1" />
                To process a return, open the POS Register and click the <strong>Return</strong> button in the top bar.
            </p>
            </>
            )}

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
                                {moves.map((m) => (
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
                                            {m.note && <p className="max-w-[180px] truncate text-[11px] text-muted-foreground">{m.note}</p>}
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
                    {/* Controls: counter + date range (defaults to today) */}
                    <div className="flex flex-wrap items-end gap-3">
                        <div>
                            <label className="mb-1 block text-xs text-muted-foreground">Counter</label>
                            <select
                                value={counterId ?? ""}
                                onChange={(e) => setCounterId(Number(e.target.value))}
                                className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
                            >
                                {counters.map((c) => (
                                    <option key={c.id} value={c.id}>{c.name} — {c.tillAccount.name}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="mb-1 block text-xs text-muted-foreground">From</label>
                            <TallyDateInput value={from} onValueChange={setFrom} className="h-9 w-36" />
                        </div>
                        <div>
                            <label className="mb-1 block text-xs text-muted-foreground">To</label>
                            <TallyDateInput value={to} onValueChange={setTo} className="h-9 w-36" />
                        </div>
                        <Button variant="outline" size="sm" className="h-9" onClick={() => { setFrom(todayISO); setTo(todayISO); }}>
                            Today
                        </Button>
                    </div>

                    {ledgerLoading ? (
                        <div className="flex justify-center py-12"><Loader2 size={24} className="animate-spin text-muted-foreground" /></div>
                    ) : !ledger ? (
                        <p className="py-8 text-center text-sm text-muted-foreground">Pick a counter to view its cash book.</p>
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
                                    ) : ledger.rows.map((r) => (
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
