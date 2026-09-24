"use client";

// ── ShiftSummaryCards ────────────────────────────────────────────────────────
// The drawer of one shift, in four cards: cash drawer position, counter cash
// flow, payments collected by method, and collections by type. The close-shift
// dialog and the takeover modal show the same cards off the same server figures
// (modules/pos/lib/shiftSummary.ts), so the cashier handing over and the one
// taking over read one drawer.

import { Calculator, TrendingUp, CreditCard, Receipt } from "lucide-react";
import { fmt } from "@/utils/constants";

type TenderRow = { method: string; label: string; amountPaise: string };

export type ShiftSummary = {
    openingFloatPaise:    string;
    // Net movement on the till ledger since open (sales + receipts − refunds −
    // expenditures − anything else posted there). Signed.
    tillMovementPaise:    string;
    dropsPaise:           string;
    runningExpectedPaise: string;
    tenderBreakdown?:     TenderRow[];
    movementBreakdown?: {
        cashSalesPaise:    string;
        receiptsPaise:     string;
        expendituresPaise: string;
        refundsPaise:      string;
        otherPaise:        string;
        netMovementPaise:  string;
    };
    collectionsBreakdown?: {
        salesPaise:        string;
        salesCount:        number;
        receiptsPaise:     string;
        receiptsCount:     number;
        refundsPaise:      string;
        refundsCount:      number;
        netCollectedPaise: string;
    };
};

const rupees = (paise: string | number | undefined) => Number(paise || 0) / 100;

// "+ ₹1,234.00" / "− ₹1,234.00" — the till movement carries a sign of its own.
export function signed(n: number): string {
    return `${n < 0 ? "−" : "+"} ₹${fmt(Math.abs(n))}`;
}

export function Row({ label, value, sub, className }: { label: string; value: string; sub?: string; className?: string }) {
    const displayValue = value.includes("₹") ? value : `₹${value}`;
    return (
        <div className={`flex justify-between text-muted-foreground ${className ?? ""}`}>
            <span>
                {label}
                {sub && <span className="block text-[10px] leading-tight opacity-60">{sub}</span>}
            </span>
            <span className="font-mono text-foreground">{displayValue}</span>
        </div>
    );
}

export function CashDrawerPositionCard({ s }: { s: ShiftSummary }) {
    return (
        <div className="rounded-md border border-sky-300/60 bg-sky-50/30 dark:border-sky-500/30 dark:bg-sky-950/20 p-2.5 text-xs sm:text-sm space-y-1 shadow-sm">
            <div className="flex items-center justify-between mb-0.5">
                <p className="text-[11px] font-semibold text-sky-800 dark:text-sky-300 uppercase tracking-wide flex items-center gap-1.5">
                    <Calculator size={13} className="text-sky-600 dark:text-sky-400" /> Cash Drawer Position
                </p>
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-sky-100 dark:bg-sky-900/50 text-sky-700 dark:text-sky-300">
                    System Ledger
                </span>
            </div>
            <Row label="Counter opening cash" value={fmt(rupees(s.openingFloatPaise))} />
            <Row label="Counter cash flow" value={signed(rupees(s.tillMovementPaise))} />
            <Row label="Dropped to safe" value={`− ₹${fmt(rupees(s.dropsPaise))}`} />
            <div className="border-t border-sky-200/70 dark:border-sky-800/50 pt-1 mt-0.5 flex justify-between items-center bg-sky-100/50 dark:bg-sky-950/50 -mx-1 px-2 py-0.5 rounded font-semibold">
                <span className="text-sky-950 dark:text-sky-200">Expected in drawer</span>
                <span className="font-mono text-sm text-sky-900 dark:text-sky-100 font-bold">₹{fmt(rupees(s.runningExpectedPaise))}</span>
            </div>
        </div>
    );
}

