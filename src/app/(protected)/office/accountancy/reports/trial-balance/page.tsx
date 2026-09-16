"use client";

import { useEffect, useState, useCallback, Fragment, useMemo } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, Printer, ChevronRight, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { fmt } from "@/utils/constants";
import { indianFiscalYearStart, fmtPeriodDate } from "@/modules/accountancy/lib/period";
import { TallyDateInput } from "@/shared/components/TallyDateInput";
import { toIsoDate } from "@/shared/hooks/useTallyDate";
import { defaultNormalBalanceForGroupType } from "@/modules/accountancy/lib/groupNature";
import { accountLedgerUrl } from "@/modules/accountancy/lib/accountLedgerUrl";
import { useRealtimeTopics } from "@/shared/hooks/useRealtimeTopics";

type GroupTypeStr = "ASSET" | "LIABILITY" | "INCOME" | "EXPENSE";
type Side = "DEBIT" | "CREDIT";

interface LedgerNode {
    id: number; name: string; code: string | null;
    normalBalance: Side | null;
    opening: number; debits: number; credits: number; closing: number;
}
interface GroupNode {
    id: number; name: string; type: GroupTypeStr; sortOrder: number;
    children: GroupNode[]; ledgers: LedgerNode[];
    rolledUpOpening: number; rolledUpDebits: number;
    rolledUpCredits: number; rolledUpClosing: number;
}
interface TBData {
    from: string; to: string;
    tree: GroupNode[];
    totals: { opening: number; debits: number; credits: number; closing: number };
    /** Stock valued at both ends of the period — drives the trading row below. */
    closingStock?: { atFyStart: number; opening: number; computed: number; postedToGl: number };
}

/**
 * Render a signed-by-normal-balance amount with a Dr/Cr suffix (Tally-style).
 * - value > 0 → on the normal side
 * - value < 0 → on the opposite side
 * - value ≈ 0 → "—"
 */
function SidedCell({ value, normalSide, bold, italic, underline }: {
    value: number; normalSide: Side; bold?: boolean; italic?: boolean; underline?: boolean;
}) {
    // Ledger rows render italic ⇒ drop one point so they read as detail.
    const sizeClass = italic ? "text-[13px]" : "text-sm";
    if (Math.abs(value) < 0.005) {
        return <td className={`px-3 py-1 text-right font-mono ${sizeClass} text-muted-foreground/65`}>—</td>;
    }
    const onNormal = value > 0;
    const side = onNormal ? normalSide : (normalSide === "DEBIT" ? "CREDIT" : "DEBIT");
    const label = side === "DEBIT" ? "Dr" : "Cr";
    return (
        <td className={`px-3 py-1 text-right font-mono ${sizeClass} ${bold ? "font-semibold" : ""} ${italic ? "italic" : ""}`}>
            <span className={underline ? "underline decoration-foreground/40 underline-offset-4" : ""}>
                {fmt(Math.abs(value))}
            </span>{" "}
            <span className="text-muted-foreground not-italic font-normal">{label}</span>
        </td>
    );
}

/** Raw (unsigned) amount for the Transactions Dr / Transactions Cr columns. */
function PlainCell({ value, bold, italic, underline }: { value: number; bold?: boolean; italic?: boolean; underline?: boolean }) {
    const sizeClass = italic ? "text-[13px]" : "text-sm";
    if (Math.abs(value) < 0.005) {
        return <td className={`px-3 py-1 text-right font-mono ${sizeClass} text-muted-foreground/65`}>—</td>;
    }
    return (
        <td className={`px-3 py-1 text-right font-mono ${sizeClass} ${bold ? "font-semibold" : ""} ${italic ? "italic" : ""}`}>
            <span className={underline ? "underline decoration-foreground/40 underline-offset-4" : ""}>
                {fmt(value)}
            </span>
        </td>
    );
}

