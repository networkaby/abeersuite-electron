"use client";

import { useEffect, useState, useCallback, Fragment } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, Printer, ChevronRight, ChevronDown } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fmt } from "@/utils/constants";
import { indianFiscalYearStart, formatDateInput } from "@/modules/tally/lib/period";

interface LedgerNode {
    id: number; name: string; closing: number;
}
interface GroupNode {
    id: number; name: string; sortOrder: number;
    children: GroupNode[]; ledgers: LedgerNode[];
    rolledUpClosing: number;
}
interface PLData {
    from: string;
    to:   string;
    trees: {
        salesAccounts: GroupNode | undefined;
        purchaseAccounts: GroupNode | undefined;
        directIncomes: GroupNode | undefined;
        directExpenses: GroupNode | undefined;
        indirectIncomes: GroupNode | undefined;
        indirectExpenses: GroupNode | undefined;
    };
    trading: {
        debit:  { openingStock: number; purchaseAccounts: number; directExpenses: number };
        credit: { salesAccounts: number; directIncomes: number; closingStock: number };
    };
    pnl: {
        debit:  { indirectExpenses: number; grossLossBrought: number };
        credit: { indirectIncomes: number; grossProfitBrought: number };
    };
    grossProfit: number;
    netProfit: number;
}

function fmtIndianDate(iso: string): string {
    return new Date(iso).toLocaleDateString("en-GB", {
        day: "2-digit", month: "short", year: "numeric",
    });
}

