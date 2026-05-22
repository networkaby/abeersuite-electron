"use client";

import { useEffect, useState, useCallback, Fragment } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, Printer, ChevronRight, ChevronDown, ArrowLeft } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { fmt } from "@/utils/constants";
import { indianFiscalYearStart } from "@/modules/accountancy/lib/period";
import { accountLedgerUrl } from "@/modules/accountancy/lib/accountLedgerUrl";
import { TallyDateInput } from "@/shared/components/TallyDateInput";
import { toIsoDate } from "@/shared/hooks/useTallyDate";
import { useEscapeBack } from "@/shared/hooks/useEscapeBack";

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

// Three-column amount layout — matches Tally's stepped placement:
//   • "group"    → top-level group total → OUTER col, bold
//   • "subGroup" → nested group total    → MIDDLE col, medium
//   • "ledger"   → individual ledger     → INNER col, italic / muted
type AmountWeight = "group" | "subGroup" | "ledger";

function AmountCells({ value, weight, abs = true }: {
    value: number; weight: AmountWeight; abs?: boolean;
}) {
    const isLedger  = weight === "ledger";
    const display   = abs ? Math.abs(value) : value;
    const weightCls =
        weight === "group"    ? "font-semibold text-foreground"          :
        weight === "subGroup" ? "font-medium text-foreground"            :
                                "font-normal italic text-muted-foreground text-sm";
    const cell =
        display !== 0
            ? <span className={display < 0 ? "text-destructive" : weightCls}>{fmt(Math.abs(display))}</span>
            : <span className={isLedger ? "text-muted-foreground/30" : "text-muted-foreground/40"}>—</span>;
    return (
        <>
            <td className="py-1 pr-2 text-right font-mono whitespace-nowrap w-[90px]">
                {weight === "ledger"   ? cell : null}
            </td>
            <td className="py-1 pr-2 text-right font-mono whitespace-nowrap w-[100px]">
                {weight === "subGroup" ? cell : null}
            </td>
            <td className="py-1 pr-3 text-right font-mono whitespace-nowrap w-[110px]">
                {weight === "group"    ? cell : null}
            </td>
        </>
    );
}

function GroupBlock({ node, depth, expanded, toggle, onLedger, onGroup, abs = true }: {
    node: GroupNode; depth: number;
    expanded: Set<number>; toggle: (id: number) => void;
    onLedger: (id: number) => void; onGroup: (id: number) => void;
    abs?: boolean;
}) {
    const isOpen = expanded.has(node.id);
    const hasContent = node.children.length > 0 || node.ledgers.length > 0;
    const weight: AmountWeight = depth === 0 ? "group" : "subGroup";
    return (
        <Fragment>
            <tr className="hover:bg-muted/40">
                <td className="py-1" style={{ paddingLeft: 8 + depth * 14 }}>
                    <button
                        type="button"
                        className="flex items-center gap-1 text-foreground hover:underline"
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
                        <span className={depth === 0 ? "font-semibold text-sm" : "font-medium text-sm"}>
                            {node.name}
                        </span>
                    </button>
                </td>
                <AmountCells value={node.rolledUpClosing} weight={weight} abs={abs} />
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
                            <td className="py-0.5 italic text-[14px] text-muted-foreground"
                                style={{ paddingLeft: 24 + depth * 14 }}>
                                <span className="hover:underline hover:text-primary">{l.name}</span>
                            </td>
                            <AmountCells value={l.closing} weight="ledger" abs={abs} />
                        </tr>
                    ))}
                </>
            )}
        </Fragment>
    );
}

// Special non-group rows (Opening Stock, Closing Stock, Gross Profit/Loss c/o,
// Nett Profit/Loss). They sit at the same prominence as a top-level group.
function StaticRow({ label, amount, weight = "group", className = "" }: {
    label: string; amount: number;
    weight?: AmountWeight;
    className?: string;
}) {
    const labelCls =
        weight === "group"    ? "font-semibold text-sm" :
        weight === "subGroup" ? "font-medium text-sm"   :
                                "italic text-[14px] text-muted-foreground";
    return (
        <tr className={className}>
            <td className={`py-1 pl-2 ${labelCls}`}>{label}</td>
            <AmountCells value={amount} weight={weight} />
        </tr>
    );
}