/** Remove groups + ledgers that have no activity in any column. */
function pruneEmpty(nodes: GroupNode[]): GroupNode[] {
    const out: GroupNode[] = [];
    for (const n of nodes) {
        const keptKids = pruneEmpty(n.children);
        const keptLedgers = n.ledgers.filter((l) =>
            Math.abs(l.opening) >= 0.005 ||
            Math.abs(l.debits) >= 0.005 ||
            Math.abs(l.credits) >= 0.005 ||
            Math.abs(l.closing) >= 0.005,
        );
        const groupHasActivity =
            Math.abs(n.rolledUpOpening) >= 0.005 ||
            Math.abs(n.rolledUpDebits) >= 0.005 ||
            Math.abs(n.rolledUpCredits) >= 0.005 ||
            Math.abs(n.rolledUpClosing) >= 0.005;
        if (keptKids.length === 0 && keptLedgers.length === 0 && !groupHasActivity) continue;
        out.push({ ...n, children: keptKids, ledgers: keptLedgers });
    }
    return out;
}

function GroupRow({ node, depth, expanded, toggle, onLedger, onGroup }: {
    node: GroupNode; depth: number;
    expanded: Set<number>; toggle: (id: number) => void;
    onLedger: (id: number) => void; onGroup: (id: number) => void;
}) {
    const isOpen = expanded.has(node.id);
    const hasContent = node.children.length > 0 || node.ledgers.length > 0;
    const groupNormalSide = defaultNormalBalanceForGroupType(node.type);
    return (
        <Fragment>
            <tr className="hover:bg-muted/40 cursor-pointer" onClick={() => onGroup(node.id)}>
                <td className="py-1.5" style={{ paddingLeft: 8 + depth * 16 }}>
                    <span className="flex items-center gap-1">
                        {hasContent && (
                            <span
                                onClick={(e) => { e.stopPropagation(); toggle(node.id); }}
                                className="text-muted-foreground"
                            >
                                {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            </span>
                        )}
                        <span className={`hover:underline ${depth === 0 ? "font-semibold" : "font-medium"}`}>{node.name}</span>
                    </span>
                </td>
                <SidedCell value={node.rolledUpOpening} normalSide={groupNormalSide} bold={depth === 0} underline={depth === 0} />
                <PlainCell value={node.rolledUpDebits} bold={depth === 0} underline={depth === 0} />
                <PlainCell value={node.rolledUpCredits} bold={depth === 0} underline={depth === 0} />
                <SidedCell value={node.rolledUpClosing} normalSide={groupNormalSide} bold={depth === 0} underline={depth === 0} />
            </tr>
            {isOpen && (
                <>
                    {node.children.map((c) => (
                        <GroupRow key={`g-${c.id}`} node={c} depth={depth + 1}
                                  expanded={expanded} toggle={toggle}
                                  onLedger={onLedger} onGroup={onGroup} />
                    ))}
                    {node.ledgers.map((l) => {
                        // Balances arrive signed against the GROUP's nature (groupTree
                        // re-signs contra ledgers), so the group's side is what reads
                        // them correctly. A contra comes through negative and SidedCell
                        // flips the label itself — Sales Returns still prints "Dr".
                        const ledgerSide: Side = groupNormalSide;
                        return (
                            <tr
                                key={`l-${l.id}`}
                                className="hover:bg-primary/5 cursor-pointer"
                                onClick={() => onLedger(l.id)}
                            >
                                <td className="py-1 text-[13px] text-muted-foreground italic" style={{ paddingLeft: 24 + depth * 16 }}>
                                    <span className="hover:underline hover:text-primary">{l.name}</span>
                                </td>
                                <SidedCell value={l.opening} normalSide={ledgerSide} italic />
                                <PlainCell value={l.debits} italic />
                                <PlainCell value={l.credits} italic />
                                <SidedCell value={l.closing} normalSide={ledgerSide} italic />
                            </tr>
                        );
                    })}
                </>
            )}
        </Fragment>
    );
}

/**
 * Compute Dr / Cr totals on each column from the source tree.
 *
 * Convention: aggregates are signed-by-normal-balance — Asset's `opening` is
 * positive when it sits on the Dr side. By walking the tree we split each
 * column into Dr-side vs Cr-side totals.
 *
 * `openingDiff = openDr − openCr` is the one-sided slack left by master-page
 * opening balances (since they have no balanced JE counterpart). The Trial
 * Balance reconciles it with a synthetic "Difference in opening balances" row.
 *
 * Each balance column carries its OWN slack. These were once a single number,
 * on the reasoning that every JE balances so the opening slack must carry
 * forward into Closing untouched. Closing Stock breaks that: it is a valuation,
 * not a journal entry, so the two columns can legitimately differ. The caller
 * closes that gap with the trading row (Opening less Closing Stock) and then
 * re-derives `closingDiff`, so anything still left over is a genuine problem
 * with the books rather than an artefact of how stock is carried.
 */
function deriveSummary(tree: GroupNode[]) {
    let openDr = 0, openCr = 0, closeDr = 0, closeCr = 0, debits = 0, credits = 0;
    const visit = (n: GroupNode): void => {
        const groupSide = defaultNormalBalanceForGroupType(n.type);
        for (const l of n.ledgers) {
            // Side by the GROUP, because that is what the balances are signed
            // against now. A contra ledger arrives negative, so it SUBTRACTS
            // from its own group's side instead of adding to the other one —
            // same Dr−Cr difference either way, so the balance check is
            // unchanged, but the group subtotal above it is finally right.
            const ledgerOnDr = groupSide === "DEBIT";
            if (ledgerOnDr) { openDr += l.opening; closeDr += l.closing; }
            else            { openCr += l.opening; closeCr += l.closing; }
            debits  += l.debits;
            credits += l.credits;
        }
        n.children.forEach(visit);
    };
    tree.forEach(visit);
    return {
        openDr, openCr, closeDr, closeCr, debits, credits,
        openingDiff: openDr  - openCr,
        closingDiff: closeDr - closeCr,
    };
}

export default function TrialBalancePage() {
    const router = useRouter();
    const fyStart = indianFiscalYearStart();
    const [from, setFrom] = useState(toIsoDate(fyStart));
    const [to, setTo]     = useState(toIsoDate(new Date()));
    const [data, setData] = useState<TBData | null>(null);
    const [loading, setLoading] = useState(false);
    const [expanded, setExpanded] = useState<Set<number>>(new Set());
    const [showEmpty, setShowEmpty] = useState(false);

    const load = useCallback((silent = false) => {
        // A realtime refresh must not blank a report the user is reading.
        if (!silent) setLoading(true);
        axios.get<TBData>(`/api/accountancy/reports/trial-balance?from=${from}&to=${to}`)
            .then((r) => {
                setData(r.data);
                setExpanded((prev) => {
                    if (prev.size > 0) return prev;
                    return new Set(r.data.tree.map((g) => g.id));
                });
            })
            .catch(() => toast.error("Failed to load trial balance"))
            .finally(() => setLoading(false));
    }, [from, to]);

    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(load, [load]);

    // Every write that moves the books announces "ledger", so this covers a
    // voucher posted at another counter as well as one posted here.
    useRealtimeTopics(["ledger"], () => load(true));

    const viewTree = useMemo(() => {
        if (!data) return [];
        return showEmpty ? data.tree : pruneEmpty(data.tree);
    }, [data, showEmpty]);

    // Trading-account stock movement. Stock is a valuation, not a journal entry,
    // so when it moves during the period no ledger records the cost — the Trial
    // Balance would be short by exactly that much. Tally puts the pair in the
    // Trading account (Opening Stock Dr, Closing Stock Cr); we carry the same
    // thing netted into one row, which is the figure the P&L already computes.
    // Positive ⇒ stock fell, a cost (Dr). Negative ⇒ stock rose (Cr).
    //
    // Both columns get their own figure, measured from the financial-year start,
    // because that is where the income and expense ledgers accumulate from. For
    // the usual "1 April to date" period the Opening one is nil; for a mid-year
    // period it is the stock already consumed before the period opened.
    const cs = data?.closingStock;
    const stockAdjOpen  = cs ? cs.atFyStart - cs.opening  : 0;
    const stockAdjClose = cs ? cs.atFyStart - cs.computed : 0;

    const summary = useMemo(() => {
        if (!data) return null;
        const s = deriveSummary(data.tree);
        // Land each on whichever side it belongs to, so the printed column
        // totals add up to the rows the reader can actually see.
        const openDr  = s.openDr  + (stockAdjOpen  > 0 ?  stockAdjOpen  : 0);
        const openCr  = s.openCr  + (stockAdjOpen  < 0 ? -stockAdjOpen  : 0);
        const closeDr = s.closeDr + (stockAdjClose > 0 ?  stockAdjClose : 0);
        const closeCr = s.closeCr + (stockAdjClose < 0 ? -stockAdjClose : 0);
        return {
            ...s, openDr, openCr, closeDr, closeCr,
            openingDiff: openDr  - openCr,
            closingDiff: closeDr - closeCr,
        };
    }, [data, stockAdjOpen, stockAdjClose]);

    const toggle = (id: number) => setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(id)) { next.delete(id); } else { next.add(id); }
        return next;
    });
    const goLedger = (id: number) => {
        // id -1 is the synthetic "Closing Stock (live)" row injected by the API
        // — no Account row sits behind it, so send the reader to the stock
        // summary that produced the figure (same as the Balance Sheet does).
        if (id === -1) {
            router.push(`/office/inventory/stock-summary?ref=trial-balance&asOf=${to}`);
            return;
        }
        if (id <= 0) return;
        router.push(accountLedgerUrl(id, { from, to }));
    };
    const goGroup  = (id: number) => router.push(`/office/accountancy/masters/groups/${id}?from=${from}&to=${to}`);

    // Grand-total columns — balanced after folding the opening-difference plug
    // into both Opening and Closing on the deficient side.
    const totalsDisplay = summary ? (() => {
        const op = summary.openingDiff;   // > 0 ⇒ Dr excess (plug goes on Cr); < 0 ⇒ Cr excess
        const cl = summary.closingDiff;
        return {
            openDr:  summary.openDr  + (op < 0 ? -op : 0),
            openCr:  summary.openCr  + (op > 0 ?  op : 0),
            closeDr: summary.closeDr + (cl < 0 ? -cl : 0),
            closeCr: summary.closeCr + (cl > 0 ?  cl : 0),
            debits:  summary.debits,
            credits: summary.credits,
        };
    })() : null;

    return (
        <ScrollArea className="h-full" type="always">
        <div className="max-w-7xl mx-auto space-y-5 px-6 pt-3 pb-6">
            <div className="flex items-end justify-between gap-3 flex-wrap print:hidden">
                <div>
                    <h1 className="text-2xl font-bold text-foreground">Trial Balance</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        {data ? `${fmtPeriodDate(data.from)} to ${fmtPeriodDate(data.to)}` : "…"}
                    </p>
                </div>
                <div className="flex items-end gap-2">
                    <div className="space-y-1"><Label>From</Label><TallyDateInput value={from} onValueChange={setFrom} className="w-auto" /></div>
                    <div className="space-y-1"><Label>To</Label><TallyDateInput value={to} onValueChange={setTo} monthMode="end" className="w-auto" /></div>
                    <Button variant="outline" onClick={() => setShowEmpty((v) => !v)} title="Toggle visibility of groups / ledgers with no activity">
                        {showEmpty ? "Hide empty" : "Show all"}
                    </Button>
                    <Button onClick={() => load()}>Refresh</Button>
                    <Button variant="outline" onClick={() => window.print()}><Printer size={14} /></Button>
                </div>
            </div>

            {loading && <div className="flex justify-center py-20"><Loader2 className="animate-spin text-muted-foreground" size={28} /></div>}

            {!loading && data && summary && totalsDisplay && (
                <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
                    <table className="w-full text-sm">
                        <thead className="border-b bg-muted text-xs text-muted-foreground">
                            <tr>
                                <th className="px-3 py-2 text-left font-medium">Particulars</th>
                                <th className="px-3 py-2 text-right font-medium">Opening Balance</th>
                                <th className="px-3 py-2 text-right font-medium">Transactions Dr</th>
                                <th className="px-3 py-2 text-right font-medium">Transactions Cr</th>
                                <th className="px-3 py-2 text-right font-medium">Closing Balance</th>
                            </tr>
                        </thead>
                        <tbody>
                            {viewTree.map((g) => (
                                <GroupRow key={g.id} node={g} depth={0}
                                          expanded={expanded} toggle={toggle}
                                          onLedger={goLedger} onGroup={goGroup} />
                            ))}
                            {viewTree.length === 0 && (
                                <tr>
                                    <td colSpan={5} className="px-3 py-6 text-center text-sm text-muted-foreground">
                                        No activity in the selected period.
                                    </td>
                                </tr>
                            )}

                            {/* Difference in opening balances — synthetic plug that reconciles
                                the one-sided master-page openings so the Trial Balance balances
                                Dr against Cr in both the Opening and Closing columns (mirrors
                                Tally's behaviour). Every JE balances, so the same plug carries
                                forward into Closing unchanged. */}
                            {/* Trading-account stock movement — the entry that keeps the
                                Closing column balanced. Stock never reaches a ledger, so
                                without this its movement falls straight into the plug
                                below and the Trial Balance reads as out of balance every
                                time stock moves. Sits above the plug because it is a real
                                accounting figure, not a leftover. */}
                            {(Math.abs(stockAdjOpen) >= 0.005 || Math.abs(stockAdjClose) >= 0.005) && (
                                <tr
                                    className="border-t"
                                    title="Opening Stock less Closing Stock — the same trading-account figure the Profit & Loss shows, measured from the financial-year start. Stock is valued, never journalised, so no ledger carries it."
                                >
                                    <td className="px-3 py-1.5 italic text-muted-foreground">Opening less Closing Stock</td>
                                    <SidedCell value={stockAdjOpen} normalSide="DEBIT" italic />
                                    <PlainCell value={0} italic />
                                    <PlainCell value={0} italic />
                                    <SidedCell value={stockAdjClose} normalSide="DEBIT" italic />
                                </tr>
                            )}

                            {(Math.abs(summary.openingDiff) >= 0.005 || Math.abs(summary.closingDiff) >= 0.005) && (
                                <tr
                                    className="text-amber-700 dark:text-amber-400 border-t"
                                    title="Master-page opening balances are one-sided — this is the plug that balances Σ Dr against Σ Cr in each balance column."
                                >
                                    <td className="px-3 py-1.5 italic">Difference in opening balances</td>
                                    {/* If Dr > Cr (diff > 0), the plug sits on the Cr side, and vice-versa.
                                        Each column is plugged from its own slack — see deriveSummary. */}
                                    <SidedCell value={-summary.openingDiff} normalSide="DEBIT" italic />
                                    <PlainCell value={0} italic />
                                    <PlainCell value={0} italic />
                                    <SidedCell value={-summary.closingDiff} normalSide="DEBIT" italic />
                                </tr>
                            )}
                        </tbody>
                        <tfoot className="border-t-2 bg-muted/30 font-bold">
                            <tr>
                                <td className="px-3 py-2">Grand Total</td>
                                <td className="px-3 py-2 text-right font-mono text-sm">
                                    {fmt(Math.max(totalsDisplay.openDr, totalsDisplay.openCr))}
                                </td>
                                <td className="px-3 py-2 text-right font-mono text-sm">{fmt(totalsDisplay.debits)}</td>
                                <td className="px-3 py-2 text-right font-mono text-sm">{fmt(totalsDisplay.credits)}</td>
                                <td className="px-3 py-2 text-right font-mono text-sm">
                                    {fmt(Math.max(totalsDisplay.closeDr, totalsDisplay.closeCr))}
                                </td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            )}
        </div>
        </ScrollArea>
    );
}
