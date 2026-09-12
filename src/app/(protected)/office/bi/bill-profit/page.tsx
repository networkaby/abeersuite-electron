"use client";

import { useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, ChevronDown, ChevronRight } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { fmt } from "@/utils/constants";
import { toIsoDate } from "@/shared/hooks/useTallyDate";
import { indianFiscalYearStart } from "@/modules/accountancy/lib/period";
import { useBiQuery } from "@/modules/bi/hooks/useBiQuery";
import { fmtQty, fmtDate } from "@/modules/bi/lib/format";
import { BiFilterBar, type BranchOption } from "@/modules/bi/components/BiFilterBar";
import { KpiCard } from "@/modules/bi/components/KpiCard";
import { editFormUrl } from "@/modules/inventory/lib/voucherFormUrls";

interface BillAdjustment {
    discount: number; charge: number; roundOff: number; shippingNet: number; net: number;
}
interface BillRow {
    voucherId: number; voucherNo: string; type: string; date: string; accountId: number;
    party: string; items: number; qty: number; revenue: number; cogs: number; profit: number; marginPct: number;
    billAdjustment: BillAdjustment; netProfit: number; netMarginPct: number;
}
interface ItemRow {
    productId: number; sku: string; name: string; qty: number;
    revenue: number; amountIncl: number; cogs: number; profit: number; marginPct: number;
}
interface BillDetail {
    items: ItemRow[];
    grossProfit: number;
    adjustment: BillAdjustment;
    netProfit: number;
    netMarginPct: number;
}
interface Report {
    costMethod: string;
    branches: BranchOption[];
    rows: BillRow[];
    hasAdjustments: boolean;
    totals: {
        bills: number; lossBills: number; qty: number; revenue: number; cogs: number; profit: number; marginPct: number;
        netProfit: number; netMarginPct: number;
    };
}

/** Tooltip text for the merged "Bill adj." column — breaks the net figure
 * back into its parts so a glance explains where the number came from. */
function adjTitle(a: BillAdjustment): string {
    const parts: string[] = [];
    if (a.discount !== 0) parts.push(`Discount ${a.discount > 0 ? "+" : ""}${a.discount.toFixed(2)}`);
    if (a.charge !== 0) parts.push(`Coupon/loyalty/charges ${a.charge > 0 ? "+" : ""}${a.charge.toFixed(2)}`);
    if (a.roundOff !== 0) parts.push(`Round off ${a.roundOff > 0 ? "+" : ""}${a.roundOff.toFixed(2)}`);
    if (a.shippingNet !== 0) parts.push(`Shipping (not in net) ${a.shippingNet > 0 ? "+" : ""}${a.shippingNet.toFixed(2)}`);
    return parts.join(" · ") || "No bill-level adjustment";
}

const SORTS = [
    { key: "date", label: "Latest" },
    { key: "profit", label: "Top profit" },
    { key: "worst", label: "Worst first" },
] as const;
type SortKey = (typeof SORTS)[number]["key"];

