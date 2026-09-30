"use client";

import { useEffect, useMemo, useState, Fragment } from "react";
import { toast } from "sonner";
import { useApiResource } from "@/shared/hooks/useApiResource";
import { Loader2, Printer, ChevronRight, ChevronDown } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { fmt } from "@/shared/lib/format/moneyInr";
import { TallyDateInput } from "@/shared/components/TallyDateInput";
import { toIsoDate } from "@/shared/hooks/useTallyDate";
import { fmtPeriodDate } from "@/modules/accountancy/lib/period";
import { defaultNormalBalanceForGroupType } from "@/modules/accountancy/lib/groupNature";
import { accountLedgerUrl } from "@/modules/accountancy/lib/accountLedgerUrl";
import { groupReportUrl } from "@/modules/accountancy/lib/groupReportUrl";
import { useCanOpenPage } from "@/shared/hooks/useCanOpenPage";

type GroupTypeStr = "ASSET" | "LIABILITY";

interface LedgerNode {
    id: number; name: string; closing: number;
    personId: number | null; companyId: number | null;
}
interface GroupNode {
    id: number; name: string; type: GroupTypeStr; sortOrder: number;
    children: GroupNode[]; ledgers: LedgerNode[];
    rolledUpClosing: number;
}
type ValuationMethod =
    | "WEIGHTED_AVG"
    | "SIMPLE_AVG"
    | "FIFO"
    | "LAST_INWARD"
    | "MONTHLY_AVG";

const VALUATION_LABEL: Record<ValuationMethod, string> = {
    WEIGHTED_AVG: "Weighted Average",
    SIMPLE_AVG:   "Simple Average",
    FIFO:         "FIFO",
    LAST_INWARD:  "Last Inward",
    MONTHLY_AVG:  "Monthly Average",
};

const VALUATION_OPTIONS: ValuationMethod[] = [
    "WEIGHTED_AVG", "SIMPLE_AVG", "FIFO", "LAST_INWARD", "MONTHLY_AVG",
];

const ORG_DEFAULT = "__org_default__";

interface BalanceSheetData {
    asOf: string;
    fyStart: string;
    liabilities: GroupNode[];
    assets: GroupNode[];
    netProfitLoss: number;
    closingStock: {
        computed: number; postedToGl: number; diff: number; productCount: number;
        method: ValuationMethod;
    };
}

// Tally-style THREE-column amount layout with depth-aware visual weight:
//   • "group"   → top-level group total + special rows (P&L, Diff) → OUTER col, bold
//   • "subGroup"→ nested group total                                 → MIDDLE col, medium
//   • "ledger"  → individual ledger                                  → INNER col, light / small
// Each row places its figure in exactly one of the three columns; the others
// stay blank. Stepping the amount horizontally as we descend the tree makes
// the hierarchy visible at a glance.
type AmountWeight = "group" | "subGroup" | "ledger";

function AmountCells({ value, weight, side }: {
    value: number;
    weight: AmountWeight;
    /** The column's own nature — Assets read Dr, Liabilities read Cr. */
    side: "DEBIT" | "CREDIT";
}) {
    const isLedger = weight === "ledger";
    const weightCls =
        weight === "group" ? "font-semibold text-foreground" :
            weight === "subGroup" ? "font-medium text-foreground" :
                "font-normal text-muted-foreground text-sm";
    // Balances are signed against their group, so a negative means the figure
    // sits on the OPPOSITE side — a contra ledger like Cash Over, or a customer
    // carrying an advance under Sundry Debtors. Colour alone said that before,
    // which disappears on a black-and-white printout and never said WHICH side.
    // The Dr/Cr suffix is the Trial Balance's own idiom (see its SidedCell).
    const cell = (n: number) => {
        if (Math.abs(n) < 0.005) {
            return <span className={isLedger ? "text-muted-foreground/65" : "text-muted-foreground/65"}>—</span>;
        }
        const onNormal = n > 0;
        const shown = onNormal ? side : (side === "DEBIT" ? "CREDIT" : "DEBIT");
        return (
            <span className={onNormal ? weightCls : "text-destructive"}>
                {fmt(Math.abs(n))}{" "}
                <span className="text-muted-foreground font-normal text-[11px]">
                    {shown === "DEBIT" ? "Dr" : "Cr"}
                </span>
            </span>
        );
    };
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
    onLedger: (ledger: LedgerNode) => void;
    onGroup: (id: number) => void;
}) {
    const isOpen = expanded.has(node.id);
    // Sundry Debtors carries one ledger per customer/school — most sit at zero.
    // Hide the zero-balance ones here so the block only lists actual debtors.
    const visibleLedgers = node.name === "Sundry Debtors"
        ? node.ledgers.filter((l) => l.closing !== 0)
        : node.ledgers;
    const hasContent = node.children.length > 0 || visibleLedgers.length > 0;
    const balance = node.rolledUpClosing;
    const weight: AmountWeight = depth === 0 ? "group" : "subGroup";
    // From the node itself, so a Suspense A/c relocated to Liabilities (which
    // rewrites `type` and flips every sign beneath it) reads correctly too.
    const side = defaultNormalBalanceForGroupType(node.type);

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
                <AmountCells value={balance} weight={weight} side={side} />
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
                    {visibleLedgers.map((l) => (
                        <tr
                            key={`l-${l.id}`}
                            className="cursor-pointer hover:bg-primary/5"
                            onClick={() => onLedger(l)}
                        >
                            <td
                                className="py-0.5 text-[14px] text-muted-foreground"
                                style={{ paddingLeft: 24 + depth * 14 }}
                            >
                                <span className="hover:underline hover:text-primary">{l.name}</span>
                            </td>
                            <AmountCells value={l.closing} weight="ledger" side={side} />
                        </tr>
                    ))}
                </>
            )}
        </Fragment>
    );
}

