"use client";

// Shared "Book" page used by Cash Book and Bank Book.
// Walks the Trial Balance group tree to find the named group, lists its
// ledgers with opening / debits / credits / closing for the period, and
// drills into the existing account/[id] register on click.
//
// If the group has exactly one ledger we auto-redirect to it — that matches
// Tally's behaviour where Cash Book opens straight into the Cash A/c register
// when you have a single cash ledger.

import { useEffect, useState, useCallback, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { fmt } from "@/utils/constants";
import { indianFiscalYearStart, formatDateInput } from "@/modules/accountancy/lib/period";
import { accountLedgerUrl } from "@/modules/accountancy/lib/accountLedgerUrl";
import { TallyDateInput } from "@/shared/components/TallyDateInput";
import { groupColor } from "@/shared/lib/format/groupColor";
import { useRealtimeTopics } from "@/shared/hooks/useRealtimeTopics";
import { moduleTableHeadStyle } from "@/shared/lib/format/moduleTheme";

type LedgerNode = {
    id:      number;
    name:    string;
    code:    string | null;
    opening: number;
    debits:  number;
    credits: number;
    closing: number;
};
type GroupNode = {
    id:       number;
    name:     string;
    children: GroupNode[];
    ledgers:  LedgerNode[];
};
type TBData = { tree: GroupNode[] };

function findGroup(nodes: GroupNode[], name: string): GroupNode | null {
    for (const n of nodes) {
        if (n.name === name) return n;
        const found = findGroup(n.children, name);
        if (found) return found;
    }
    return null;
}

// Flatten the matched group + descendants into a single ledger list so a
// "Bank Accounts" group containing sub-groups (Current / Savings) still
// surfaces all bank ledgers in one register list.
function flattenLedgers(node: GroupNode): LedgerNode[] {
    const out: LedgerNode[] = [...node.ledgers];
    for (const child of node.children) out.push(...flattenLedgers(child));
    return out;
}

// "Loans (Liability)" reads oddly as a section header — drop the
// classification suffix for display only.
function sectionLabel(groupName: string): string {
    return groupName.replace(/\s*\(Liability\)\s*$/i, "");
}

// A group that has its own section (e.g. "Credit Card") must not also appear as
// a sub-group block inside its parent's section — otherwise the same ledgers are
// listed and totalled twice. Strip those subtrees from the parent.
function pruneGroups(node: GroupNode, exclude: Set<string>): GroupNode {
    return {
        ...node,
        children: node.children
            .filter((c) => !exclude.has(c.name))
            .map((c) => pruneGroups(c, exclude)),
    };
}

type Section = { name: string; node: GroupNode | null };

// Zeros are noise in a totals column — show a dash instead.
function dash(n: number) {
    return n !== 0 ? fmt(n) : <span className="text-muted-foreground/65">—</span>;
}

function sumSection(ledgers: LedgerNode[]) {
    return ledgers.reduce(
        (s, l) => ({
            opening: s.opening + l.opening,
            debits:  s.debits  + l.debits,
            credits: s.credits + l.credits,
            closing: s.closing + l.closing,
        }),
        { opening: 0, debits: 0, credits: 0, closing: 0 },
    );
}

export function BookPage({
    title, subtitle, groupName, autoSingle = true,
    compact = false, onSelectLedger,
}: {
    title:        string;
    subtitle:     string;
    /** One or more Trial Balance group names — e.g. "Cash-in-Hand", "Bank Accounts",
     *  or ["Loans (Liability)", "Credit Card"] to combine multiple books in one list. */
    groupName:    string | string[];
    autoSingle?:  boolean;       // auto-redirect when group has exactly one ledger
    /** When true, drop the centered `max-w-6xl` wrapper so the report fits a
     *  parent column (e.g. the right pane of AccountLedgerExplorer). */
    compact?:     boolean;
    /** If provided, row clicks call this instead of navigating to
     *  /office/accountancy/account/[id]. Used to keep the click inside a
     *  parent master-detail view. */
    onSelectLedger?: (ledgerId: number) => void;
}) {
    const router = useRouter();
    const fyStart = indianFiscalYearStart();
    const [from, setFrom] = useState(formatDateInput(fyStart));
    const [to, setTo]     = useState(formatDateInput(new Date()));
    const [sections, setSections] = useState<Section[] | null>(null);
    const [loading, setLoading] = useState(false);

    const groupNames = Array.isArray(groupName) ? groupName : [groupName];
    // Multiple groups render as their own labeled sections (e.g. "Loans" vs
    // "Credit Card") instead of merging into one alphabetical list.
    const sectioned = groupNames.length > 1;

    /** `silent` keeps the table on screen while it re-reads — a live update must
     *  not blank a book someone is reading. The Refresh button passes nothing. */
    const load = useCallback((silent = false) => {
        if (!silent) setLoading(true);
        axios.get<TBData>(`/api/accountancy/reports/trial-balance?from=${from}&to=${to}`)
            .then((r) => {
                const secs: Section[] = groupNames.map((name) => {
                    const found = findGroup(r.data.tree, name);
                    // Every other section's group is pruned out of this one's subtree.
                    const others = new Set(groupNames.filter((n) => n !== name));
                    return { name, node: found ? pruneGroups(found, others) : null };
                });
                setSections(secs);
                const all = secs.flatMap((s) => (s.node ? flattenLedgers(s.node) : []));
                if (autoSingle && all.length === 1) {
                    if (onSelectLedger) onSelectLedger(all[0].id);
                    else router.replace(accountLedgerUrl(all[0].id, { from, to }));
                }
            })
            .catch(() => toast.error(`Failed to load ${title}`))
            .finally(() => setLoading(false));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [from, to, groupNames.join("|"), autoSingle, router, title, onSelectLedger]);

    useEffect(() => { load(); }, [load]);
    // Every voucher touching a cash/bank/loan ledger moves these balances, so the
    // book follows the floor instead of waiting for someone to press Refresh.
    useRealtimeTopics(["ledger"], () => { load(true); });

    const ledgers = sections?.flatMap((s) => (s.node ? flattenLedgers(s.node) : [])) ?? null;
    const grandTotal = ledgers && sectioned ? sumSection(ledgers) : null;

    // Recursively render a group's own ledgers plus each child sub-group as its
    // own labeled block with a sub-total — e.g. within the Loans table, split
    // "Secured Loans" and "Unsecured Loans" instead of one flat alphabetical list.
    const renderGroupRows = (node: GroupNode, depth: number, showSubTotals: boolean): ReactNode[] => {
        const rows: ReactNode[] = [];
        const pad = 12 + depth * 14;

        for (const child of node.children) {
            const childLedgers = flattenLedgers(child);
            if (childLedgers.length === 0) continue;
            const childTotals = sumSection(childLedgers);
            const gc = groupColor(child.name);
            rows.push(
                <tr key={`h-${child.id}`} className={`border-t ${gc.bg}`}>
                    <td colSpan={6} style={{ paddingLeft: pad }} className={`py-1.5 pr-3 text-[11px] font-semibold uppercase tracking-wider ${gc.text}`}>
                        <span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${gc.bar} align-middle`} />
                        {child.name}
                    </td>
                </tr>,
            );
            rows.push(...renderGroupRows(child, depth + 1, showSubTotals));
            if (showSubTotals) {
                rows.push(
                    <tr key={`t-${child.id}`} className="bg-muted/15 text-xs">
                        <td style={{ paddingLeft: pad }} className="py-1.5 pr-3 text-muted-foreground">
                            {child.name} total
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono">{dash(childTotals.opening)}</td>
                        <td className="px-3 py-1.5 text-right font-mono">{dash(childTotals.debits)}</td>
                        <td className="px-3 py-1.5 text-right font-mono">{dash(childTotals.credits)}</td>
                        <td className="px-3 py-1.5 text-right font-mono font-semibold">{dash(childTotals.closing)}</td>
                        <td />
                    </tr>,
                );
            }
        }

        const ownLedgers = [...node.ledgers].sort((a, b) => a.name.localeCompare(b.name));
        for (const l of ownLedgers) {
            rows.push(
                <tr
                    key={l.id}
                    className="border-t hover:bg-muted/40 cursor-pointer"
                    onClick={() => {
                        if (onSelectLedger) onSelectLedger(l.id);
                        else router.push(accountLedgerUrl(l.id, { from, to }));
                    }}
                >
                    <td style={{ paddingLeft: pad }} className="py-2.5 pr-3 font-medium text-foreground">
                        {l.name}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono">{dash(l.opening)}</td>
                    <td className="px-3 py-2.5 text-right font-mono">{dash(l.debits)}</td>
                    <td className="px-3 py-2.5 text-right font-mono">{dash(l.credits)}</td>
                    <td className="px-3 py-2.5 text-right font-mono font-semibold">{dash(l.closing)}</td>
                    <td className="px-3 py-2.5 text-muted-foreground"><ChevronRight size={14} /></td>
                </tr>,
            );
        }

        return rows;
    };

    return (
        <div className={compact ? "space-y-4 p-6" : "max-w-6xl mx-auto space-y-5"}>
            <div className="flex items-end justify-between gap-3 flex-wrap">
                <div>
                    <h1 className="text-2xl font-bold text-foreground">{title}</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>
                </div>
                <div className="flex items-end gap-2">
                    <div className="space-y-1">
                        <Label>From</Label>
                        <TallyDateInput value={from} onValueChange={setFrom} className="w-auto" />
                    </div>
                    <div className="space-y-1">
                        <Label>To</Label>
                        <TallyDateInput value={to} onValueChange={setTo} monthMode="end" className="w-auto" />
                    </div>
                    <Button onClick={() => load()}>Refresh</Button>
                </div>
            </div>

            {loading && (
                <div className="flex justify-center py-20">
                    <Loader2 className="animate-spin text-muted-foreground" size={28} />
                </div>
            )}

            {!loading && ledgers && ledgers.length === 0 && (
                <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm py-12 text-center text-muted-foreground text-sm">
                    No ledgers found under <span className="font-mono">{groupNames.join(", ")}</span>.
                </div>
            )}

            {!loading && sections && ledgers && ledgers.length > 0 && (
                // Each group is its own standalone table (own header + own total row),
                // stacked one below the other — not merged into a single table.
                <div className="space-y-8">
                    {sections.map((sec) => {
                        if (!sec.node) return null;
                        const node = sec.node;
                        const secLedgers = flattenLedgers(node);
                        if (secLedgers.length === 0) return null;
                        const secTotals = sumSection(secLedgers);
                        // With a single sub-group and nothing loose at the top, the
                        // sub-total just repeats the table Total — skip it.
                        const blocks = node.children.filter((c) => flattenLedgers(c).length > 0).length;
                        const showSubTotals = blocks > 1 || node.ledgers.length > 0;
                        const gc = groupColor(sec.name);
                        return (
                            <div key={sec.name} className="space-y-2.5">
                                {sectioned && (
                                    <div className="flex items-baseline justify-between gap-3">
                                        <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
                                            <span className={`inline-block h-2.5 w-2.5 rounded-full ${gc.bar}`} />
                                            {sectionLabel(sec.name)}
                                        </h2>
                                        <span className="text-xs text-muted-foreground">
                                            {secLedgers.length} {secLedgers.length === 1 ? "ledger" : "ledgers"}
                                        </span>
                                    </div>
                                )}
                                <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
                                    <table className="w-full text-sm">
                                        <thead className="text-xs text-muted-foreground" style={moduleTableHeadStyle("accountancy")}>
                                            <tr>
                                                <th className="px-3 py-2 text-left font-medium">Ledger</th>
                                                <th className="px-3 py-2 text-right font-medium">Opening</th>
                                                <th className="px-3 py-2 text-right font-medium">Debit</th>
                                                <th className="px-3 py-2 text-right font-medium">Credit</th>
                                                <th className="px-3 py-2 text-right font-medium">Closing</th>
                                                <th className="px-3 py-2 w-8" />
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {renderGroupRows(node, 0, showSubTotals)}
                                        </tbody>
                                        <tfoot className="border-t-2 border-border bg-muted/40 font-semibold">
                                            <tr>
                                                <td className="px-3 py-2.5">Total</td>
                                                <td className="px-3 py-2.5 text-right font-mono">{dash(secTotals.opening)}</td>
                                                <td className="px-3 py-2.5 text-right font-mono">{dash(secTotals.debits)}</td>
                                                <td className="px-3 py-2.5 text-right font-mono">{dash(secTotals.credits)}</td>
                                                <td className="px-3 py-2.5 text-right font-mono">{dash(secTotals.closing)}</td>
                                                <td />
                                            </tr>
                                        </tfoot>
                                    </table>
                                </div>
                            </div>
                        );
                    })}

                    {/* Grand total across every section (Loans + Credit Card + BNPL, …). */}
                    {grandTotal && (
                        <div className="rounded-lg border-2 border-primary/30 bg-primary/5 px-4 py-3 shadow-sm">
                            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
                                <span className="text-sm font-semibold text-primary">Grand Total — {title}</span>
                                <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                                    <span className="text-muted-foreground">Opening <b className="ml-1 font-mono font-semibold text-foreground">{dash(grandTotal.opening)}</b></span>
                                    <span className="text-muted-foreground">Debit <b className="ml-1 font-mono font-semibold text-foreground">{dash(grandTotal.debits)}</b></span>
                                    <span className="text-muted-foreground">Credit <b className="ml-1 font-mono font-semibold text-foreground">{dash(grandTotal.credits)}</b></span>
                                    <span className="text-muted-foreground">Closing <b className="ml-1 font-mono font-semibold text-primary">{dash(grandTotal.closing)}</b></span>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