export default function BillProfitPage() {
    const [from, setFrom] = useState(toIsoDate(indianFiscalYearStart()));
    const [to, setTo] = useState(toIsoDate(new Date()));
    const [branchId, setBranchId] = useState("");
    const [sort, setSort] = useState<SortKey>("date");
    const [expanded, setExpanded] = useState<number | null>(null);
    const [detail, setDetail] = useState<Record<number, BillDetail>>({});
    const [detailLoading, setDetailLoading] = useState(false);

    const query = `from=${from}&to=${to}${branchId ? `&branchId=${branchId}` : ""}`;
    const { data, status, reload } = useBiQuery<Report>(`/api/bi/bill-profit?${query}`);

    const rows = useMemo(() => {
        if (!data) return [];
        const r = [...data.rows];
        // Sorts by NET profit — the discount/coupon-adjusted figure — since
        // that's the one that actually reflects what the bill made.
        if (sort === "profit") r.sort((a, b) => b.netProfit - a.netProfit);
        else if (sort === "worst") r.sort((a, b) => a.netProfit - b.netProfit);
        return r; // "date" — API order (latest first)
    }, [data, sort]);

    // Base 10 columns (9 data + chevron); +3 when Bill adj./Net Profit/Net %
    // are shown. Keeps colSpan on the empty-state and drill-down rows in sync
    // with however many <th>s are actually rendered.
    const colCount = data?.hasAdjustments ? 13 : 10;

    const toggle = (voucherId: number) => {
        if (expanded === voucherId) { setExpanded(null); return; }
        setExpanded(voucherId);
        if (!detail[voucherId]) {
            setDetailLoading(true);
            axios.get<BillDetail>(`/api/bi/bill-profit?${query}&voucherId=${voucherId}`)
                .then((r) => setDetail((d) => ({ ...d, [voucherId]: r.data })))
                .catch(() => toast.error("Failed to load bill breakup"))
                .finally(() => setDetailLoading(false));
        }
    };

    return (
        <ScrollArea className="h-full" type="always">
        <div className="max-w-7xl mx-auto space-y-5 px-6 pt-3 pb-6">
            <div className="flex items-end justify-between gap-3 flex-wrap">
                <div>
                    <h1 className="text-2xl font-bold text-foreground">Bill-wise Profit</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        Profit earned on each individual bill (derived COGS, pre-tax) — click a bill for its item lines. Sale returns show as negative bills.
                        Gross Profit is item-level only; Net Profit also nets out bill-level discount, coupon/loyalty and round-off (not shipping).
                    </p>
                </div>
                <BiFilterBar
                    from={from} to={to} branchId={branchId} branches={data?.branches ?? []}
                    onFrom={setFrom} onTo={setTo} onBranch={setBranchId} onRefresh={reload}
                    right={
                        <div className="flex rounded-md border border-border overflow-hidden">
                            {SORTS.map((s) => (
                                <button
                                    key={s.key}
                                    onClick={() => setSort(s.key)}
                                    className={`px-2.5 py-1.5 text-xs ${sort === s.key ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-muted"}`}
                                >
                                    {s.label}
                                </button>
                            ))}
                        </div>
                    }
                />
            </div>

            {status}

            {data && (
                <>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-8 gap-3">
                        <KpiCard label="Bills" value={String(data.totals.bills)} sub={`${fmtQty(data.totals.qty)} units`} />
                        <KpiCard label="Revenue (pre-tax)" value={fmt(data.totals.revenue)} />
                        <KpiCard label="Gross Profit" value={fmt(data.totals.profit)} />
                        <KpiCard label="Gross %" value={`${data.totals.marginPct.toFixed(1)}%`} tone={data.totals.marginPct < 0 ? "negative" : "default"} />
                        <KpiCard label="Net Profit" value={fmt(data.totals.netProfit)} tone="primary" />
                        <KpiCard label="Net Margin %" value={`${data.totals.netMarginPct.toFixed(1)}%`} tone={data.totals.netMarginPct < 0 ? "negative" : "default"} />
                        <KpiCard label="Avg net profit / bill" value={fmt(data.totals.bills > 0 ? data.totals.netProfit / data.totals.bills : 0)} />
                        <KpiCard label="Loss-making bills" value={String(data.totals.lossBills)} tone={data.totals.lossBills > 0 ? "negative" : "default"} />
                    </div>

                    <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
                        <table className="w-full text-sm">
                            <thead className="border-b bg-muted text-xs text-muted-foreground">
                                <tr>
                                    <th className="px-3 py-2 text-left font-medium">Bill</th>
                                    <th className="px-3 py-2 text-left font-medium">Date</th>
                                    <th className="px-3 py-2 text-left font-medium">Party</th>
                                    <th className="px-3 py-2 text-right font-medium">Items</th>
                                    <th className="px-3 py-2 text-right font-medium">Qty</th>
                                    <th className="px-3 py-2 text-right font-medium">Revenue</th>
                                    <th className="px-3 py-2 text-right font-medium">COGS</th>
                                    <th className="px-3 py-2 text-right font-medium">Gross Profit</th>
                                    <th className="px-3 py-2 text-right font-medium">Gross %</th>
                                    {data.hasAdjustments && (
                                        <>
                                            <th className="px-3 py-2 text-right font-medium">Bill adj.</th>
                                            <th className="px-3 py-2 text-right font-medium">Net Profit</th>
                                            <th className="px-3 py-2 text-right font-medium">Net %</th>
                                        </>
                                    )}
                                    <th className="px-3 py-2 w-8" />
                                </tr>
                            </thead>
                            <tbody>
                                {rows.length === 0 ? (
                                    <tr><td colSpan={colCount} className="py-12 text-center text-muted-foreground text-sm">No sale bills in this period.</td></tr>
                                ) : rows.map((r) => (
                                    <>
                                    <tr
                                        key={r.voucherId}
                                        className="border-b last:border-0 hover:bg-muted/40 cursor-pointer"
                                        onClick={() => toggle(r.voucherId)}
                                    >
                                        <td className="px-3 py-2.5 font-medium text-foreground">
                                            {editFormUrl(r.type, r.voucherId) ? (
                                                <a
                                                    href={editFormUrl(r.type, r.voucherId)!}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    onClick={(e) => e.stopPropagation()}
                                                    className="hover:underline hover:text-primary"
                                                    title="Open this bill"
                                                >
                                                    {r.voucherNo}
                                                </a>
                                            ) : r.voucherNo}
                                            <span className="ml-1.5 text-[10px] text-muted-foreground">{r.type.replaceAll("_", " ")}</span>
                                        </td>
                                        <td className="px-3 py-2.5 text-xs text-muted-foreground">{fmtDate(r.date)}</td>
                                        <td className="px-3 py-2.5 text-foreground">{r.party}</td>
                                        <td className="px-3 py-2.5 text-right text-muted-foreground">{r.items}</td>
                                        <td className="px-3 py-2.5 text-right font-mono">{fmtQty(r.qty)}</td>
                                        <td className="px-3 py-2.5 text-right font-mono">{fmt(r.revenue)}</td>
                                        <td className="px-3 py-2.5 text-right font-mono text-muted-foreground">{fmt(r.cogs)}</td>
                                        <td className={`px-3 py-2.5 text-right font-mono ${r.profit < 0 ? "text-red-600" : ""}`}>{fmt(r.profit)}</td>
                                        <td className={`px-3 py-2.5 text-right font-mono ${r.marginPct < 0 ? "text-red-600" : ""}`}>{r.marginPct.toFixed(1)}%</td>
                                        {data.hasAdjustments && (
                                            <>
                                                <td
                                                    className={`px-3 py-2.5 text-right font-mono ${r.billAdjustment.net < 0 ? "text-red-600" : r.billAdjustment.net > 0 ? "text-emerald-600" : "text-muted-foreground"}`}
                                                    title={adjTitle(r.billAdjustment)}
                                                >
                                                    {r.billAdjustment.net === 0 ? "—" : fmt(r.billAdjustment.net)}
                                                </td>
                                                <td className={`px-3 py-2.5 text-right font-mono font-semibold ${r.netProfit < 0 ? "text-red-600" : ""}`}>{fmt(r.netProfit)}</td>
                                                <td className={`px-3 py-2.5 text-right font-mono ${r.netMarginPct < 0 ? "text-red-600" : ""}`}>{r.netMarginPct.toFixed(1)}%</td>
                                            </>
                                        )}
                                        <td className="px-3 py-2.5 text-muted-foreground">
                                            {expanded === r.voucherId ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                        </td>
                                    </tr>
                                    {expanded === r.voucherId && (
                                        <tr key={`${r.voucherId}-detail`} className="border-b bg-muted/20">
                                            <td colSpan={colCount} className="px-6 py-3">
                                                {detailLoading && !detail[r.voucherId] ? (
                                                    <Loader2 className="animate-spin text-muted-foreground" size={18} />
                                                ) : (
                                                    <>
                                                    <table className="w-full text-xs">
                                                        <thead className="text-muted-foreground">
                                                            <tr>
                                                                <th className="py-1 text-left font-medium">Item</th>
                                                                <th className="py-1 text-right font-medium">Qty</th>
                                                                <th className="py-1 text-right font-medium">Revenue</th>
                                                                <th className="py-1 text-right font-medium" title="GST-inclusive amount — the price actually billed">Incl. Price</th>
                                                                <th className="py-1 text-right font-medium">COGS</th>
                                                                <th className="py-1 text-right font-medium">Profit</th>
                                                                <th className="py-1 text-right font-medium">Margin %</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {(detail[r.voucherId]?.items ?? []).map((i) => (
                                                                <tr key={i.productId} className="border-t border-border/50">
                                                                    <td className="py-1.5 text-foreground">{i.name}</td>
                                                                    <td className="py-1.5 text-right font-mono">{fmtQty(i.qty)}</td>
                                                                    <td className="py-1.5 text-right font-mono">{fmt(i.revenue)}</td>
                                                                    <td className="py-1.5 text-right font-mono text-muted-foreground">{fmt(i.amountIncl)}</td>
                                                                    <td className="py-1.5 text-right font-mono text-muted-foreground">{fmt(i.cogs)}</td>
                                                                    <td className={`py-1.5 text-right font-mono ${i.profit < 0 ? "text-red-600" : ""}`}>{fmt(i.profit)}</td>
                                                                    <td className={`py-1.5 text-right font-mono ${i.marginPct < 0 ? "text-red-600" : ""}`}>{i.marginPct.toFixed(1)}%</td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                    {detail[r.voucherId] && detail[r.voucherId]!.adjustment.net !== 0 && (
                                                        <div className="mt-2 pt-2 border-t border-border/50 flex flex-wrap items-center justify-end gap-x-4 gap-y-1 text-xs">
                                                            <span className="text-muted-foreground">Gross Profit {fmt(detail[r.voucherId]!.grossProfit)}</span>
                                                            <span className="text-muted-foreground" title={adjTitle(detail[r.voucherId]!.adjustment)}>
                                                                Bill adj. {fmt(detail[r.voucherId]!.adjustment.net)}
                                                            </span>
                                                            <span className={`font-semibold ${detail[r.voucherId]!.netProfit < 0 ? "text-red-600" : ""}`}>
                                                                Net Profit {fmt(detail[r.voucherId]!.netProfit)} ({detail[r.voucherId]!.netMarginPct.toFixed(1)}%)
                                                            </span>
                                                        </div>
                                                    )}
                                                    </>
                                                )}
                                            </td>
                                        </tr>
                                    )}
                                    </>
                                ))}
                            </tbody>
                            {rows.length > 0 && (
                                <tfoot className="border-t bg-muted/30 font-semibold">
                                    <tr>
                                        <td className="px-3 py-2.5" colSpan={3}>Total</td>
                                        <td className="px-3 py-2.5 text-right">{data.totals.bills}</td>
                                        <td className="px-3 py-2.5 text-right font-mono">{fmtQty(data.totals.qty)}</td>
                                        <td className="px-3 py-2.5 text-right font-mono">{fmt(data.totals.revenue)}</td>
                                        <td className="px-3 py-2.5 text-right font-mono">{fmt(data.totals.cogs)}</td>
                                        <td className="px-3 py-2.5 text-right font-mono">{fmt(data.totals.profit)}</td>
                                        <td className="px-3 py-2.5 text-right font-mono">{data.totals.marginPct.toFixed(1)}%</td>
                                        {data.hasAdjustments && (
                                            <>
                                                <td className="px-3 py-2.5 text-right font-mono">{fmt(data.totals.netProfit - data.totals.profit)}</td>
                                                <td className={`px-3 py-2.5 text-right font-mono ${data.totals.netProfit < 0 ? "text-red-600" : ""}`}>{fmt(data.totals.netProfit)}</td>
                                                <td className="px-3 py-2.5 text-right font-mono">{data.totals.netMarginPct.toFixed(1)}%</td>
                                            </>
                                        )}
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
