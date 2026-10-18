"use client";

import { useState } from "react";
import Link from "next/link";
import { Users, ChartArea, Box, ArrowLeftRight, ClipboardList, Network, Layers, PackageCheck, Building2, Percent, ShoppingCart, Truck, Tag, Clock, Receipt, Grid2x2 } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { fmt } from "@/shared/lib/format/moneyInr";
import { toIsoDate } from "@/shared/hooks/useTallyDate";
import { useCanOpenPage } from "@/shared/hooks/useCanOpenPage";
import { indianFiscalYearStart } from "@/modules/accountancy/lib/period";
import { useBiQuery } from "@/modules/bi/hooks/useBiQuery";
import { fmtQty } from "@/modules/bi/lib/format";
import { BiFilterBar, type BranchOption } from "@/modules/bi/components/BiFilterBar";
import { KpiCard } from "@/modules/bi/components/KpiCard";
import { TrendChart } from "@/modules/bi/components/TrendChart";
import { TopBarChart } from "@/modules/bi/components/TopBarChart";

interface Overview {
    costMethod: string;
    branches: BranchOption[];
    kpis: { revenue: number; cogs: number; profit: number; marginPct: number; bills: number; customers: number; qty: number };
    monthlySeries: { label: string; revenue: number; profit: number }[];
    topCustomers: { accountId: number; name: string; profit: number; revenue: number }[];
    topItems: { productId: number; name: string; profit: number; revenue: number }[];
}

const REPORTS = [
    { href: "/office/bi/customer-profit", icon: Users, label: "Customer-wise Profit", desc: "Revenue, derived COGS and margin per customer, with item drill-down." },
    { href: "/office/bi/bill-profit", icon: Receipt, label: "Bill-wise Profit", desc: "Profit earned on each individual bill — loss-making bills flagged." },
    { href: "/office/bi/top-customers", icon: ChartArea, label: "Top Customers", desc: "Rank by profit, revenue or visit frequency — with share of total." },
    { href: "/office/bi/item-profit", icon: Box, label: "Item-wise Profit", desc: "Margin per product; pivot by category or brand; below-cost flags." },
    { href: "/office/bi/item-by-party", icon: Grid2x2, label: "Item by Party", desc: "One item, both sides — who buys it and who supplies it." },
    { href: "/office/bi/party-sale-purchase", icon: ArrowLeftRight, label: "Party Sale & Purchase", desc: "Sold-to vs bought-from per party, with the net flow." },
    { href: "/office/bi/ledger-vs-ledger", icon: ArrowLeftRight, label: "Ledger vs Ledger", desc: "Only the vouchers between two ledgers — Tally's contra-ledger view, with the net." },
    { href: "/office/bi/gst-purchase-planning", icon: ArrowLeftRight, label: "GST Purchase Planning", desc: "GST-party purchase, sale and bank deposit per month, with the FY GST cost budget and its carry-forward." },
    { href: "/office/bi/fsn", icon: ArrowLeftRight, label: "FSN & Dead Stock", desc: "Fast / Slow / Non-moving classes and the value locked in dead stock." },
    { href: "/office/bi/movement-register", icon: ClipboardList, label: "Item Movement Register", desc: "Opening, in, out and closing per item with the dated ledger." },
    { href: "/office/bi/rfm", icon: Network, label: "RFM Segmentation", desc: "Champions, Loyal, At-Risk, Lost — who to reward and who to win back." },
    { href: "/office/bi/abc", icon: Layers, label: "ABC Analysis", desc: "A/B/C classes by revenue or profit contribution — where the money is." },
    { href: "/office/bi/stock-turnover", icon: PackageCheck, label: "Stock Turnover", desc: "Value-based turnover and days of inventory — where money is stuck." },
    { href: "/office/bi/sales-trend", icon: ChartArea, label: "Sales Trend & Seasonality", desc: "Monthly trend vs last year and the day-of-week profile." },
    { href: "/office/bi/branch-comparison", icon: Building2, label: "Branch Comparison", desc: "Revenue, margin, bills and average bill value per branch." },
    { href: "/office/bi/discount-impact", icon: Percent, label: "Discount Impact", desc: "Discount given vs margin kept — where discounts eat the profit." },
    { href: "/office/bi/basket", icon: ShoppingCart, label: "Basket Analysis", desc: "Products bought together — cross-sell prompts and combo offers." },
    { href: "/office/bi/supplier-purchases", icon: Truck, label: "Supplier Purchases", desc: "Volume and share per supplier — concentration risk and leverage." },
    { href: "/office/bi/purchase-price-variance", icon: Tag, label: "Purchase Price Variance", desc: "Same item, different buy rates — catch price creep." },
    { href: "/office/bi/inactive-customers", icon: Clock, label: "Inactive Customers", desc: "The win-back call list — silent customers ranked by past value." },
];

