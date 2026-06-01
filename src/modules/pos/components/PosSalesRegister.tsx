"use client";

// ── PosSalesRegister ──────────────────────────────────────────────────────────
// List of all POS sales (InvVoucher type=SALE, status=POSTED).
// Lives at /vouchers/pos — mirrors SalesRegister at /vouchers/sales.

import { useEffect, useState, useCallback } from "react";
import axios from "axios";
import { toast } from "sonner";
import {
    Search, Loader2, Monitor, RotateCcw, ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { fmt } from "@/utils/constants";

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
    id: string; kind: "IN" | "OUT"; reference: string; date: string;
    amount: string; party: string; note: string | null; counter: string; cashier: string;
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

    const [tab, setTab]                 = useState<"sales" | "cash">("sales");
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
                <Button asChild size="sm">
                    <a href="/vouchers/pos/new" target="_blank" rel="noopener noreferrer">
                        <ExternalLink size={14} /> Open Register
                    </a>
                </Button>
            </div>

            {/* ── Tabs ── */}
            <div className="flex gap-1 border-b border-border">
                {([["sales", "Sales"], ["cash", "Cash In / Out"]] as const).map(([k, label]) => (
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

            {tab === "sales" ? (
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
                    <div className="rounded-lg border border-border overflow-hidden">
                        <table className="w-full text-sm">
                            <thead className="bg-muted/50 text-xs text-muted-foreground">
                                <tr>
                                    <th className="px-4 py-2.5 text-left font-medium">Reference</th>
                                    <th className="px-4 py-2.5 text-left font-medium">Date</th>
                                    <th className="px-4 py-2.5 text-left font-medium">Branch</th>
                                    <th className="px-4 py-2.5 text-left font-medium">Cashier</th>
                                    <th className="px-4 py-2.5 text-left font-medium">Payment</th>
                                    <th className="px-4 py-2.5 text-right font-medium">Items</th>
                                    <th className="px-4 py-2.5 text-right font-medium">Total</th>
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
            ) : (
                movesLoading ? (
                    <div className="flex justify-center py-12"><Loader2 size={24} className="animate-spin text-muted-foreground" /></div>
                ) : moves.length === 0 ? (
                    <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground text-sm">
                        <Monitor size={32} className="opacity-30" />
                        <p>No counter receipts or expenditures yet.</p>
                    </div>
                ) : (
                    <div className="overflow-hidden rounded-lg border border-border">
                        <table className="w-full text-sm">
                            <thead className="bg-muted/50 text-xs text-muted-foreground">
                                <tr>
                                    <th className="px-4 py-2.5 text-left font-medium">Type</th>
                                    <th className="px-4 py-2.5 text-left font-medium">Reference</th>
                                    <th className="px-4 py-2.5 text-left font-medium">Date</th>
                                    <th className="px-4 py-2.5 text-left font-medium">Party / Ledger</th>
                                    <th className="px-4 py-2.5 text-left font-medium">Counter</th>
                                    <th className="px-4 py-2.5 text-left font-medium">Cashier</th>
                                    <th className="px-4 py-2.5 text-right font-medium">Amount</th>
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
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )
            )}
        </div>
    );
}
