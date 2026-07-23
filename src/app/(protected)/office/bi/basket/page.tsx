"use client";

import { useState } from "react";
import { Loader2, ArrowRight } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toIsoDate } from "@/shared/hooks/useTallyDate";
import { indianFiscalYearStart } from "@/modules/accountancy/lib/period";
import { useBiQuery } from "@/modules/bi/hooks/useBiQuery";
import { BiFilterBar, type BranchOption } from "@/modules/bi/components/BiFilterBar";

interface PairRow {
    productAId: number; productBId: number; nameA: string; nameB: string;
    bills: number; supportPct: number; confidenceAtoB: number; confidenceBtoA: number;
}
interface Report {
    branches: BranchOption[];
    totalBills: number;
    minPairBills: number;
    rows: PairRow[];
}

export default function BasketPage() {
    const [from, setFrom] = useState(toIsoDate(indianFiscalYearStart()));
    const [to, setTo] = useState(toIsoDate(new Date()));
    const [branchId, setBranchId] = useState("");

    const { data, loading, reload } = useBiQuery<Report>(
        `/api/bi/basket?from=${from}&to=${to}${branchId ? `&branchId=${branchId}` : ""}`,
    );

    return (
        <ScrollArea className="h-full" type="always">
        <div className="max-w-7xl mx-auto space-y-5 px-6 pt-3 pb-6">
            <div className="flex items-end justify-between gap-3 flex-wrap">
                <div>
                    <h1 className="text-2xl font-bold text-foreground">Basket Analysis</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        Products bought together on the same bill — cross-sell prompts, combo offers, shelf placement.
                        {data ? ` ${data.totalBills} bills analysed; pairs seen at least ${data.minPairBills}× shown.` : ""}
                    </p>
                </div>
                <BiFilterBar
                    from={from} to={to} branchId={branchId} branches={data?.branches ?? []}
                    onFrom={setFrom} onTo={setTo} onBranch={setBranchId} onRefresh={reload}
                />
            </div>

            {loading && (
                <div className="flex justify-center py-20">
                    <Loader2 className="animate-spin text-muted-foreground" size={28} />
                </div>
            )}

            {!loading && data && (
                <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
                    <table className="w-full text-sm">
                        <thead className="border-b bg-muted text-xs text-muted-foreground">
                            <tr>
                                <th className="px-3 py-2 text-left font-medium">Pair</th>
                                <th className="px-3 py-2 text-right font-medium">Together (bills)</th>
                                <th className="px-3 py-2 text-right font-medium">Support %</th>
                                <th className="px-3 py-2 text-right font-medium">A → B</th>
                                <th className="px-3 py-2 text-right font-medium">B → A</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.rows.length === 0 ? (
                                <tr><td colSpan={5} className="py-12 text-center text-muted-foreground text-sm">No repeated pairs in this period — need bills with 2+ different items.</td></tr>
                            ) : data.rows.map((r) => (
                                <tr key={`${r.productAId}-${r.productBId}`} className="border-b last:border-0 hover:bg-muted/40">
                                    <td className="px-3 py-2.5">
                                        <span className="font-medium text-foreground">{r.nameA}</span>
                                        <ArrowRight size={12} className="mx-1.5 inline text-muted-foreground" />
                                        <span className="font-medium text-foreground">{r.nameB}</span>
                                    </td>
                                    <td className="px-3 py-2.5 text-right font-mono font-semibold">{r.bills}</td>
                                    <td className="px-3 py-2.5 text-right font-mono">{r.supportPct.toFixed(1)}%</td>
                                    <td className="px-3 py-2.5 text-right font-mono" title={`Of bills with "${r.nameA}", ${r.confidenceAtoB.toFixed(0)}% also had "${r.nameB}"`}>{r.confidenceAtoB.toFixed(0)}%</td>
                                    <td className="px-3 py-2.5 text-right font-mono" title={`Of bills with "${r.nameB}", ${r.confidenceBtoA.toFixed(0)}% also had "${r.nameA}"`}>{r.confidenceBtoA.toFixed(0)}%</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
        </ScrollArea>
    );
}