export function CashFlowCard({ s }: { s: ShiftSummary }) {
    const m = s.movementBreakdown;
    const inflow  = (paise?: string) => rupees(paise) > 0 ? `+ ₹${fmt(rupees(paise))}` : "₹0.00";
    const outflow = (paise?: string) => rupees(paise) > 0 ? `− ₹${fmt(rupees(paise))}` : "₹0.00";
    const outTone = (paise?: string) => rupees(paise) > 0 ? "text-rose-700 dark:text-rose-400 font-medium" : "text-foreground";
    return (
        <div className="rounded-md border border-violet-300/60 bg-violet-50/30 dark:border-violet-500/30 dark:bg-violet-950/20 p-2.5 text-xs sm:text-sm space-y-1 shadow-sm">
            <div className="flex items-center justify-between mb-0.5">
                <p className="text-[11px] font-semibold text-violet-800 dark:text-violet-300 uppercase tracking-wide flex items-center gap-1.5">
                    <TrendingUp size={13} className="text-violet-600 dark:text-violet-400" /> Counter Cash Flow Breakdown
                </p>
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-violet-100 dark:bg-violet-900/50 text-violet-700 dark:text-violet-300">
                    Cash Flows
                </span>
            </div>
            <div className="space-y-0.5">
                <div className="flex justify-between text-muted-foreground text-xs">
                    <span>Cash sales</span>
                    <span className="font-mono text-emerald-600 dark:text-emerald-400 font-medium">{inflow(m?.cashSalesPaise)}</span>
                </div>
                <div className="flex justify-between text-muted-foreground text-xs">
                    <span>Customer receipts (Rcv)</span>
                    <span className="font-mono text-emerald-600 dark:text-emerald-400 font-medium">{inflow(m?.receiptsPaise)}</span>
                </div>
                <div className="flex justify-between text-muted-foreground text-xs">
                    <span>Counter expenses (Exp)</span>
                    <span className={`font-mono ${outTone(m?.expendituresPaise)}`}>{outflow(m?.expendituresPaise)}</span>
                </div>
                <div className="flex justify-between text-muted-foreground text-xs">
                    <span>Cash refunds / returns</span>
                    <span className={`font-mono ${outTone(m?.refundsPaise)}`}>{outflow(m?.refundsPaise)}</span>
                </div>
                {m?.otherPaise !== undefined && Number(m.otherPaise) !== 0 && (
                    <div className="flex justify-between text-muted-foreground text-xs">
                        <span>Other adjustments</span>
                        <span className="font-mono text-foreground font-medium">{signed(rupees(m.otherPaise))}</span>
                    </div>
                )}
            </div>
            <div className="border-t border-violet-200/70 dark:border-violet-800/50 pt-1 mt-0.5 flex justify-between items-center bg-violet-100/50 dark:bg-violet-950/50 -mx-1 px-2 py-0.5 rounded font-semibold">
                <span className="text-violet-950 dark:text-violet-200">Net counter cash flow</span>
                <span className="font-mono text-sm text-violet-900 dark:text-violet-100 font-bold">{signed(rupees(s.tillMovementPaise))}</span>
            </div>
        </div>
    );
}

/** Every payment method collected this shift (cash + digital). Informational —
 *  only cash is physically reconciled. Renders nothing when nothing came in. */
export function PaymentsCollectedCard({ s }: { s: ShiftSummary }) {
    const rows = s.tenderBreakdown ?? [];
    if (rows.length === 0) return null;
    const total = rows.reduce((sum, t) => sum + rupees(t.amountPaise), 0);
    return (
        <div className="rounded-md border border-indigo-300/60 bg-indigo-50/30 dark:border-indigo-500/30 dark:bg-indigo-950/20 p-2.5 text-xs sm:text-sm space-y-1 shadow-sm">
            <div className="flex items-center justify-between mb-0.5">
                <p className="text-[11px] font-semibold text-indigo-800 dark:text-indigo-300 uppercase tracking-wide flex items-center gap-1.5">
                    <CreditCard size={13} className="text-indigo-600 dark:text-indigo-400" /> Payments collected this shift
                </p>
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300">
                    All Modes
                </span>
            </div>
            <div className="space-y-0.5">
                {rows.map((t) => <Row key={t.method} label={t.label} value={fmt(rupees(t.amountPaise))} />)}
            </div>
            <div className="border-t border-indigo-200/70 dark:border-indigo-800/50 pt-1 mt-0.5 flex justify-between items-center bg-indigo-100/50 dark:bg-indigo-950/50 -mx-1 px-2 py-0.5 rounded font-semibold">
                <span className="text-indigo-950 dark:text-indigo-200">Total collected</span>
                <span className="font-mono text-sm text-indigo-900 dark:text-indigo-100 font-bold">₹{fmt(total)}</span>
            </div>
        </div>
    );
}

