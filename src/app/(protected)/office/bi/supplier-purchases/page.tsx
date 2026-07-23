"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
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
    value: number; sharePct: number; lastPurchase: string;
}
interface Report {
    branches: BranchOption[];
    rows: SupplierRow[];
    totals: { value: number; bills: number };
}

export default function SupplierPurchasesPage() {
    const [from, setFrom] = useState(toIsoDate(indianFiscalYearStart()));
    const [to, setTo] = useState(toIsoDate(new Date()));
    const [branchId, setBranchId] = useState("");

    const { data, loading, reload } = useBiQuery<Report>(
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
                        Purchase volume per supplier (pre-tax, returns netted)
                        {topShare > 40 ? ` — top supplier holds ${topShare.toFixed(0)}% of your supply (concentration risk).` : "."}
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
                <>
                    {data.rows.length > 0 && (
                        <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
                            <div className="mb-2 text-sm font-medium text-foreground">Top 10 suppliers by purchase value</div>
                            <TopBarChart data={data.rows.slice(0, 10).map((r) => ({ name: r.name, value: r.value }))} dataKey="value" name="Purchases" height={Math.max(120, Math.min(data.rows.length, 10) * 30)} />
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
                                    <th className="px-3 py-2 text-right font-medium">Last Purchase</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.rows.length === 0 ? (
                                    <tr><td colSpan={6} className="py-12 text-center text-muted-foreground text-sm">No purchases in this period.</td></tr>
                                ) : data.rows.map((r) => (
                                    <tr key={r.accountId ?? "none"} className="border-b last:border-0 hover:bg-muted/40">
                                        <td className="px-3 py-2.5 font-medium text-foreground">{r.name}</td>
                                        <td className="px-3 py-2.5 text-right text-muted-foreground">{r.bills}</td>
                                        <td className="px-3 py-2.5 text-right font-mono">{fmtQty(r.qty)}</td>
                                        <td className="px-3 py-2.5 text-right font-mono font-semibold">{fmt(r.value)}</td>
                                        <td className="px-3 py-2.5 text-right font-mono">{r.sharePct.toFixed(1)}%</td>
                                        <td className="px-3 py-2.5 text-right text-xs text-muted-foreground">{fmtDate(r.lastPurchase)}</td>
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
                                        <td colSpan={2} />
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
