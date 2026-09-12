"use client";

import { useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { fmt } from "@/utils/constants";
import { toIsoDate } from "@/shared/hooks/useTallyDate";
import { indianFiscalYearStart } from "@/modules/accountancy/lib/period";
import { useBiQuery } from "@/modules/bi/hooks/useBiQuery";
import { fmtQty, fmtDate } from "@/modules/bi/lib/format";
import { BiFilterBar, type BranchOption } from "@/modules/bi/components/BiFilterBar";
import { TopBarChart } from "@/modules/bi/components/TopBarChart";

interface SupplierRow {
    accountId: number | null; name: string; bills: number; qty: number;
    value: number; sharePct: number; lastPurchase: string | null;
    soldValue: number; profit: number; marginPct: number;
}
interface Report {
    branches: BranchOption[];
    rows: SupplierRow[];
    totals: { value: number; bills: number; soldValue: number; profit: number; marginPct: number };
}

export default function SupplierPurchasesPage() {
    const [from, setFrom] = useState(toIsoDate(indianFiscalYearStart()));
    const [to, setTo] = useState(toIsoDate(new Date()));
    const [branchId, setBranchId] = useState("");

    const { data, status, reload } = useBiQuery<Report>(
        `/api/bi/supplier-purchases?from=${from}&to=${to}${branchId ? `&branchId=${branchId}` : ""}`,
    );

    const topShare = data && data.rows.length > 0 ? data.rows[0].sharePct : 0;

    return (
        <ScrollArea className="h-full" type="always">
        <div className="max-w-7xl mx-auto space-y-5 px-6 pt-3 pb-6">
            <div className="flex items-end justify-between gap-3 flex-wrap">
                <div>
                    <h1 className="text-2xl font-bold text-foreground">Supplier Purchases</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        Purchase volume per supplier (pre-tax, returns netted) with attributed profitability — each item&apos;s sale profit split across its suppliers by qty share
                        {topShare > 40 ? `. Top supplier holds ${topShare.toFixed(0)}% of your supply (concentration risk).` : "."}
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
                    {data.rows.some((r) => r.value !== 0) && (
                        <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
                            <div className="mb-2 text-sm font-medium text-foreground">Top 10 suppliers by purchase value</div>
                            <TopBarChart data={data.rows.filter((r) => r.value !== 0).slice(0, 10).map((r) => ({ name: r.name, value: r.value }))} dataKey="value" name="Purchases" height={Math.max(120, Math.min(data.rows.length, 10) * 30)} />
                        </div>
                    )}

                    <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
                        <table className="w-full text-sm">
                            <thead className="border-b bg-muted text-xs text-muted-foreground">
                                <tr>
                                    <th className="px-3 py-2 text-left font-medium">Supplier</th>
                                    <th className="px-3 py-2 text-right font-medium">Bills</th>
                                    <th className="px-3 py-2 text-right font-medium">Qty</th>
                                    <th className="px-3 py-2 text-right font-medium">Purchase Value</th>
                                    <th className="px-3 py-2 text-right font-medium">Share %</th>
                                    <th className="px-3 py-2 text-right font-medium">Sold (attr)</th>
                                    <th className="px-3 py-2 text-right font-medium">Profit (attr)</th>
                                    <th className="px-3 py-2 text-right font-medium">Margin %</th>
                                    <th className="px-3 py-2 text-right font-medium">Last Purchase</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.rows.length === 0 ? (
                                    <tr><td colSpan={9} className="py-12 text-center text-muted-foreground text-sm">No purchases in this period.</td></tr>
                                ) : data.rows.map((r) => (
                                    <tr key={r.name} className="border-b last:border-0 hover:bg-muted/40">
                                        <td className="px-3 py-2.5 font-medium text-foreground">{r.name}</td>
                                        <td className="px-3 py-2.5 text-right text-muted-foreground">{r.bills || "—"}</td>
                                        <td className="px-3 py-2.5 text-right font-mono">{r.qty !== 0 ? fmtQty(r.qty) : "—"}</td>
                                        <td className="px-3 py-2.5 text-right font-mono font-semibold">{r.value !== 0 ? fmt(r.value) : "—"}</td>
                                        <td className="px-3 py-2.5 text-right font-mono">{r.sharePct !== 0 ? `${r.sharePct.toFixed(1)}%` : "—"}</td>
                                        <td className="px-3 py-2.5 text-right font-mono">{fmt(r.soldValue)}</td>
                                        <td className={`px-3 py-2.5 text-right font-mono font-semibold ${r.profit < 0 ? "text-red-600" : ""}`}>{fmt(r.profit)}</td>
                                        <td className={`px-3 py-2.5 text-right font-mono ${r.marginPct < 0 ? "text-red-600" : ""}`}>{r.soldValue !== 0 ? `${r.marginPct.toFixed(1)}%` : "—"}</td>
                                        <td className="px-3 py-2.5 text-right text-xs text-muted-foreground">{r.lastPurchase ? fmtDate(r.lastPurchase) : "—"}</td>
                                    </tr>
                                ))}
                            </tbody>
                            {data.rows.length > 0 && (
                                <tfoot className="border-t bg-muted/30 font-semibold">
                                    <tr>
                                        <td className="px-3 py-2.5">Total</td>
                                        <td className="px-3 py-2.5 text-right">{data.totals.bills}</td>
                                        <td />
                                        <td className="px-3 py-2.5 text-right font-mono">{fmt(data.totals.value)}</td>
                                        <td />
                                        <td className="px-3 py-2.5 text-right font-mono">{fmt(data.totals.soldValue)}</td>
                                        <td className={`px-3 py-2.5 text-right font-mono ${data.totals.profit < 0 ? "text-red-600" : ""}`}>{fmt(data.totals.profit)}</td>
                                        <td className="px-3 py-2.5 text-right font-mono">{data.totals.marginPct.toFixed(1)}%</td>
                                        <td />
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
