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

type GroupTypeStr = "ASSET" | "LIABILITY";

interface LedgerNode {
    id: number; name: string; closing: number;
    customerId: number | null; companyId: number | null;
}
interface GroupNode {
    id: number; name: string; type: GroupTypeStr; sortOrder: number;
    children: GroupNode[]; ledgers: LedgerNode[];
    rolledUpClosing: number;
}
interface BalanceSheetData {
    asOf: string;
    fyStart: string;
    liabilities: GroupNode[];
    assets: GroupNode[];
    netProfitLoss: number;
    closingStock: { computed: number; postedToGl: number; diff: number; productCount: number };
}

function fmtIndianDate(iso: string): string {
    return new Date(iso).toLocaleDateString("en-GB", {
        day: "2-digit", month: "short", year: "numeric",
    });
}

function GroupBlock({ node, depth, expanded, toggle, onLedger, onGroup }: {
    node: GroupNode;
    depth: number;
    expanded: Set<number>;
    toggle: (id: number) => void;
    onLedger: (id: number) => void;
    onGroup: (id: number) => void;
}) {
    const isOpen = expanded.has(node.id);
    const hasContent = node.children.length > 0 || node.ledgers.length > 0;
    const balance = node.rolledUpClosing;

    return (
        <Fragment>
            <tr className="hover:bg-muted/40">
                <td className="py-1.5" style={{ paddingLeft: 8 + depth * 16 }}>
                    <button
                        type="button"
                        className="flex items-center gap-1 font-medium text-foreground hover:underline"
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
                <td className="py-1.5 pr-3 text-right font-mono text-sm">
                    {balance !== 0 ? (
                        <span className={balance < 0 ? "text-destructive" : ""}>{fmt(Math.abs(balance))}</span>
                    ) : <span className="text-muted-foreground/40">—</span>}
                </td>
            </tr>
            {isOpen && (
                <>
                    {node.children.map((c) => (
                        <GroupBlock
                            key={`g-${c.id}`} node={c} depth={depth + 1}
                            expanded={expanded} toggle={toggle}
                            onLedger={onLedger} onGroup={onGroup}
                        />
                    ))}
                    {node.ledgers.map((l) => (
                        <tr
                            key={`l-${l.id}`}
                            className="cursor-pointer hover:bg-primary/5"
                            onClick={() => onLedger(l.id)}
                        >
                            <td
                                className="py-1 text-muted-foreground"
                                style={{ paddingLeft: 24 + depth * 16 }}
                            >
                                <span className="hover:underline hover:text-primary">{l.name}</span>
                            </td>
                            <td className="py-1 pr-3 text-right font-mono text-sm">
                                {l.closing !== 0 ? (
                                    <span className={l.closing < 0 ? "text-destructive" : "text-muted-foreground"}>
                                        {fmt(Math.abs(l.closing))}
                                    </span>
                                ) : <span className="text-muted-foreground/30">—</span>}
                            </td>
                        </tr>
                    ))}
                </>
            )}
        </Fragment>
    );
}

