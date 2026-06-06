"use client";

// Shared "Book" page used by Cash Book and Bank Book.
// Walks the Trial Balance group tree to find the named group, lists its
// ledgers with opening / debits / credits / closing for the period, and
// drills into the existing account/[id] register on click.
//
// If the group has exactly one ledger we auto-redirect to it — that matches
// Tally's behaviour where Cash Book opens straight into the Cash A/c register
// when you have a single cash ledger.

import { useEffect, useState, useCallback } from "react";
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

export function BookPage({
    title, subtitle, groupName, autoSingle = true,
    compact = false, onSelectLedger,
}: {
    title:        string;
    subtitle:     string;
    groupName:    string;        // e.g. "Cash-in-Hand", "Bank Accounts"
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
    const [ledgers, setLedgers] = useState<LedgerNode[] | null>(null);
    const [loading, setLoading] = useState(false);

    const load = useCallback(() => {
        setLoading(true);
        axios.get<TBData>(`/api/accountancy/reports/trial-balance?from=${from}&to=${to}`)
            .then((r) => {
                const group = findGroup(r.data.tree, groupName);
                const list = group ? flattenLedgers(group) : [];
                list.sort((a, b) => a.name.localeCompare(b.name));
                setLedgers(list);
                if (autoSingle && list.length === 1) {
                    if (onSelectLedger) onSelectLedger(list[0].id);
                    else router.replace(accountLedgerUrl(list[0].id, { from, to }));
                }
            })
            .catch(() => toast.error(`Failed to load ${title}`))
            .finally(() => setLoading(false));
    }, [from, to, groupName, autoSingle, router, title, onSelectLedger]);

    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(load, [load]);

    const totals = ledgers
        ? ledgers.reduce(
            (s, l) => ({
                opening: s.opening + l.opening,
                debits:  s.debits  + l.debits,
                credits: s.credits + l.credits,
                closing: s.closing + l.closing,
            }),
            { opening: 0, debits: 0, credits: 0, closing: 0 },
        )
        : null;

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
                        <TallyDateInput value={to} onValueChange={setTo} className="w-auto" />
                    </div>
                    <Button onClick={load}>Refresh</Button>
                </div>
            </div>

            {loading && (
                <div className="flex justify-center py-20">
                    <Loader2 className="animate-spin text-muted-foreground" size={28} />
                </div>
            )}

            {!loading && ledgers && (
                <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
                    <table className="w-full text-sm">
                        <thead className="border-b bg-muted text-xs text-muted-foreground">
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
                            {ledgers.length === 0 ? (
                                <tr>
                                    <td colSpan={6} className="py-12 text-center text-muted-foreground text-sm">
                                        No ledgers found under <span className="font-mono">{groupName}</span>.
                                    </td>
                                </tr>
                            ) : ledgers.map((l) => (
                                <tr
                                    key={l.id}
                                    className="border-b last:border-0 hover:bg-muted/40 cursor-pointer"
                                    onClick={() => {
                                        if (onSelectLedger) onSelectLedger(l.id);
                                        else router.push(accountLedgerUrl(l.id, { from, to }));
                                    }}
                                >
                                    <td className="px-3 py-2.5 font-medium text-foreground">
                                        {l.name}
                                    </td>
                                    <td className="px-3 py-2.5 text-right font-mono">
                                        {l.opening !== 0 ? fmt(l.opening) : <span className="text-muted-foreground/40">—</span>}
                                    </td>
                                    <td className="px-3 py-2.5 text-right font-mono">
                                        {l.debits > 0 ? fmt(l.debits) : <span className="text-muted-foreground/40">—</span>}
                                    </td>
                                    <td className="px-3 py-2.5 text-right font-mono">
                                        {l.credits > 0 ? fmt(l.credits) : <span className="text-muted-foreground/40">—</span>}
                                    </td>
                                    <td className="px-3 py-2.5 text-right font-mono font-semibold">{fmt(l.closing)}</td>
                                    <td className="px-3 py-2.5 text-muted-foreground"><ChevronRight size={14} /></td>
                                </tr>
                            ))}
                        </tbody>
                        {ledgers.length > 0 && totals && (
                            <tfoot className="border-t bg-muted/30 font-semibold">
                                <tr>
                                    <td className="px-3 py-2.5">Total</td>
                                    <td className="px-3 py-2.5 text-right font-mono">{fmt(totals.opening)}</td>
                                    <td className="px-3 py-2.5 text-right font-mono">{fmt(totals.debits)}</td>
                                    <td className="px-3 py-2.5 text-right font-mono">{fmt(totals.credits)}</td>
                                    <td className="px-3 py-2.5 text-right font-mono">{fmt(totals.closing)}</td>
                                    <td />
                                </tr>
                            </tfoot>
                        )}
                    </table>
                </div>
            )}
        </div>
    );
}