export default function BiDashboardPage() {
    // Report cards only for the reports this person may open (pageAccess.ts).
    const canOpen = useCanOpenPage();
    const [from, setFrom] = useState(toIsoDate(indianFiscalYearStart()));
    const [to, setTo] = useState(toIsoDate(new Date()));
    const [branchId, setBranchId] = useState("");

    const { data, status, reload } = useBiQuery<Overview>(
        `/api/bi/overview?from=${from}&to=${to}${branchId ? `&branchId=${branchId}` : ""}`,
    );

    return (
        <ScrollArea className="h-full" type="always">
        <div className="max-w-7xl mx-auto space-y-5 px-6 pt-3 pb-6">
            <div className="flex items-end justify-between gap-3 flex-wrap">
                <div>
                    <h1 className="text-2xl font-bold text-foreground">Business Intelligence</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        Decision reports for management — profit is computed with a derived cost basis
                        {data ? ` (${data.costMethod.replaceAll("_", " ").toLowerCase()})` : ""}, pre-tax.
                    </p>
                </div>
                <BiFilterBar
                    from={from} to={to} branchId={branchId} branches={data?.branches ?? []}
                    onFrom={setFrom} onTo={setTo} onBranch={setBranchId} onRefresh={reload}
                />
            </div>

            {/* The spinner, the retry and the "these figures are stale" banner all
                live in one place for the whole BI section - and the body is gated on
                the data alone, so changing a date updates the report under the reader
                instead of throwing it away. The other nineteen BI pages already do
                this; the landing page was the holdout. */}
            {status}

            {data && (
                <>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                        <KpiCard label="Revenue (pre-tax)" value={fmt(data.kpis.revenue)} />
                        <KpiCard label="COGS (derived)" value={fmt(data.kpis.cogs)} />
                        <KpiCard label="Gross Profit" value={fmt(data.kpis.profit)} tone="primary" />
                        <KpiCard label="Margin %" value={`${data.kpis.marginPct.toFixed(1)}%`} tone={data.kpis.marginPct < 0 ? "negative" : "default"} />
                        <KpiCard label="Bills" value={String(data.kpis.bills)} sub={`${fmtQty(data.kpis.qty)} units`} />
                        <KpiCard label="Customers" value={String(data.kpis.customers)} sub="excl. walk-in" />
                    </div>

                    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
                        <div className="mb-2 text-sm font-medium text-foreground">Revenue vs Gross Profit — monthly</div>
                        <TrendChart data={data.monthlySeries} />
                    </div>

                    <div className="grid gap-4 lg:grid-cols-2">
                        <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
                            <div className="mb-2 text-sm font-medium text-foreground">Top 5 customers by profit</div>
                            <TopBarChart data={data.topCustomers} dataKey="profit" name="Profit" height={220} />
                        </div>
                        <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
                            <div className="mb-2 text-sm font-medium text-foreground">Top 5 items by profit</div>
                            <TopBarChart data={data.topItems} dataKey="profit" name="Profit" height={220} />
                        </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {REPORTS.filter((r) => canOpen(r.href)).map((r) => (
                            <Link
                                key={r.href} href={r.href}
                                className="rounded-lg border border-border bg-card p-4 shadow-sm transition-colors hover:bg-muted/40"
                            >
                                <div className="flex items-center gap-2 text-foreground">
                                    <r.icon size={16} className="text-primary" />
                                    <span className="text-sm font-medium">{r.label}</span>
                                </div>
                                <p className="mt-1 text-xs text-muted-foreground">{r.desc}</p>
                            </Link>
                        ))}
                    </div>
                </>
            )}
        </div>
        </ScrollArea>
    );
}