export default function BalanceSheetPage() {
    const router = useRouter();
    const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10));
    const [data, setData] = useState<BalanceSheetData | null>(null);
    const [loading, setLoading] = useState(false);
    const [expanded, setExpanded] = useState<Set<number>>(new Set());

    const load = useCallback(() => {
        setLoading(true);
        axios.get<BalanceSheetData>(`/api/finance/reports/balance-sheet?asOf=${asOf}`)
            .then((r) => {
                setData(r.data);
                // auto-expand top-level groups on first load
                setExpanded((prev) => {
                    if (prev.size > 0) return prev;
                    const ids = [...r.data.liabilities, ...r.data.assets].map((g) => g.id);
                    return new Set(ids);
                });
            })
            .catch(() => toast.error("Failed to load balance sheet"))
            .finally(() => setLoading(false));
    }, [asOf]);

    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(load, [load]);

    const toggle = (id: number) => setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(id)) { next.delete(id); } else { next.add(id); }
        return next;
    });

    const goLedger = (id: number) =>
        router.push(`/office/tally/account/${id}?asOf=${asOf}`);
    const goGroup = (id: number) =>
        router.push(`/office/tally/groups/${id}?asOf=${asOf}`);

    // Compute side totals (with closing-stock + net P&L injection)
    let liabilitiesTotal = 0;
    if (data) {
        liabilitiesTotal = data.liabilities.reduce((s, g) => s + g.rolledUpClosing, 0);
        // Surface net P&L on Liabilities side under Capital Account
        liabilitiesTotal += data.netProfitLoss;
    }
    let assetsTotal = 0;
    if (data) {
        assetsTotal = data.assets.reduce((s, g) => s + g.rolledUpClosing, 0);
        // Replace any zero/missing closing-stock GL with the live computed value
        if (data.closingStock.diff !== 0) assetsTotal += data.closingStock.diff;
    }
    const difference = liabilitiesTotal - assetsTotal;

    return (
        <div className="max-w-7xl mx-auto space-y-5">
            {/* Header */}
            <div className="flex items-end justify-between gap-3 flex-wrap print:hidden">
                <div>
                    <h1 className="text-2xl font-bold text-foreground">Balance Sheet</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        Period: {data ? `${fmtIndianDate(data.fyStart)} as at ${fmtIndianDate(data.asOf)}` : "…"}
                    </p>
                </div>
                <div className="flex items-end gap-2">
                    <div className="space-y-1">
                        <Label>As at</Label>
                        <Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className="w-auto" />
                    </div>
                    <Button onClick={load}>Run</Button>
                    <Button variant="outline" onClick={() => window.print()} title="Print">
                        <Printer size={14} />
                    </Button>
                </div>
            </div>

            {loading && (
                <div className="flex justify-center py-20"><Loader2 className="animate-spin text-muted-foreground" size={28} /></div>
            )}

            {!loading && data && (
                <div className="grid grid-cols-2 gap-6">
                    {/* Liabilities */}
                    <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
                        <div className="border-b border-border bg-muted/40 px-4 py-2.5 flex items-baseline justify-between">
                            <h2 className="font-bold text-foreground">Liabilities</h2>
                            <span className="text-xs text-muted-foreground">as at {fmtIndianDate(data.asOf)}</span>
                        </div>
                        <table className="w-full text-sm">
                            <tbody>
                                {data.liabilities.map((g) => (
                                    <GroupBlock
                                        key={g.id} node={g} depth={0}
                                        expanded={expanded} toggle={toggle}
                                        onLedger={goLedger} onGroup={goGroup}
                                    />
                                ))}
                                {/* Net P&L synthetic row under Capital */}
                                {data.netProfitLoss !== 0 && (
                                    <tr
                                        className="cursor-pointer hover:bg-primary/5"
                                        onClick={() => router.push(`/office/tally/reports/profit-loss?from=${data.fyStart.slice(0,10)}&to=${asOf}`)}
                                    >
                                        <td className="py-1.5 text-muted-foreground italic" style={{ paddingLeft: 16 }}>
                                            <span className="hover:underline hover:text-primary">
                                                Profit &amp; Loss A/c {data.netProfitLoss < 0 ? "(loss)" : ""}
                                            </span>
                                        </td>
                                        <td className="py-1.5 pr-3 text-right font-mono text-sm">
                                            {fmt(Math.abs(data.netProfitLoss))}
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                            <tfoot>
                                <tr className="border-t-2 border-border bg-muted/30">
                                    <td className="py-2 px-3 font-semibold">Total</td>
                                    <td className="py-2 pr-3 text-right font-mono font-bold">
                                        {fmt(liabilitiesTotal)}
                                    </td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>

                    {/* Assets */}
                    <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
                        <div className="border-b border-border bg-muted/40 px-4 py-2.5 flex items-baseline justify-between">
                            <h2 className="font-bold text-foreground">Assets</h2>
                            <span className="text-xs text-muted-foreground">as at {fmtIndianDate(data.asOf)}</span>
                        </div>
                        <table className="w-full text-sm">
                            <tbody>
                                {data.assets.map((g) => (
                                    <GroupBlock
                                        key={g.id} node={g} depth={0}
                                        expanded={expanded} toggle={toggle}
                                        onLedger={goLedger} onGroup={goGroup}
                                    />
                                ))}
                                {/* Closing stock — synthetic row showing live valuation if different from GL */}
                                {data.closingStock.diff !== 0 && (
                                    <tr className="bg-amber-50/30 dark:bg-amber-950/10">
                                        <td className="py-1.5 italic text-muted-foreground" style={{ paddingLeft: 16 }} title="Live valuation: SUM(stock × cost)">
                                            Closing Stock (live valuation)
                                        </td>
                                        <td className="py-1.5 pr-3 text-right font-mono text-sm">
                                            {fmt(data.closingStock.diff)}
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                            <tfoot>
                                <tr className="border-t-2 border-border bg-muted/30">
                                    <td className="py-2 px-3 font-semibold">Total</td>
                                    <td className="py-2 pr-3 text-right font-mono font-bold">
                                        {fmt(assetsTotal)}
                                    </td>
                                </tr>
                                {Math.abs(difference) > 0.005 && (
                                    <tr className="border-t border-dashed text-amber-700 dark:text-amber-400">
                                        <td className="py-1.5 px-3 italic text-xs">Difference in opening balances</td>
                                        <td className="py-1.5 pr-3 text-right font-mono text-xs">
                                            {fmt(Math.abs(difference))}
                                        </td>
                                    </tr>
                                )}
                            </tfoot>
                        </table>
                    </div>
                </div>
            )}

            {/* Footnote: closing-stock reconciliation */}
            {data && data.closingStock.productCount > 0 && (
                <p className="text-xs text-muted-foreground text-center pt-2 print:hidden">
                    Closing stock computed live from {data.closingStock.productCount} product(s):
                    <span className="font-mono ml-1">{fmt(data.closingStock.computed)}</span>
                    {data.closingStock.diff !== 0 && (
                        <span> · GL posted: <span className="font-mono">{fmt(data.closingStock.postedToGl)}</span></span>
                    )}
                </p>
            )}

        </div>
    );
}
