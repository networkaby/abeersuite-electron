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

// Tally-style THREE-column amount layout with depth-aware visual weight:
//   • "group"   → top-level group total + special rows (P&L, Diff) → OUTER col, bold
//   • "subGroup"→ nested group total                                 → MIDDLE col, medium
//   • "ledger"  → individual ledger                                  → INNER col, light / small
// Each row places its figure in exactly one of the three columns; the others
// stay blank. Stepping the amount horizontally as we descend the tree makes
// the hierarchy visible at a glance.
type AmountWeight = "group" | "subGroup" | "ledger";

function AmountCells({ value, weight }: {
    value: number;
    weight: AmountWeight;
}) {
    const isLedger = weight === "ledger";
    const weightCls =
        weight === "group" ? "font-semibold text-foreground" :
            weight === "subGroup" ? "font-medium text-foreground" :
                "font-normal text-muted-foreground text-sm";
    const cell = (n: number) =>
        n !== 0
            ? <span className={n < 0 ? "text-destructive" : weightCls}>{fmt(Math.abs(n))}</span>
            : <span className={isLedger ? "text-muted-foreground/30" : "text-muted-foreground/40"}>—</span>;
    return (
        <>
            <td className="py-1 pr-2 text-right font-mono whitespace-nowrap w-[90px]">
                {weight === "ledger" ? cell(value) : null}
            </td>
            <td className="py-1 pr-2 text-right font-mono whitespace-nowrap w-[100px]">
                {weight === "subGroup" ? cell(value) : null}
            </td>
            <td className="py-1 pr-3 text-right font-mono whitespace-nowrap w-[110px]">
                {weight === "group" ? cell(value) : null}
            </td>
        </>
    );
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
                <AmountCells value={balance} weight={weight} />
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
                                className="py-0.5 text-[14px] text-muted-foreground"
                                style={{ paddingLeft: 24 + depth * 14 }}
                            >
                                <span className="hover:underline hover:text-primary">{l.name}</span>
                            </td>
                            <AmountCells value={l.closing} weight="ledger" />
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
    // P&L positioning (Tally convention):
    //   • Profit (netProfitLoss > 0)  → credit balance → Liabilities side
    //   • Loss   (netProfitLoss < 0)  → debit  balance → Assets side
    // Mathematically equivalent to keeping it signed on Liabilities, but
    // visually matches Tally and removes the negative-on-liabilities oddity.
    //
    // baselineLiab/Asset = the real rolled-up totals before any synthetic
    // suspense entry. rawDifference > 0 means assets exceed liabilities so
    // we need a synthetic Cr on the LIABILITY side to balance the books.
    // < 0 means the opposite (rare). Whichever side gets the synthetic, we
    // add it to that side's total so both grand totals reconcile.
    const npl = data?.netProfitLoss ?? 0;
    const profitOnLiab = npl > 0 ? npl : 0;
    const lossOnAsset = npl < 0 ? -npl : 0;
    const liabBaseline = data ? data.liabilities.reduce((s, g) => s + g.rolledUpClosing, 0) + profitOnLiab : 0;
    const assetBaseline = data ? data.assets.reduce((s, g) => s + g.rolledUpClosing, 0) + lossOnAsset : 0;
    const rawDifference = assetBaseline - liabBaseline;
    const synthOnLiability = rawDifference > 0.005 ? rawDifference : 0;
    const synthOnAsset = rawDifference < -0.005 ? -rawDifference : 0;
    const liabilitiesTotal = liabBaseline + synthOnLiability;
    const assetsTotal = assetBaseline + synthOnAsset;

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
                    <Button onClick={load}>Refresh</Button>
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
                <div className="grid grid-cols-2 gap-2 items-stretch">
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
                                {/* P&L appears on Liabilities only when it's a profit (Cr balance).
                                    Treated as a top-level "group" row — same prominence as Capital Account. */}
                                {profitOnLiab > 0 && (
                                    <tr
                                        className="cursor-pointer hover:bg-primary/5"
                                        onClick={() => router.push(`/office/accountancy/reports/profit-loss?from=${data.fyStart.slice(0, 10)}&to=${asOf}&ref=balance-sheet`)}
                                    >
                                        <td className="py-1 pl-2">
                                            <span className="font-semibold text-sm text-foreground hover:underline">Profit &amp; Loss A/c</span>
                                        </td>
                                        <AmountCells value={profitOnLiab} weight="group" />
                                    </tr>
                                )}
                                {/* Auto-computed plug — appears here when Σ Dr opening > Σ Cr opening.
                                    Promoted to group-level position so it's not lost among ledgers. */}
                                {synthOnLiability > 0 && (
                                    <tr
                                        className="text-amber-700 dark:text-amber-400"
                                        title="Auto-computed: assets exceed liabilities by this amount. Add Capital / Loan opening to clear."
                                    >
                                        <td className="py-1 pl-2">
                                            <span className="font-semibold text-sm">Difference in opening balances</span>
                                        </td>
                                        <AmountCells value={synthOnLiability} weight="group" />
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
                                {/* P&L appears on Assets only when it's a loss (Dr balance).
                                    Treated as a top-level "group" row. */}
                                {lossOnAsset > 0 && (
                                    <tr
                                        className="cursor-pointer hover:bg-primary/5"
                                        onClick={() => router.push(`/office/accountancy/reports/profit-loss?from=${data.fyStart.slice(0, 10)}&to=${asOf}&ref=balance-sheet`)}
                                    >
                                        <td className="py-1 pl-2">
                                            <span className="font-semibold text-sm text-foreground hover:underline">Profit &amp; Loss A/c (loss)</span>
                                        </td>
                                        <AmountCells value={lossOnAsset} weight="group" />
                                    </tr>
                                )}
                                {/* Auto-computed plug — rare; appears here when Σ Cr opening > Σ Dr opening.
                                    Promoted to group-level position. */}
                                {synthOnAsset > 0 && (
                                    <tr
                                        className="text-amber-700 dark:text-amber-400"
                                        title="Auto-computed: liabilities exceed assets by this amount. Add Bank / Cash opening to clear."
                                    >
                                        <td className="py-1 pl-2">
                                            <span className="font-semibold text-sm">Difference in opening balances</span>
                                        </td>
                                        <AmountCells value={synthOnAsset} weight="group" />
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
