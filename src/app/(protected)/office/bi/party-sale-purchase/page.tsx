"use client";

import { useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { fmt } from "@/utils/constants";
import { toIsoDate } from "@/shared/hooks/useTallyDate";
import { indianFiscalYearStart } from "@/modules/accountancy/lib/period";
import { useBiQuery } from "@/modules/bi/hooks/useBiQuery";
import { BiFilterBar, type BranchOption } from "@/modules/bi/components/BiFilterBar";
import { KpiCard } from "@/modules/bi/components/KpiCard";
import { SimpleBarChart } from "@/modules/bi/components/SimpleBarChart";

interface PartyRow {
    accountId: number; name: string;
    saleBills: number; sale: number; profit: number; marginPct: number;
    purchaseBills: number; purchase: number; netFlow: number;
}
interface Report {
    costMethod: string;
    branches: BranchOption[];
    rows: PartyRow[];
    totals: { saleBills: number; sale: number; profit: number; purchaseBills: number; purchase: number; netFlow: number };
}

export default function PartySalePurchasePage() {
    const [from, setFrom] = useState(toIsoDate(indianFiscalYearStart()));
    const [to, setTo] = useState(toIsoDate(new Date()));
    const [branchId, setBranchId] = useState("");

    const { data, status, reload } = useBiQuery<Report>(
        `/api/bi/party-sale-purchase?from=${from}&to=${to}${branchId ? `&branchId=${branchId}` : ""}`,
    );

    return (
        <ScrollArea className="h-full" type="always">
        <div className="max-w-7xl mx-auto space-y-5 px-6 pt-3 pb-6">
            <div className="flex items-end justify-between gap-3 flex-wrap">
                <div>
                    <h1 className="text-2xl font-bold text-foreground">Party Sale &amp; Purchase</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        Both sides of every party relationship — what we sold to them vs what we bought from them (pre-tax).
                    </p>
                </div>
                <BiFilterBar
                    from={from} to={to} branchId={branchId} branches={data?.branches ?? []}
                    onFrom={setFrom} onTo={setTo} onBranch={setBranchId} onRefresh={reload}
                />
            </div>

            {status}

            {data && (
                <>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                        <KpiCard label="Total Sale (pre-tax)" value={fmt(data.totals.sale)} sub={`${data.totals.saleBills} bills`} />
                        <KpiCard label="Profit on Sales" value={fmt(data.totals.profit)} tone="primary" />
                        <KpiCard label="Total Purchase (pre-tax)" value={fmt(data.totals.purchase)} sub={`${data.totals.purchaseBills} bills`} />
                        <KpiCard label="Net Flow (sale − purchase)" value={fmt(data.totals.netFlow)} tone={data.totals.netFlow < 0 ? "negative" : "default"} />
                    </div>

                    {data.rows.length > 0 && (
                        <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
                            <div className="mb-2 text-sm font-medium text-foreground">Top 10 parties — sale vs purchase</div>
                            <SimpleBarChart
                                data={data.rows.slice(0, 10).map((r) => ({ label: r.name, sale: r.sale, purchase: r.purchase }))}
                                series={[{ key: "sale", name: "Sale" }, { key: "purchase", name: "Purchase" }]}
                            />
                        </div>
                    )}

                    <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
                        <table className="w-full text-sm">
                            <thead className="border-b bg-muted text-xs text-muted-foreground">
                                <tr>
                                    <th className="px-3 py-2 text-left font-medium">Party</th>
                                    <th className="px-3 py-2 text-right font-medium">Sale Bills</th>
                                    <th className="px-3 py-2 text-right font-medium">Sale</th>
                                    <th className="px-3 py-2 text-right font-medium">Profit</th>
                                    <th className="px-3 py-2 text-right font-medium">Margin %</th>
                                    <th className="px-3 py-2 text-right font-medium">Purchase Bills</th>
                                    <th className="px-3 py-2 text-right font-medium">Purchase</th>
                                    <th className="px-3 py-2 text-right font-medium">Net Flow</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.rows.length === 0 ? (
                                    <tr><td colSpan={8} className="py-12 text-center text-muted-foreground text-sm">No sales or purchases in this period.</td></tr>
                                ) : data.rows.map((r) => (
                                    <tr key={r.accountId} className="border-b last:border-0 hover:bg-muted/40">
                                        <td className="px-3 py-2.5 font-medium text-foreground">{r.name}</td>
                                        <td className="px-3 py-2.5 text-right text-muted-foreground">{r.saleBills || "—"}</td>
                                        <td className="px-3 py-2.5 text-right font-mono">{fmt(r.sale)}</td>
                                        <td className={`px-3 py-2.5 text-right font-mono ${r.profit < 0 ? "text-red-600" : ""}`}>{fmt(r.profit)}</td>
                                        <td className={`px-3 py-2.5 text-right font-mono ${r.marginPct < 0 ? "text-red-600" : ""}`}>{r.sale !== 0 ? `${r.marginPct.toFixed(1)}%` : "—"}</td>
                                        <td className="px-3 py-2.5 text-right text-muted-foreground">{r.purchaseBills || "—"}</td>
                                        <td className="px-3 py-2.5 text-right font-mono">{fmt(r.purchase)}</td>
                                        <td className={`px-3 py-2.5 text-right font-mono font-semibold ${r.netFlow < 0 ? "text-red-600" : ""}`}>{fmt(r.netFlow)}</td>
                                    </tr>
                                ))}
                            </tbody>
                            {data.rows.length > 0 && (
                                <tfoot className="border-t bg-muted/30 font-semibold">
                                    <tr>
                                        <td className="px-3 py-2.5">Total</td>
                                        <td className="px-3 py-2.5 text-right">{data.totals.saleBills}</td>
                                        <td className="px-3 py-2.5 text-right font-mono">{fmt(data.totals.sale)}</td>
                                        <td className={`px-3 py-2.5 text-right font-mono ${data.totals.profit < 0 ? "text-red-600" : ""}`}>{fmt(data.totals.profit)}</td>
                                        <td />
                                        <td className="px-3 py-2.5 text-right">{data.totals.purchaseBills}</td>
                                        <td className="px-3 py-2.5 text-right font-mono">{fmt(data.totals.purchase)}</td>
                                        <td className={`px-3 py-2.5 text-right font-mono ${data.totals.netFlow < 0 ? "text-red-600" : ""}`}>{fmt(data.totals.netFlow)}</td>
                                    </tr>
                                </tfoot>
                            )}
                        </table>
                    </div>
                </>
            )}
        </div>
        </ScrollArea>
    );
}
