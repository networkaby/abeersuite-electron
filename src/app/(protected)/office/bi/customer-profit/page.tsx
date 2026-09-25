"use client";

import { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, ChevronDown, ChevronRight } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { fmt } from "@/shared/lib/format/moneyInr";
import { toIsoDate } from "@/shared/hooks/useTallyDate";
import { indianFiscalYearStart } from "@/modules/accountancy/lib/period";
import { useBiQuery } from "@/modules/bi/hooks/useBiQuery";
import { fmtQty } from "@/modules/bi/lib/format";
import { BiFilterBar, type BranchOption } from "@/modules/bi/components/BiFilterBar";
import { TopBarChart } from "@/modules/bi/components/TopBarChart";

interface CustomerRow {
    accountId: number; name: string; bills: number; qty: number;
    revenue: number; cogs: number; profit: number; marginPct: number;
}
interface ItemRow {
    productId: number; sku: string; name: string; qty: number;
    revenue: number; cogs: number; profit: number; marginPct: number;
}
interface Report {
    costMethod: string;
    branches: BranchOption[];
    rows: CustomerRow[];
    totals: { bills: number; qty: number; revenue: number; cogs: number; profit: number; marginPct: number };
}

export default function CustomerProfitPage() {
    const [from, setFrom] = useState(toIsoDate(indianFiscalYearStart()));
    const [to, setTo] = useState(toIsoDate(new Date()));
    const [branchId, setBranchId] = useState("");
    const [expanded, setExpanded] = useState<number | null>(null);
    const [detail, setDetail] = useState<Record<number, ItemRow[]>>({});
    const [detailLoading, setDetailLoading] = useState(false);

    const query = `from=${from}&to=${to}${branchId ? `&branchId=${branchId}` : ""}`;
    const { data, status, reload } = useBiQuery<Report>(`/api/bi/customer-profit?${query}`);

    const toggle = (accountId: number) => {
        if (expanded === accountId) { setExpanded(null); return; }
        setExpanded(accountId);
        if (!detail[accountId]) {
            setDetailLoading(true);
            axios.get<{ items: ItemRow[] }>(`/api/bi/customer-profit?${query}&accountId=${accountId}`)
                .then((r) => setDetail((d) => ({ ...d, [accountId]: r.data.items })))
                .catch(() => toast.error("Failed to load breakup"))
                .finally(() => setDetailLoading(false));
        }
    };

    return (
        <ScrollArea className="h-full" type="always">
        <div className="max-w-7xl mx-auto space-y-5 px-6 pt-3 pb-6">
            <div className="flex items-end justify-between gap-3 flex-wrap">
                <div>
                    <h1 className="text-2xl font-bold text-foreground">Customer-wise Profit</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        Pre-tax revenue, derived COGS and gross margin per customer — click a row for the item breakup.
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
                    {data.rows.length > 0 && (
                        <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
                            <div className="mb-2 text-sm font-medium text-foreground">Top 10 by profit</div>
                            <TopBarChart data={data.rows.slice(0, 10)} dataKey="profit" name="Profit" height={Math.max(120, Math.min(data.rows.length, 10) * 30)} />
                        </div>
                    )}

                    <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
                        <table className="w-full text-sm">
                            <thead className="border-b bg-muted text-xs text-muted-foreground">
                                <tr>
                                    <th className="px-3 py-2 text-left font-medium">Customer</th>
                                    <th className="px-3 py-2 text-right font-medium">Bills</th>
                                    <th className="px-3 py-2 text-right font-medium">Qty</th>
                                    <th className="px-3 py-2 text-right font-medium">Revenue</th>
                                    <th className="px-3 py-2 text-right font-medium">COGS</th>
                                    <th className="px-3 py-2 text-right font-medium">Profit</th>
                                    <th className="px-3 py-2 text-right font-medium">Margin %</th>
                                    <th className="px-3 py-2 w-8" />
                                </tr>
                            </thead>
                            <tbody>
                                {data.rows.length === 0 ? (
                                    <tr><td colSpan={8} className="py-12 text-center text-muted-foreground text-sm">No sales in this period.</td></tr>
                                ) : data.rows.map((r) => (
                                    <>
                                    <tr
                                        key={r.accountId}
                                        className="border-b last:border-0 hover:bg-muted/40 cursor-pointer"
                                        onClick={() => toggle(r.accountId)}
                                    >
                                        <td className="px-3 py-2.5 font-medium text-foreground">{r.name}</td>
                                        <td className="px-3 py-2.5 text-right text-muted-foreground">{r.bills}</td>
                                        <td className="px-3 py-2.5 text-right font-mono">{fmtQty(r.qty)}</td>
                                        <td className="px-3 py-2.5 text-right font-mono">{fmt(r.revenue)}</td>
                                        <td className="px-3 py-2.5 text-right font-mono text-muted-foreground">{fmt(r.cogs)}</td>
                                        <td className={`px-3 py-2.5 text-right font-mono font-semibold ${r.profit < 0 ? "text-red-600" : ""}`}>{fmt(r.profit)}</td>
                                        <td className={`px-3 py-2.5 text-right font-mono ${r.marginPct < 0 ? "text-red-600" : ""}`}>{r.marginPct.toFixed(1)}%</td>
                                        <td className="px-3 py-2.5 text-muted-foreground">
                                            {expanded === r.accountId ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                        </td>
                                    </tr>
                                    {expanded === r.accountId && (
                                        <tr key={`${r.accountId}-detail`} className="border-b bg-muted/20">
                                            <td colSpan={8} className="px-6 py-3">
                                                {detailLoading && !detail[r.accountId] ? (
                                                    <Loader2 className="animate-spin text-muted-foreground" size={18} />
                                                ) : (
                                                    <table className="w-full text-xs">
                                                        <thead className="text-muted-foreground">
                                                            <tr>
                                                                <th className="py-1 text-left font-medium">Item</th>
                                                                <th className="py-1 text-right font-medium">Qty</th>
                                                                <th className="py-1 text-right font-medium">Revenue</th>
                                                                <th className="py-1 text-right font-medium">COGS</th>
                                                                <th className="py-1 text-right font-medium">Profit</th>
                                                                <th className="py-1 text-right font-medium">Margin %</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {(detail[r.accountId] ?? []).map((i) => (
                                                                <tr key={i.productId} className="border-t border-border/50">
                                                                    <td className="py-1.5 text-foreground">{i.name}</td>
                                                                    <td className="py-1.5 text-right font-mono">{fmtQty(i.qty)}</td>
                                                                    <td className="py-1.5 text-right font-mono">{fmt(i.revenue)}</td>
                                                                    <td className="py-1.5 text-right font-mono text-muted-foreground">{fmt(i.cogs)}</td>
                                                                    <td className={`py-1.5 text-right font-mono ${i.profit < 0 ? "text-red-600" : ""}`}>{fmt(i.profit)}</td>
                                                                    <td className={`py-1.5 text-right font-mono ${i.marginPct < 0 ? "text-red-600" : ""}`}>{i.marginPct.toFixed(1)}%</td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                )}
                                            </td>
                                        </tr>
                                    )}
                                    </>
                                ))}
                            </tbody>
                            {data.rows.length > 0 && (
                                <tfoot className="border-t bg-muted/30 font-semibold">
                                    <tr>
                                        <td className="px-3 py-2.5">Total</td>
                                        <td className="px-3 py-2.5 text-right">{data.totals.bills}</td>
                                        <td className="px-3 py-2.5 text-right font-mono">{fmtQty(data.totals.qty)}</td>
                                        <td className="px-3 py-2.5 text-right font-mono">{fmt(data.totals.revenue)}</td>
                                        <td className="px-3 py-2.5 text-right font-mono">{fmt(data.totals.cogs)}</td>
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
