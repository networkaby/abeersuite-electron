"use client";

import { useEffect, useState, useCallback, Fragment } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, Printer, ChevronRight, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fmt } from "@/utils/constants";
import { indianFiscalYearStart, formatDateInput } from "@/modules/tally/lib/period";

type GroupTypeStr = "ASSET" | "LIABILITY" | "INCOME" | "EXPENSE";
interface LedgerNode {
    id: number; name: string; code: string | null;
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
}

function fmtIndianDate(iso: string): string {
    return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function NumCell({ value }: { value: number }) {
    if (Math.abs(value) < 0.005) return <td className="px-3 py-1 text-right font-mono text-sm text-muted-foreground/40">—</td>;
    return <td className={`px-3 py-1 text-right font-mono text-sm ${value < 0 ? "text-destructive" : ""}`}>{fmt(value)}</td>;
}

function GroupRow({ node, depth, expanded, toggle, onLedger, onGroup }: {
    node: GroupNode; depth: number;
    expanded: Set<number>; toggle: (id: number) => void;
    onLedger: (id: number) => void; onGroup: (id: number) => void;
}) {
    const isOpen = expanded.has(node.id);
    const hasContent = node.children.length > 0 || node.ledgers.length > 0;
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
                <NumCell value={node.rolledUpOpening} />
                <NumCell value={node.rolledUpDebits} />
                <NumCell value={node.rolledUpCredits} />
                <NumCell value={node.rolledUpClosing} />
            </tr>
            {isOpen && (
                <>
                    {node.children.map((c) => (
                        <GroupRow key={`g-${c.id}`} node={c} depth={depth + 1}
                                  expanded={expanded} toggle={toggle}
                                  onLedger={onLedger} onGroup={onGroup} />
                    ))}
                    {node.ledgers.map((l) => (
                        <tr
                            key={`l-${l.id}`}
                            className="hover:bg-primary/5 cursor-pointer"
                            onClick={() => onLedger(l.id)}
                        >
                            <td className="py-1 text-muted-foreground" style={{ paddingLeft: 24 + depth * 16 }}>
                                <span className="hover:underline hover:text-primary">{l.name}</span>
                            </td>
                            <NumCell value={l.opening} />
                            <NumCell value={l.debits} />
                            <NumCell value={l.credits} />
                            <NumCell value={l.closing} />
                        </tr>
                    ))}
                </>
            )}
        </Fragment>
    );
}

export default function TrialBalancePage() {
    const router = useRouter();
    const fyStart = indianFiscalYearStart();
    const [from, setFrom] = useState(formatDateInput(fyStart));
    const [to, setTo]     = useState(formatDateInput(new Date()));
    const [data, setData] = useState<TBData | null>(null);
    const [loading, setLoading] = useState(false);
    const [expanded, setExpanded] = useState<Set<number>>(new Set());

    const load = useCallback(() => {
        setLoading(true);
        axios.get<TBData>(`/api/finance/reports/trial-balance?from=${from}&to=${to}`)
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

    useEffect(() => { load(); }, [load]);

    const toggle = (id: number) => setExpanded((prev) => {
        const next = new Set(prev);
        next.has(id) ? next.delete(id) : next.add(id);
        return next;
    });
    const goLedger = (id: number) => router.push(`/office/finance/account/${id}?from=${from}&to=${to}`);
    const goGroup  = (id: number) => router.push(`/office/finance/groups/${id}?from=${from}&to=${to}`);

    return (
        <div className="max-w-7xl mx-auto space-y-5">
            <div className="flex items-end justify-between gap-3 flex-wrap print:hidden">
                <div>
                    <h1 className="text-2xl font-bold text-foreground">Trial Balance</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        {data ? `${fmtIndianDate(data.from)} to ${fmtIndianDate(data.to)}` : "…"}
                    </p>
                </div>
                <div className="flex items-end gap-2">
                    <div className="space-y-1"><Label>From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-auto" /></div>
                    <div className="space-y-1"><Label>To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-auto" /></div>
                    <Button onClick={load}>Run</Button>
                    <Button variant="outline" onClick={() => window.print()}><Printer size={14} /></Button>
                </div>
            </div>

            {loading && <div className="flex justify-center py-20"><Loader2 className="animate-spin text-muted-foreground" size={28} /></div>}

            {!loading && data && (
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
                            {data.tree.map((g) => (
                                <GroupRow key={g.id} node={g} depth={0}
                                          expanded={expanded} toggle={toggle}
                                          onLedger={goLedger} onGroup={goGroup} />
                            ))}
                        </tbody>
                        <tfoot className="border-t-2 bg-muted/30 font-bold">
                            <tr>
                                <td className="px-3 py-2">Grand Total</td>
                                <NumCell value={data.totals.opening} />
                                <NumCell value={data.totals.debits} />
                                <NumCell value={data.totals.credits} />
                                <NumCell value={data.totals.closing} />
                            </tr>
                        </tfoot>
                    </table>
                </div>
            )}

            {!loading && data && Math.abs(data.totals.debits - data.totals.credits) > 0.005 && (
                <p className="text-center text-sm text-amber-700 dark:text-amber-400 print:hidden">
                    ⚠ Trial Balance is unbalanced — Dr/Cr difference: {fmt(Math.abs(data.totals.debits - data.totals.credits))}
                </p>
            )}
        </div>
    );
}
