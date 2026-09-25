"use client";

import { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, ChevronDown, ChevronRight, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { fmt } from "@/shared/lib/format/moneyInr";
import { toIsoDate } from "@/shared/hooks/useTallyDate";
import { indianFiscalYearStart } from "@/modules/accountancy/lib/period";
import { useBiQuery } from "@/modules/bi/hooks/useBiQuery";
import { fmtQty, fmtDate } from "@/modules/bi/lib/format";
import { BiFilterBar, type BranchOption } from "@/modules/bi/components/BiFilterBar";

interface VarianceRow {
    productId: number; sku: string; name: string; category: string | null;
    buys: number; qty: number; minRate: number; maxRate: number;
    latestRate: number; weightedAvg: number; variancePct: number; trend: "up" | "down" | "flat";
}
interface BuyEntry {
    date: string; supplier: string; voucherId: number; voucherNo: string | null;
    qty: number; rate: number; value: number;
}
interface Report { branches: BranchOption[]; rows: VarianceRow[] }

export default function PurchasePriceVariancePage() {
    const [from, setFrom] = useState(toIsoDate(indianFiscalYearStart()));
    const [to, setTo] = useState(toIsoDate(new Date()));
    const [branchId, setBranchId] = useState("");
    const [expanded, setExpanded] = useState<number | null>(null);
    const [detail, setDetail] = useState<Record<number, BuyEntry[]>>({});
    const [detailLoading, setDetailLoading] = useState(false);

    const query = `from=${from}&to=${to}${branchId ? `&branchId=${branchId}` : ""}`;
    const { data, status, reload } = useBiQuery<Report>(`/api/bi/purchase-price-variance?${query}`);

    const toggle = (productId: number) => {
        if (expanded === productId) { setExpanded(null); return; }
        setExpanded(productId);
        if (!detail[productId]) {
            setDetailLoading(true);
            axios.get<{ entries: BuyEntry[] }>(`/api/bi/purchase-price-variance?${query}&productId=${productId}`)
                .then((r) => setDetail((d) => ({ ...d, [productId]: r.data.entries })))
                .catch(() => toast.error("Failed to load buy history"))
                .finally(() => setDetailLoading(false));
        }
    };

    const TrendIcon = ({ trend }: { trend: VarianceRow["trend"] }) =>
        trend === "up" ? <TrendingUp size={14} className="inline text-red-600" />
        : trend === "down" ? <TrendingDown size={14} className="inline text-emerald-600" />
        : <Minus size={14} className="inline text-muted-foreground" />;

    return (
        <ScrollArea className="h-full" type="always">
        <div className="max-w-7xl mx-auto space-y-5 px-6 pt-3 pb-6">
            <div className="flex items-end justify-between gap-3 flex-wrap">
                <div>
                    <h1 className="text-2xl font-bold text-foreground">Purchase Price Variance</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        Same item bought at different rates — catch price creep and inconsistent buying. Items with 2+ buys; click a row for the dated buy list.
                    </p>
                </div>
                <BiFilterBar
                    from={from} to={to} branchId={branchId} branches={data?.branches ?? []}
                    onFrom={setFrom} onTo={setTo} onBranch={setBranchId} onRefresh={reload}
                />
            </div>

            {status}

            {data && (
                <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
                    <table className="w-full text-sm">
                        <thead className="border-b bg-muted text-xs text-muted-foreground">
                            <tr>
                                <th className="px-3 py-2 text-left font-medium">Item</th>
                                <th className="px-3 py-2 text-right font-medium">Buys</th>
                                <th className="px-3 py-2 text-right font-medium">Min Rate</th>
                                <th className="px-3 py-2 text-right font-medium">Max Rate</th>
                                <th className="px-3 py-2 text-right font-medium">Latest</th>
                                <th className="px-3 py-2 text-right font-medium">Wtd Avg</th>
                                <th className="px-3 py-2 text-right font-medium">Variance %</th>
                                <th className="px-3 py-2 text-right font-medium">Trend</th>
                                <th className="px-3 py-2 w-8" />
                            </tr>
                        </thead>
                        <tbody>
                            {data.rows.length === 0 ? (
                                <tr><td colSpan={9} className="py-12 text-center text-muted-foreground text-sm">No items bought more than once in this period.</td></tr>
                            ) : data.rows.map((r) => (
                                <>
                                <tr
                                    key={r.productId}
                                    className="border-b last:border-0 hover:bg-muted/40 cursor-pointer"
                                    onClick={() => toggle(r.productId)}
                                >
                                    <td className="px-3 py-2.5">
                                        <span className="font-medium text-foreground">{r.name}</span>
                                        {r.category && <span className="ml-2 text-xs text-muted-foreground">{r.category}</span>}
                                    </td>
                                    <td className="px-3 py-2.5 text-right text-muted-foreground">{r.buys}</td>
                                    <td className="px-3 py-2.5 text-right font-mono">{fmt(r.minRate)}</td>
                                    <td className="px-3 py-2.5 text-right font-mono">{fmt(r.maxRate)}</td>
                                    <td className="px-3 py-2.5 text-right font-mono font-semibold">{fmt(r.latestRate)}</td>
                                    <td className="px-3 py-2.5 text-right font-mono text-muted-foreground">{fmt(r.weightedAvg)}</td>
                                    <td className={`px-3 py-2.5 text-right font-mono ${r.variancePct >= 10 ? "text-red-600 font-semibold" : ""}`}>{r.variancePct.toFixed(1)}%</td>
                                    <td className="px-3 py-2.5 text-right"><TrendIcon trend={r.trend} /></td>
                                    <td className="px-3 py-2.5 text-muted-foreground">
                                        {expanded === r.productId ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                    </td>
                                </tr>
                                {expanded === r.productId && (
                                    <tr key={`${r.productId}-detail`} className="border-b bg-muted/20">
                                        <td colSpan={9} className="px-6 py-3">
                                            {detailLoading && !detail[r.productId] ? (
                                                <Loader2 className="animate-spin text-muted-foreground" size={18} />
                                            ) : (
                                                <table className="w-full text-xs">
                                                    <thead className="text-muted-foreground">
                                                        <tr>
                                                            <th className="py-1 text-left font-medium">Date</th>
                                                            <th className="py-1 text-left font-medium">Supplier</th>
                                                            <th className="py-1 text-left font-medium">Voucher</th>
                                                            <th className="py-1 text-right font-medium">Qty</th>
                                                            <th className="py-1 text-right font-medium">Rate</th>
                                                            <th className="py-1 text-right font-medium">Value</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {(detail[r.productId] ?? []).map((e, i) => (
                                                            <tr key={i} className="border-t border-border/50">
                                                                <td className="py-1.5 text-muted-foreground">{fmtDate(e.date)}</td>
                                                                <td className="py-1.5 text-foreground">{e.supplier}</td>
                                                                <td className="py-1.5 font-mono">{e.voucherNo ?? `UV-${e.voucherId}`}</td>
                                                                <td className="py-1.5 text-right font-mono">{fmtQty(e.qty)}</td>
                                                                <td className="py-1.5 text-right font-mono font-semibold">{fmt(e.rate)}</td>
                                                                <td className="py-1.5 text-right font-mono text-muted-foreground">{fmt(e.value)}</td>
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
                    </table>
                </div>
            )}
        </div>
        </ScrollArea>
    );
}