export default function BalanceSheetPage() {
    const router = useRouter();
    // Drill-downs go only where this person may open (the page lock, pageAccess.ts).
    const canOpen = useCanOpenPage();
    const go = (href: string) => { if (canOpen(href)) router.push(href); };
    const [asOf, setAsOf] = useState(toIsoDate(new Date()));
    /** ORG_DEFAULT sentinel = use OrgDefaults.valuationMethod (BS API default). */
    const [valuationMethod, setValuationMethod] = useState<string>(ORG_DEFAULT);

    const qs = new URLSearchParams({ asOf });
    if (valuationMethod !== ORG_DEFAULT) qs.set("valuationMethod", valuationMethod);
    // A reply for a date / valuation the screen has moved away from is dropped
    // (useApiResource), and a realtime refresh keeps the report on screen.
    // Every write that moves the books announces "ledger", so this covers a
    // voucher posted at another counter as well as one posted here.
    const { data = null, loading, error, reload } = useApiResource<BalanceSheetData>(
        `/api/accountancy/reports/balance-sheet?${qs.toString()}`,
        { topics: ["ledger"] },
    );
    useEffect(() => { if (error) toast.error("Failed to load balance sheet"); }, [error]);
    // Top-level groups open by default; once the reader opens or closes one, their
    // choice stands across refreshes (null = still the default).
    const [expandedChoice, setExpanded] = useState<Set<number> | null>(null);
    const expanded = useMemo(
        () => expandedChoice ?? new Set([...(data?.liabilities ?? []), ...(data?.assets ?? [])].map((g) => g.id)),
        [expandedChoice, data],
    );

    const toggle = (id: number) => {
        const next = new Set(expanded);
        if (next.has(id)) { next.delete(id); } else { next.add(id); }
        setExpanded(next);
    };

    const goLedger = (ledger: LedgerNode) => {
        const { id, personId, companyId } = ledger;
        if (id === -1) {
            go(`/office/inventory/stock-summary?ref=balance-sheet&asOf=${asOf}`);
            return;
        }
        if (id <= 0) return;
        // Party-linked ledgers (Sundry Debtors/Creditors) open in the customer
        // module instead of the raw account ledger — or the ledger, for someone
        // without Contacts.
        if ((personId || companyId) && canOpen(`/office/customers/${id}`)) {
            router.push(`/office/customers/${id}`);
            return;
        }
        go(accountLedgerUrl(id, { asOf }));
    };
    const goGroup = (id: number) =>
        go(groupReportUrl(id, { asOf }));

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
        <ScrollArea className="h-full" type="always">
        <div className="max-w-7xl mx-auto space-y-5 px-6 pt-3 pb-6">
            {/* Header */}
            <div className="flex items-end justify-between gap-3 flex-wrap print:hidden">
                <div>
                    <h1 className="text-2xl font-bold text-foreground">Balance Sheet</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        Period: {data ? `${fmtPeriodDate(data.fyStart)} as at ${fmtPeriodDate(data.asOf)}` : "…"}
                    </p>
                </div>
                <div className="flex items-end gap-2">
                    <div className="space-y-1">
                        <Label>Stock valuation</Label>
                        <Select value={valuationMethod} onValueChange={setValuationMethod}>
                            <SelectTrigger className="h-9 w-[180px]">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={ORG_DEFAULT}>
                                    Org default{data ? ` · ${VALUATION_LABEL[data.closingStock.method]}` : ""}
                                </SelectItem>
                                {VALUATION_OPTIONS.map((m) => (
                                    <SelectItem key={m} value={m}>{VALUATION_LABEL[m]}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-1">
                        <Label>As at</Label>
                        <TallyDateInput value={asOf} onValueChange={setAsOf} className="w-auto" />
                    </div>
                    <Button onClick={reload}>Refresh</Button>
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
                            <span className="text-xs text-muted-foreground">as at {fmtPeriodDate(data.asOf)}</span>
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
                                        onClick={() => go(`/office/accountancy/reports/profit-loss?from=${data.fyStart}&to=${asOf}&ref=balance-sheet`)}
                                    >
                                        <td className="py-1 pl-2">
                                            <span className="font-semibold text-sm text-foreground hover:underline">Profit &amp; Loss A/c</span>
                                        </td>
                                        <AmountCells value={profitOnLiab} weight="group" side="CREDIT" />
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
                                        <AmountCells value={synthOnLiability} weight="group" side="CREDIT" />
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
                            <span className="text-xs text-muted-foreground">as at {fmtPeriodDate(data.asOf)}</span>
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
                                        onClick={() => go(`/office/accountancy/reports/profit-loss?from=${data.fyStart}&to=${asOf}&ref=balance-sheet`)}
                                    >
                                        <td className="py-1 pl-2">
                                            <span className="font-semibold text-sm text-foreground hover:underline">Profit &amp; Loss A/c (loss)</span>
                                        </td>
                                        <AmountCells value={lossOnAsset} weight="group" side="DEBIT" />
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
                                        <AmountCells value={synthOnAsset} weight="group" side="DEBIT" />
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
                    {canOpen("/office/inventory/stock-summary") && (
                        <button
                            type="button"
                            className="ml-2 underline hover:text-foreground"
                            onClick={() => router.push(`/office/inventory/stock-summary?ref=balance-sheet&asOf=${asOf}`)}
                        >
                            View stock summary →
                        </button>
                    )}
                </p>
            )}

        </div>
        </ScrollArea>
    );
}
