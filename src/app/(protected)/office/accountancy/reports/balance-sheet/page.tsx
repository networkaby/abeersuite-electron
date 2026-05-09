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

    const goLedger = (id: number) => {
        if (id <= 0) return;  // synthetic ledger (e.g. injected Closing Stock) — no drill-in
        router.push(`/office/accountancy/account/${id}?asOf=${asOf}`);
    };
    const goGroup = (id: number) =>
        router.push(`/office/accountancy/groups/${id}?asOf=${asOf}`);

    // Compute side totals + auto-balancing "Difference in opening balances".
    //
    // baselineLiab/Asset = the real rolled-up totals before any synthetic
    // suspense entry. rawDifference > 0 means assets exceed liabilities so
    // we need a synthetic Cr on the LIABILITY side to balance the books.
    // < 0 means the opposite (rare — happens when user opens a Loan but no
    // matching asset). Whichever side gets the synthetic, we add it to that
    // side's total so both grand totals reconcile.
    const liabBaseline   = data ? data.liabilities.reduce((s, g) => s + g.rolledUpClosing, 0) + data.netProfitLoss : 0;
    const assetBaseline  = data ? data.assets.reduce((s, g) => s + g.rolledUpClosing, 0) : 0;
    const rawDifference  = assetBaseline - liabBaseline;
    const synthOnLiability = rawDifference >  0.005 ?  rawDifference : 0;
    const synthOnAsset     = rawDifference < -0.005 ? -rawDifference : 0;
    const liabilitiesTotal = liabBaseline  + synthOnLiability;
    const assetsTotal      = assetBaseline + synthOnAsset;

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
                // items-stretch → both columns equal height; totals row sticks to the
                // bottom of each column via mt-auto so they line up horizontally.
                <div className="grid grid-cols-2 gap-6 items-stretch">
                    {/* Liabilities */}
                    <div className="flex flex-col overflow-hidden rounded-lg border border-border bg-card shadow-sm">
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
                                        onClick={() => router.push(`/office/accountancy/reports/profit-loss?from=${data.fyStart.slice(0,10)}&to=${asOf}`)}
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
                                {/* Auto-computed plug — appears here when Σ Dr opening > Σ Cr opening. */}
                                {synthOnLiability > 0 && (
                                    <tr className="text-amber-700 dark:text-amber-400" title="Auto-computed: assets exceed liabilities by this amount. Add Capital / Loan opening to clear.">
                                        <td className="py-1.5 px-3 italic text-xs">Difference in opening balances</td>
                                        <td className="py-1.5 pr-3 text-right font-mono text-xs">{fmt(synthOnLiability)}</td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                        {/* Total — pushed to bottom so it lines up with the Assets total horizontally. */}
                        <div className="mt-auto border-t-2 border-border bg-muted/30 px-3 py-2 flex items-center justify-between font-bold text-sm">
                            <span>Total</span>
                            <span className="font-mono">{fmt(liabilitiesTotal)}</span>
                        </div>
                    </div>

                    {/* Assets */}
                    <div className="flex flex-col overflow-hidden rounded-lg border border-border bg-card shadow-sm">
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
                                {/* Live closing-stock now appears as a synthetic ledger
                                    inside the Stock-in-Hand group (injected by the API). */}
                                {/* Auto-computed plug — rare; appears here when Σ Cr opening > Σ Dr opening. */}
                                {synthOnAsset > 0 && (
                                    <tr className="text-amber-700 dark:text-amber-400" title="Auto-computed: liabilities exceed assets by this amount. Add Bank / Cash opening to clear.">
                                        <td className="py-1.5 px-3 italic text-xs">Difference in opening balances</td>
                                        <td className="py-1.5 pr-3 text-right font-mono text-xs">{fmt(synthOnAsset)}</td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                        <div className="mt-auto border-t-2 border-border bg-muted/30 px-3 py-2 flex items-center justify-between font-bold text-sm">
                            <span>Total</span>
                            <span className="font-mono">{fmt(assetsTotal)}</span>
                        </div>
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