export default function ProfitLossPage() {
    const router = useRouter();
    const search = useSearchParams();
    const fyStart = indianFiscalYearStart();
    // Date params on the URL come from the BS drilldown (passes ?from=&to=&ref=balance-sheet).
    const [from, setFrom] = useState(search.get("from") ?? toIsoDate(fyStart));
    const [to, setTo]     = useState(search.get("to")   ?? toIsoDate(new Date()));
    const [data, setData] = useState<PLData | null>(null);
    const [loading, setLoading] = useState(false);
    const [expanded, setExpanded] = useState<Set<number>>(new Set());

    // Escape to go back — works when the user drilled in from BS / dashboard / etc.
    useEscapeBack();
    // Breadcrumb continuity — when ?ref=balance-sheet is present, surface a link
    // back to the Balance Sheet so the user knows where they came from.
    const cameFromBalanceSheet = search.get("ref") === "balance-sheet";
    const bsHref = `/office/accountancy/reports/balance-sheet?asOf=${to}`;

    const load = useCallback(() => {
        setLoading(true);
        axios.get<PLData>(`/api/accountancy/reports/profit-loss?from=${from}&to=${to}`)
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
    const goLedger = (id: number) => router.push(accountLedgerUrl(id, { from, to }));
    const goGroup  = (id: number) => router.push(`/office/accountancy/masters/groups/${id}?from=${from}&to=${to}`);

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
                <div className="flex items-start gap-2">
                    {cameFromBalanceSheet && (
                        <Button variant="ghost" size="icon-sm" onClick={() => router.back()} title="Back to Balance Sheet (Esc)">
                            <ArrowLeft size={16} />
                        </Button>
                    )}
                    <div>
                        <h1 className="text-2xl font-bold text-foreground">Profit &amp; Loss A/c</h1>
                        <p className="text-sm text-muted-foreground mt-0.5">
                            {cameFromBalanceSheet && (
                                <>
                                    <Link href={bsHref} className="hover:underline">Balance Sheet</Link>
                                    {" › "}
                                </>
                            )}
                            {data ? `${fmtIndianDate(data.from)} to ${fmtIndianDate(data.to)}` : "…"}
                        </p>
                    </div>
                </div>
                <div className="flex items-end gap-2">
                    <div className="space-y-1">
                        <Label>From</Label>
                        <TallyDateInput value={from} onValueChange={setFrom} className="w-auto" />
                    </div>
                    <div className="space-y-1">
                        <Label>To</Label>
                        <TallyDateInput value={to} onValueChange={setTo} className="w-auto" />
                    </div>
                    <Button onClick={load}>Refresh</Button>
                    <Button variant="outline" onClick={() => window.print()} title="Print"><Printer size={14} /></Button>
                </div>
            </div>

            {loading && <div className="flex justify-center py-20"><Loader2 className="animate-spin text-muted-foreground" size={28} /></div>}

            {!loading && data && (
                <div className="space-y-0">
                    {/* Trading Account — both totals reconcile to the same number, so we
                        render ONE shared total bar pinned to the bottom of both cards via
                        flex-col + mt-auto on the table's parent. Gap between Dr/Cr is 1px. */}
                    {(() => {
                        const tradingTotal = Math.max(
                            tradingDr + (data.grossProfit > 0 ? data.grossProfit : 0),
                            tradingCr + (data.grossProfit < 0 ? Math.abs(data.grossProfit) : 0),
                        );
                        return (
                            <div className="grid grid-cols-2 gap-px items-stretch bg-border rounded-t-lg overflow-hidden border border-border border-b-0 shadow-sm">
                                {/* Debit side */}
                                <div className="flex flex-col bg-card">
                                    <div className="border-b bg-muted/40 px-4 py-2.5 font-bold">Particulars (Dr)</div>
                                    <table className="w-full text-sm">
                                        <tbody>
                                            <StaticRow label="Opening Stock" amount={data.trading.debit.openingStock} />
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
                                                <StaticRow label="Gross Profit c/o" amount={data.grossProfit} className="border-t bg-muted/20" />
                                            )}
                                        </tbody>
                                    </table>
                                    <div className="mt-auto border-t-2 border-border bg-muted/30 px-3 py-2 flex items-center justify-between">
                                        <span className="font-semibold">Total</span>
                                        <span className="font-mono font-bold">{fmt(tradingTotal)}</span>
                                    </div>
                                </div>
                                {/* Credit side */}
                                <div className="flex flex-col bg-card">
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
                                            <StaticRow label="Closing Stock" amount={data.trading.credit.closingStock} />
                                            {data.grossProfit < 0 && (
                                                <StaticRow label="Gross Loss c/o" amount={Math.abs(data.grossProfit)} className="border-t bg-muted/20" />
                                            )}
                                        </tbody>
                                    </table>
                                    <div className="mt-auto border-t-2 border-border bg-muted/30 px-3 py-2 flex items-center justify-between">
                                        <span className="font-semibold">Total</span>
                                        <span className="font-mono font-bold">{fmt(tradingTotal)}</span>
                                    </div>
                                </div>
                            </div>
                        );
                    })()}

                    {/* Profit & Loss section — same flex/mt-auto trick aligns totals. */}
                    {(() => {
                        const pnlTotal = Math.max(
                            pnlDr + (data.netProfit > 0 ? data.netProfit : 0),
                            pnlCr + (data.netProfit < 0 ? Math.abs(data.netProfit) : 0),
                        );
                        return (
                            <div className="grid grid-cols-2 gap-px items-stretch bg-border rounded-b-lg overflow-hidden border border-border shadow-sm">
                                {/* Debit side — header omitted; this block continues from
                                    the Trading total above and the "Particulars (Dr)" label
                                    on that block already names the column. */}
                                <div className="flex flex-col bg-card">
                                    <table className="w-full text-sm">
                                        <tbody>
                                            {data.trees.indirectExpenses && (
                                                <GroupBlock node={data.trees.indirectExpenses} depth={0}
                                                    expanded={expanded} toggle={toggle}
                                                    onLedger={goLedger} onGroup={goGroup} />
                                            )}
                                            {data.pnl.debit.grossLossBrought > 0 && (
                                                <StaticRow label="Gross Loss b/f" amount={data.pnl.debit.grossLossBrought} />
                                            )}
                                            {data.netProfit > 0 && (
                                                <StaticRow label="Nett Profit" amount={data.netProfit} className="border-t bg-green-50/30 dark:bg-green-950/20" />
                                            )}
                                        </tbody>
                                    </table>
                                    <div className="mt-auto border-t-2 border-border bg-muted/30 px-3 py-2 flex items-center justify-between">
                                        <span className="font-semibold">Total</span>
                                        <span className="font-mono font-bold">{fmt(pnlTotal)}</span>
                                    </div>
                                </div>
                                {/* Credit side */}
                                <div className="flex flex-col bg-card">
                                    <table className="w-full text-sm">
                                        <tbody>
                                            {data.trees.indirectIncomes && (
                                                <GroupBlock node={data.trees.indirectIncomes} depth={0}
                                                    expanded={expanded} toggle={toggle}
                                                    onLedger={goLedger} onGroup={goGroup} />
                                            )}
                                            {data.pnl.credit.grossProfitBrought > 0 && (
                                                <StaticRow label="Gross Profit b/f" amount={data.pnl.credit.grossProfitBrought} />
                                            )}
                                            {data.netProfit < 0 && (
                                                <StaticRow label="Nett Loss" amount={Math.abs(data.netProfit)} className="border-t bg-destructive/10" />
                                            )}
                                        </tbody>
                                    </table>
                                    <div className="mt-auto border-t-2 border-border bg-muted/30 px-3 py-2 flex items-center justify-between">
                                        <span className="font-semibold">Total</span>
                                        <span className="font-mono font-bold">{fmt(pnlTotal)}</span>
                                    </div>
                                </div>
                            </div>
                        );
                    })()}

                    {/* Net P&L summary card */}
                    <div className="text-center text-sm py-4 mt-4 border-t border-border print:hidden">
                        <span className="text-muted-foreground">Net for period:</span>{" "}
                        <span className={`font-bold font-mono ${data.netProfit < 0 ? "text-destructive" : "text-green-700 dark:text-green-400"}`}>
                            {data.netProfit < 0 ? "Loss" : "Profit"} {fmt(Math.abs(data.netProfit))}
                        </span>
                    </div>
                </div>
            )}
        </div>
    );
}