function GroupBlock({ node, depth, expanded, toggle, onLedger, onGroup, abs = true }: {
    node: GroupNode; depth: number;
    expanded: Set<number>; toggle: (id: number) => void;
    onLedger: (id: number) => void; onGroup: (id: number) => void;
    abs?: boolean;
}) {
    const isOpen = expanded.has(node.id);
    const hasContent = node.children.length > 0 || node.ledgers.length > 0;
    const balance = abs ? Math.abs(node.rolledUpClosing) : node.rolledUpClosing;
    return (
        <Fragment>
            <tr className="hover:bg-muted/40">
                <td className="py-1" style={{ paddingLeft: 8 + depth * 16 }}>
                    <button
                        type="button"
                        className="flex items-center gap-1 font-medium hover:underline"
                        onClick={() => onGroup(node.id)}
                    >
                        {hasContent && (
                            <span
                                onClick={(e) => { e.stopPropagation(); toggle(node.id); }}
                                className="text-muted-foreground"
                            >
                                {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            </span>
                        )}
                        <span className={depth === 0 ? "font-semibold" : ""}>{node.name}</span>
                    </button>
                </td>
                <td className="py-1 pr-3 text-right font-mono text-sm">
                    {balance !== 0 ? fmt(balance) : <span className="text-muted-foreground/40">—</span>}
                </td>
            </tr>
            {isOpen && (
                <>
                    {node.children.map((c) => (
                        <GroupBlock key={`g-${c.id}`} node={c} depth={depth + 1}
                                    expanded={expanded} toggle={toggle}
                                    onLedger={onLedger} onGroup={onGroup} abs={abs} />
                    ))}
                    {node.ledgers.map((l) => (
                        <tr key={`l-${l.id}`} className="cursor-pointer hover:bg-primary/5"
                            onClick={() => onLedger(l.id)}>
                            <td className="py-1 text-muted-foreground" style={{ paddingLeft: 24 + depth * 16 }}>
                                <span className="hover:underline hover:text-primary">{l.name}</span>
                            </td>
                            <td className="py-1 pr-3 text-right font-mono text-sm text-muted-foreground">
                                {l.closing !== 0
                                    ? fmt(abs ? Math.abs(l.closing) : l.closing)
                                    : <span className="text-muted-foreground/30">—</span>}
                            </td>
                        </tr>
                    ))}
                </>
            )}
        </Fragment>
    );
}

function StaticRow({ label, amount, italic = false }: { label: string; amount: number; italic?: boolean }) {
    return (
        <tr>
            <td className={`py-1 px-3 ${italic ? "italic text-muted-foreground" : "font-medium"}`}>{label}</td>
            <td className="py-1 pr-3 text-right font-mono text-sm">
                {amount !== 0 ? fmt(amount) : <span className="text-muted-foreground/40">—</span>}
            </td>
        </tr>
    );
}

export default function ProfitLossPage() {
    const router = useRouter();
    const fyStart = indianFiscalYearStart();
    const [from, setFrom] = useState(formatDateInput(fyStart));
    const [to, setTo]     = useState(formatDateInput(new Date()));
    const [data, setData] = useState<PLData | null>(null);
    const [loading, setLoading] = useState(false);
    const [expanded, setExpanded] = useState<Set<number>>(new Set());

    const load = useCallback(() => {
        setLoading(true);
        axios.get<PLData>(`/api/finance/reports/profit-loss?from=${from}&to=${to}`)
            .then((r) => {
                setData(r.data);
                setExpanded((prev) => {
                    if (prev.size > 0) return prev;
                    const ids: number[] = [];
                    Object.values(r.data.trees).forEach((t) => { if (t) ids.push(t.id); });
                    return new Set(ids);
                });
            })
            .catch(() => toast.error("Failed to load P&L"))
            .finally(() => setLoading(false));
    }, [from, to]);

    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(load, [load]);

    const toggle = (id: number) => setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(id)) { next.delete(id); } else { next.add(id); }
        return next;
    });
    const goLedger = (id: number) => router.push(`/office/tally/account/${id}?from=${from}&to=${to}`);
    const goGroup  = (id: number) => router.push(`/office/tally/groups/${id}?from=${from}&to=${to}`);

    const tradingDr = data
        ? data.trading.debit.openingStock + data.trading.debit.purchaseAccounts + data.trading.debit.directExpenses
        : 0;
    const tradingCr = data
        ? data.trading.credit.salesAccounts + data.trading.credit.directIncomes + data.trading.credit.closingStock
        : 0;
    const pnlDr = data ? data.pnl.debit.indirectExpenses + data.pnl.debit.grossLossBrought : 0;
    const pnlCr = data ? data.pnl.credit.indirectIncomes + data.pnl.credit.grossProfitBrought : 0;

    return (
        <div className="max-w-7xl mx-auto space-y-5">
            {/* Header */}
            <div className="flex items-end justify-between gap-3 flex-wrap print:hidden">
                <div>
                    <h1 className="text-2xl font-bold text-foreground">Profit &amp; Loss A/c</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        {data ? `${fmtIndianDate(data.from)} to ${fmtIndianDate(data.to)}` : "…"}
                    </p>
                </div>
                <div className="flex items-end gap-2">
                    <div className="space-y-1">
                        <Label>From</Label>
                        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-auto" />
                    </div>
                    <div className="space-y-1">
                        <Label>To</Label>
                        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-auto" />
                    </div>
                    <Button onClick={load}>Run</Button>
                    <Button variant="outline" onClick={() => window.print()} title="Print"><Printer size={14} /></Button>
                </div>
            </div>

            {loading && <div className="flex justify-center py-20"><Loader2 className="animate-spin text-muted-foreground" size={28} /></div>}

            {!loading && data && (
                <>
                    {/* Trading Account */}
                    <div className="grid grid-cols-2 gap-6">
                        {/* Debit side */}
                        <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
                            <div className="border-b bg-muted/40 px-4 py-2.5 font-bold">Particulars (Dr)</div>
                            <table className="w-full text-sm">
                                <tbody>
                                    <StaticRow label="Opening Stock" amount={data.trading.debit.openingStock} italic />
                                    {data.trees.purchaseAccounts && (
                                        <GroupBlock node={data.trees.purchaseAccounts} depth={0}
                                            expanded={expanded} toggle={toggle}
                                            onLedger={goLedger} onGroup={goGroup} />
                                    )}
                                    {data.trees.directExpenses && (
                                        <GroupBlock node={data.trees.directExpenses} depth={0}
                                            expanded={expanded} toggle={toggle}
                                            onLedger={goLedger} onGroup={goGroup} />
                                    )}
                                    {data.grossProfit > 0 && (
                                        <tr className="border-t bg-muted/20">
                                            <td className="py-1.5 px-3 font-semibold italic">Gross Profit c/o</td>
                                            <td className="py-1.5 pr-3 text-right font-mono font-semibold">{fmt(data.grossProfit)}</td>
                                        </tr>
                                    )}
                                </tbody>
                                <tfoot>
                                    <tr className="border-t-2 border-border bg-muted/30">
                                        <td className="py-2 px-3 font-semibold">Total</td>
                                        <td className="py-2 pr-3 text-right font-mono font-bold">
                                            {fmt(Math.max(tradingDr + (data.grossProfit > 0 ? data.grossProfit : 0), tradingCr))}
                                        </td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                        {/* Credit side */}
                        <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
                            <div className="border-b bg-muted/40 px-4 py-2.5 font-bold">Particulars (Cr)</div>
                            <table className="w-full text-sm">
                                <tbody>
                                    {data.trees.salesAccounts && (
                                        <GroupBlock node={data.trees.salesAccounts} depth={0}
                                            expanded={expanded} toggle={toggle}
                                            onLedger={goLedger} onGroup={goGroup} />
                                    )}
                                    {data.trees.directIncomes && (
                                        <GroupBlock node={data.trees.directIncomes} depth={0}
                                            expanded={expanded} toggle={toggle}
                                            onLedger={goLedger} onGroup={goGroup} />
                                    )}
                                    <StaticRow label="Closing Stock" amount={data.trading.credit.closingStock} italic />
                                    {data.grossProfit < 0 && (
                                        <tr className="border-t bg-muted/20">
                                            <td className="py-1.5 px-3 font-semibold italic">Gross Loss c/o</td>
                                            <td className="py-1.5 pr-3 text-right font-mono font-semibold">{fmt(Math.abs(data.grossProfit))}</td>
                                        </tr>
                                    )}
                                </tbody>
                                <tfoot>
                                    <tr className="border-t-2 border-border bg-muted/30">
                                        <td className="py-2 px-3 font-semibold">Total</td>
                                        <td className="py-2 pr-3 text-right font-mono font-bold">
                                            {fmt(Math.max(tradingDr + (data.grossProfit > 0 ? data.grossProfit : 0), tradingCr + (data.grossProfit < 0 ? Math.abs(data.grossProfit) : 0)))}
                                        </td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    </div>

                    {/* Profit & Loss section */}
                    <div className="grid grid-cols-2 gap-6">
                        {/* Debit side */}
                        <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
                            <div className="border-b bg-muted/40 px-4 py-2.5 font-bold">P&amp;L Particulars (Dr)</div>
                            <table className="w-full text-sm">
                                <tbody>
                                    {data.trees.indirectExpenses && (
                                        <GroupBlock node={data.trees.indirectExpenses} depth={0}
                                            expanded={expanded} toggle={toggle}
                                            onLedger={goLedger} onGroup={goGroup} />
                                    )}
                                    {data.pnl.debit.grossLossBrought > 0 && (
                                        <StaticRow label="Gross Loss b/f" amount={data.pnl.debit.grossLossBrought} italic />
                                    )}
                                    {data.netProfit > 0 && (
                                        <tr className="border-t bg-green-50/30 dark:bg-green-950/20">
                                            <td className="py-1.5 px-3 font-semibold">Nett Profit</td>
                                            <td className="py-1.5 pr-3 text-right font-mono font-semibold text-green-700 dark:text-green-400">
                                                {fmt(data.netProfit)}
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                                <tfoot>
                                    <tr className="border-t-2 border-border bg-muted/30">
                                        <td className="py-2 px-3 font-semibold">Total</td>
                                        <td className="py-2 pr-3 text-right font-mono font-bold">
                                            {fmt(Math.max(pnlDr + (data.netProfit > 0 ? data.netProfit : 0), pnlCr))}
                                        </td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                        {/* Credit side */}
                        <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
                            <div className="border-b bg-muted/40 px-4 py-2.5 font-bold">P&amp;L Particulars (Cr)</div>
                            <table className="w-full text-sm">
                                <tbody>
                                    {data.trees.indirectIncomes && (
                                        <GroupBlock node={data.trees.indirectIncomes} depth={0}
                                            expanded={expanded} toggle={toggle}
                                            onLedger={goLedger} onGroup={goGroup} />
                                    )}
                                    {data.pnl.credit.grossProfitBrought > 0 && (
                                        <StaticRow label="Gross Profit b/f" amount={data.pnl.credit.grossProfitBrought} italic />
                                    )}
                                    {data.netProfit < 0 && (
                                        <tr className="border-t bg-destructive/10">
                                            <td className="py-1.5 px-3 font-semibold">Nett Loss</td>
                                            <td className="py-1.5 pr-3 text-right font-mono font-semibold text-destructive">
                                                {fmt(Math.abs(data.netProfit))}
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                                <tfoot>
                                    <tr className="border-t-2 border-border bg-muted/30">
                                        <td className="py-2 px-3 font-semibold">Total</td>
                                        <td className="py-2 pr-3 text-right font-mono font-bold">
                                            {fmt(Math.max(pnlDr + (data.netProfit > 0 ? data.netProfit : 0), pnlCr + (data.netProfit < 0 ? Math.abs(data.netProfit) : 0)))}
                                        </td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    </div>

                    {/* Net P&L summary card */}
                    <div className="text-center text-sm py-4 border-t border-border print:hidden">
                        <span className="text-muted-foreground">Net for period:</span>{" "}
                        <span className={`font-bold font-mono ${data.netProfit < 0 ? "text-destructive" : "text-green-700 dark:text-green-400"}`}>
                            {data.netProfit < 0 ? "Loss" : "Profit"} {fmt(Math.abs(data.netProfit))}
                        </span>
                    </div>
                </>
            )}
        </div>
    );
}
