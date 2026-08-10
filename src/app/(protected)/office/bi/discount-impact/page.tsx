"use client";

import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { fmt } from "@/utils/constants";
import { toIsoDate } from "@/shared/hooks/useTallyDate";
import { indianFiscalYearStart } from "@/modules/accountancy/lib/period";
import { useBiQuery } from "@/modules/bi/hooks/useBiQuery";
import { fmtQty } from "@/modules/bi/lib/format";
import { BiFilterBar, type BranchOption } from "@/modules/bi/components/BiFilterBar";
import { KpiCard } from "@/modules/bi/components/KpiCard";

interface DiscountRow {
    key: number; name: string; sub: string | null;
    qty: number; gross: number; discount: number; discountPct: number;
    coupon: number; loyalty: number;
    revenue: number; cogs: number; profit: number; marginPct: number;
}
interface Report {
    costMethod: string;
    branches: BranchOption[];
    byItem: DiscountRow[];
    byCustomer: DiscountRow[];
    totals: { gross: number; discount: number; discountPct: number; coupon: number; loyalty: number; revenue: number; profit: number; marginPct: number };
}

type Pivot = "item" | "customer";

export default function DiscountImpactPage() {
    const [from, setFrom] = useState(toIsoDate(indianFiscalYearStart()));
    const [to, setTo] = useState(toIsoDate(new Date()));
    const [branchId, setBranchId] = useState("");
    const [pivot, setPivot] = useState<Pivot>("item");

    const { data, loading, reload } = useBiQuery<Report>(
        `/api/bi/discount-impact?from=${from}&to=${to}${branchId ? `&branchId=${branchId}` : ""}`,
    );

    const rows = useMemo(() => (data ? (pivot === "item" ? data.byItem : data.byCustomer) : []), [data, pivot]);
    // Discount deeper than the margin that survived = discount ate the profit.
    const ateMargin = (r: DiscountRow) => r.discount > 0 && r.discountPct > r.marginPct;
    const eatenCount = rows.filter(ateMargin).length;

    return (
        <ScrollArea className="h-full" type="always">
        <div className="max-w-7xl mx-auto space-y-5 px-6 pt-3 pb-6">
            <div className="flex items-end justify-between gap-3 flex-wrap">
                <div>
                    <h1 className="text-2xl font-bold text-foreground">Discount Impact</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        Line discounts given vs the margin kept — red rows discounted deeper than the margin that survived
                        {eatenCount > 0 ? ` (${eatenCount} flagged)` : ""}. Coupon and loyalty ₹ are bill-level, shown per customer.
                    </p>
                </div>
                <BiFilterBar
                    from={from} to={to} branchId={branchId} branches={data?.branches ?? []}
                    onFrom={setFrom} onTo={setTo} onBranch={setBranchId} onRefresh={reload}
                    right={
                        <div className="space-y-1">
                            <span className="block text-sm font-medium">By</span>
                            <select
                                value={pivot} onChange={(e) => setPivot(e.target.value as Pivot)}
                                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                            >
                                <option value="item">Item</option>
                                <option value="customer">Customer</option>
                            </select>
                        </div>
                    }
                />
            </div>

            {loading && (
                <div className="flex justify-center py-20">
                    <Loader2 className="animate-spin text-muted-foreground" size={28} />
                </div>
            )}

            {!loading && data && (
                <>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                        <KpiCard label="Gross (pre-discount)" value={fmt(data.totals.gross)} />
                        <KpiCard label="Line discounts" value={fmt(data.totals.discount)} sub={`${data.totals.discountPct.toFixed(1)}% of gross`} tone={data.totals.discount > 0 ? "negative" : "default"} />
                        <KpiCard label="Coupons" value={fmt(data.totals.coupon)} sub="bill-level" tone={data.totals.coupon > 0 ? "negative" : "default"} />
                        <KpiCard label="Loyalty redeemed" value={fmt(data.totals.loyalty)} sub="bill-level" tone={data.totals.loyalty > 0 ? "negative" : "default"} />
                        <KpiCard label="Net Revenue" value={fmt(data.totals.revenue)} />
                        <KpiCard label="Profit kept" value={fmt(data.totals.profit)} sub={`${data.totals.marginPct.toFixed(1)}% margin`} tone="primary" />
                    </div>

                    <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
                        <table className="w-full text-sm">
                            <thead className="border-b bg-muted text-xs text-muted-foreground">
                                <tr>
                                    <th className="px-3 py-2 text-left font-medium">{pivot === "item" ? "Item" : "Customer"}</th>
                                    <th className="px-3 py-2 text-right font-medium">Qty</th>
                                    <th className="px-3 py-2 text-right font-medium">Gross</th>
                                    <th className="px-3 py-2 text-right font-medium">Discount</th>
                                    <th className="px-3 py-2 text-right font-medium">Disc %</th>
                                    {pivot === "customer" && <th className="px-3 py-2 text-right font-medium">Coupon</th>}
                                    {pivot === "customer" && <th className="px-3 py-2 text-right font-medium">Loyalty</th>}
                                    <th className="px-3 py-2 text-right font-medium">Net Revenue</th>
                                    <th className="px-3 py-2 text-right font-medium">Profit</th>
                                    <th className="px-3 py-2 text-right font-medium">Margin %</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.length === 0 ? (
                                    <tr><td colSpan={pivot === "customer" ? 10 : 8} className="py-12 text-center text-muted-foreground text-sm">No sales in this period.</td></tr>
                                ) : rows.map((r) => (
                                    <tr key={r.key} className={`border-b last:border-0 hover:bg-muted/40 ${ateMargin(r) ? "bg-red-500/5" : ""}`}>
                                        <td className="px-3 py-2.5">
                                            <span className="font-medium text-foreground">{r.name}</span>
                                            {r.sub && <span className="ml-2 text-xs text-muted-foreground">{r.sub}</span>}
                                        </td>
                                        <td className="px-3 py-2.5 text-right font-mono">{fmtQty(r.qty)}</td>
                                        <td className="px-3 py-2.5 text-right font-mono text-muted-foreground">{fmt(r.gross)}</td>
                                        <td className={`px-3 py-2.5 text-right font-mono ${r.discount > 0 ? "text-red-600" : "text-muted-foreground/65"}`}>{r.discount > 0 ? fmt(r.discount) : "—"}</td>
                                        <td className={`px-3 py-2.5 text-right font-mono ${ateMargin(r) ? "text-red-600 font-semibold" : ""}`}>{r.discountPct.toFixed(1)}%</td>
                                        {pivot === "customer" && <td className={`px-3 py-2.5 text-right font-mono ${r.coupon > 0 ? "text-red-600" : "text-muted-foreground/65"}`}>{r.coupon > 0 ? fmt(r.coupon) : "—"}</td>}
                                        {pivot === "customer" && <td className={`px-3 py-2.5 text-right font-mono ${r.loyalty > 0 ? "text-red-600" : "text-muted-foreground/65"}`}>{r.loyalty > 0 ? fmt(r.loyalty) : "—"}</td>}
                                        <td className="px-3 py-2.5 text-right font-mono">{fmt(r.revenue)}</td>
                                        <td className={`px-3 py-2.5 text-right font-mono font-semibold ${r.profit < 0 ? "text-red-600" : ""}`}>{fmt(r.profit)}</td>
                                        <td className={`px-3 py-2.5 text-right font-mono ${r.marginPct < 0 ? "text-red-600" : ""}`}>{r.marginPct.toFixed(1)}%</td>
                                    </tr>
                                ))}
                            </tbody>
                            {rows.length > 0 && (
                                <tfoot className="border-t bg-muted/30 font-semibold">
                                    <tr>
                                        <td className="px-3 py-2.5" colSpan={2}>Total</td>
                                        <td className="px-3 py-2.5 text-right font-mono">{fmt(data.totals.gross)}</td>
                                        <td className="px-3 py-2.5 text-right font-mono text-red-600">{fmt(data.totals.discount)}</td>
                                        <td className="px-3 py-2.5 text-right font-mono">{data.totals.discountPct.toFixed(1)}%</td>
                                        {pivot === "customer" && <td className="px-3 py-2.5 text-right font-mono text-red-600">{fmt(data.totals.coupon)}</td>}
                                        {pivot === "customer" && <td className="px-3 py-2.5 text-right font-mono text-red-600">{fmt(data.totals.loyalty)}</td>}
                                        <td className="px-3 py-2.5 text-right font-mono">{fmt(data.totals.revenue)}</td>
                                        <td className="px-3 py-2.5 text-right font-mono">{fmt(data.totals.profit)}</td>
                                        <td className="px-3 py-2.5 text-right font-mono">{data.totals.marginPct.toFixed(1)}%</td>
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