/** Collections by business type (sales, receipts, returns) — justifies the total. */
export function CollectionsCard({ s }: { s: ShiftSummary }) {
    const c = s.collectionsBreakdown;
    if (!c) return null;
    const total = (s.tenderBreakdown ?? []).reduce((sum, t) => sum + rupees(t.amountPaise), 0);
    return (
        <div className="rounded-md border border-teal-300/60 bg-teal-50/30 dark:border-teal-500/30 dark:bg-teal-950/20 p-2.5 text-xs sm:text-sm space-y-1 shadow-sm">
            <div className="flex items-center justify-between mb-0.5">
                <p className="text-[11px] font-semibold text-teal-800 dark:text-teal-300 uppercase tracking-wide flex items-center gap-1.5">
                    <Receipt size={13} className="text-teal-600 dark:text-teal-400" /> Total Collected Breakdown
                </p>
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-teal-100 dark:bg-teal-900/50 text-teal-700 dark:text-teal-300">
                    By Type
                </span>
            </div>
            <div className="space-y-0.5">
                <div className="flex justify-between text-muted-foreground text-xs">
                    <span>
                        POS Sales
                        {c.salesCount > 0 && (
                            <span className="text-[10px] font-medium ml-1.5 px-1.5 py-0.2 rounded-full bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300">
                                {c.salesCount} {c.salesCount === 1 ? "bill" : "bills"}
                            </span>
                        )}
                    </span>
                    <span className="font-mono text-teal-700 dark:text-teal-300 font-medium">+ ₹{fmt(rupees(c.salesPaise))}</span>
                </div>
                <div className="flex justify-between text-muted-foreground text-xs">
                    <span>
                        Customer receipts (Rcv)
                        {c.receiptsCount > 0 && (
                            <span className="text-[10px] font-medium ml-1.5 px-1.5 py-0.2 rounded-full bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300">
                                {c.receiptsCount} {c.receiptsCount === 1 ? "rcv" : "rcvs"}
                            </span>
                        )}
                    </span>
                    <span className="font-mono text-teal-700 dark:text-teal-300 font-medium">+ ₹{fmt(rupees(c.receiptsPaise))}</span>
                </div>
                {rupees(c.refundsPaise) > 0 && (
                    <div className="flex justify-between text-muted-foreground text-xs">
                        <span>
                            Sales returns / refunds
                            {c.refundsCount > 0 && (
                                <span className="text-[10px] font-medium ml-1.5 px-1.5 py-0.2 rounded-full bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300">
                                    {c.refundsCount}
                                </span>
                            )}
                        </span>
                        <span className="font-mono text-rose-700 dark:text-rose-400 font-medium">− ₹{fmt(rupees(c.refundsPaise))}</span>
                    </div>
                )}
            </div>
            <div className="border-t border-teal-200/70 dark:border-teal-800/50 pt-1 mt-0.5 flex justify-between items-center bg-teal-100/50 dark:bg-teal-950/50 -mx-1 px-2 py-0.5 rounded font-semibold">
                <span className="text-teal-950 dark:text-teal-200">Net total collected</span>
                <span className="font-mono text-sm text-teal-900 dark:text-teal-100 font-bold">₹{fmt(total)}</span>
            </div>
        </div>
    );
}
