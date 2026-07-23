"use client";

import { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, ChevronDown, ChevronRight } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { fmt } from "@/utils/constants";
import { toIsoDate } from "@/shared/hooks/useTallyDate";
import { indianFiscalYearStart } from "@/modules/accountancy/lib/period";
import { useBiQuery } from "@/modules/bi/hooks/useBiQuery";
import { fmtQty } from "@/modules/bi/lib/format";
import { BiFilterBar, type BranchOption } from "@/modules/bi/components/BiFilterBar";

interface ItemRow {
    productId: number; sku: string; name: string;
    soldQty: number; revenue: number; profit: number; marginPct: number; customers: number;
    boughtQty: number; buyValue: number; suppliers: number;
}
interface PartyBreakup {
    customers: { accountId: number; name: string; qty: number; revenue: number; profit: number; marginPct: number }[];
    suppliers: { accountId: number; name: string; qty: number; value: number; avgRate: number }[];
}
interface Report {
    costMethod: string;
    branches: BranchOption[];
    rows: ItemRow[];
}

export default function ItemByPartyPage() {
    const [from, setFrom] = useState(toIsoDate(indianFiscalYearStart()));
    const [to, setTo] = useState(toIsoDate(new Date()));
    const [branchId, setBranchId] = useState("");
    const [search, setSearch] = useState("");
    const [expanded, setExpanded] = useState<number | null>(null);
    const [detail, setDetail] = useState<Record<number, PartyBreakup>>({});
    const [detailLoading, setDetailLoading] = useState(false);

    const query = `from=${from}&to=${to}${branchId ? `&branchId=${branchId}` : ""}`;
    const { data, loading, reload } = useBiQuery<Report>(`/api/bi/item-by-party?${query}`);

    const rows = (data?.rows ?? []).filter((r) =>
        search === "" || `${r.name} ${r.sku}`.toLowerCase().includes(search.toLowerCase()),
    );

    const toggle = (productId: number) => {
        if (expanded === productId) { setExpanded(null); return; }
        setExpanded(productId);
        if (!detail[productId]) {
            setDetailLoading(true);
            axios.get<PartyBreakup>(`/api/bi/item-by-party?${query}&productId=${productId}`)
                .then((r) => setDetail((d) => ({ ...d, [productId]: r.data })))
                .catch(() => toast.error("Failed to load party breakup"))
                .finally(() => setDetailLoading(false));
        }
    };

    return (
        <ScrollArea className="h-full" type="always">
        <div className="max-w-7xl mx-auto space-y-5 px-6 pt-3 pb-6">
            <div className="flex items-end justify-between gap-3 flex-wrap">
                <div>
                    <h1 className="text-2xl font-bold text-foreground">Item by Party</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        One item, both sides — which customers bought it and which suppliers supplied it. Click a row for the party breakup.
                    </p>
                </div>
                <BiFilterBar
                    from={from} to={to} branchId={branchId} branches={data?.branches ?? []}
                    onFrom={setFrom} onTo={setTo} onBranch={setBranchId} onRefresh={reload}
                    right={
                        <input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Filter items…"
                            className="h-8 rounded-md border border-border bg-card px-2.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                    }
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
                                <th className="px-3 py-2 text-left font-medium">Item</th>
                                <th className="px-3 py-2 text-right font-medium">Sold Qty</th>
                                <th className="px-3 py-2 text-right font-medium">Revenue</th>
                                <th className="px-3 py-2 text-right font-medium">Profit</th>
                                <th className="px-3 py-2 text-right font-medium">Margin %</th>
                                <th className="px-3 py-2 text-right font-medium">Buyers</th>
                                <th className="px-3 py-2 text-right font-medium">Bought Qty</th>
                                <th className="px-3 py-2 text-right font-medium">Buy Value</th>
                                <th className="px-3 py-2 text-right font-medium">Suppliers</th>
                                <th className="px-3 py-2 w-8" />
                            </tr>
                        </thead>
                        <tbody>
                            {rows.length === 0 ? (
                                <tr><td colSpan={10} className="py-12 text-center text-muted-foreground text-sm">No items traded in this period.</td></tr>
                            ) : rows.map((r) => (
                                <>
                                <tr
                                    key={r.productId}
                                    className="border-b last:border-0 hover:bg-muted/40 cursor-pointer"
                                    onClick={() => toggle(r.productId)}
                                >
                                    <td className="px-3 py-2.5 font-medium text-foreground">
                                        {r.name}
                                        <span className="ml-1.5 text-[10px] text-muted-foreground">{r.sku}</span>
                                    </td>
                                    <td className="px-3 py-2.5 text-right font-mono">{fmtQty(r.soldQty)}</td>
                                    <td className="px-3 py-2.5 text-right font-mono">{fmt(r.revenue)}</td>
                                    <td className={`px-3 py-2.5 text-right font-mono font-semibold ${r.profit < 0 ? "text-red-600" : ""}`}>{fmt(r.profit)}</td>
                                    <td className={`px-3 py-2.5 text-right font-mono ${r.marginPct < 0 ? "text-red-600" : ""}`}>{r.marginPct.toFixed(1)}%</td>
                                    <td className="px-3 py-2.5 text-right text-muted-foreground">{r.customers}</td>
                                    <td className="px-3 py-2.5 text-right font-mono">{fmtQty(r.boughtQty)}</td>
                                    <td className="px-3 py-2.5 text-right font-mono">{fmt(r.buyValue)}</td>
                                    <td className="px-3 py-2.5 text-right text-muted-foreground">{r.suppliers}</td>
                                    <td className="px-3 py-2.5 text-muted-foreground">
                                        {expanded === r.productId ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                    </td>
                                </tr>
                                {expanded === r.productId && (
                                    <tr key={`${r.productId}-detail`} className="border-b bg-muted/20">
                                        <td colSpan={10} className="px-6 py-3">
                                            {detailLoading && !detail[r.productId] ? (
                                                <Loader2 className="animate-spin text-muted-foreground" size={18} />
                                            ) : (
                                                <div className="grid gap-4 lg:grid-cols-2">
                                                    <div>
                                                        <div className="mb-1 text-xs font-medium text-foreground">Bought by (customers)</div>
                                                        <table className="w-full text-xs">
                                                            <thead className="text-muted-foreground">
                                                                <tr>
                                                                    <th className="py-1 text-left font-medium">Customer</th>
                                                                    <th className="py-1 text-right font-medium">Qty</th>
                                                                    <th className="py-1 text-right font-medium">Revenue</th>
                                                                    <th className="py-1 text-right font-medium">Profit</th>
                                                                    <th className="py-1 text-right font-medium">Margin %</th>
                                                                </tr>
                                                            </thead>
                                                            <tbody>
                                                                {(detail[r.productId]?.customers ?? []).length === 0 ? (
                                                                    <tr><td colSpan={5} className="py-2 text-muted-foreground">No sales in this period.</td></tr>
                                                                ) : (detail[r.productId]?.customers ?? []).map((c) => (
                                                                    <tr key={c.accountId} className="border-t border-border/50">
                                                                        <td className="py-1.5 text-foreground">{c.name}</td>
                                                                        <td className="py-1.5 text-right font-mono">{fmtQty(c.qty)}</td>
                                                                        <td className="py-1.5 text-right font-mono">{fmt(c.revenue)}</td>
                                                                        <td className={`py-1.5 text-right font-mono ${c.profit < 0 ? "text-red-600" : ""}`}>{fmt(c.profit)}</td>
                                                                        <td className={`py-1.5 text-right font-mono ${c.marginPct < 0 ? "text-red-600" : ""}`}>{c.marginPct.toFixed(1)}%</td>
                                                                    </tr>
                                                                ))}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                    <div>
                                                        <div className="mb-1 text-xs font-medium text-foreground">Supplied by (suppliers)</div>
                                                        <table className="w-full text-xs">
                                                            <thead className="text-muted-foreground">
                                                                <tr>
                                                                    <th className="py-1 text-left font-medium">Supplier</th>
                                                                    <th className="py-1 text-right font-medium">Qty</th>
                                                                    <th className="py-1 text-right font-medium">Buy Value</th>
                                                                    <th className="py-1 text-right font-medium">Avg Rate</th>
                                                                </tr>
                                                            </thead>
                                                            <tbody>
                                                                {(detail[r.productId]?.suppliers ?? []).length === 0 ? (
                                                                    <tr><td colSpan={4} className="py-2 text-muted-foreground">No purchases in this period.</td></tr>
                                                                ) : (detail[r.productId]?.suppliers ?? []).map((s) => (
                                                                    <tr key={s.accountId} className="border-t border-border/50">
                                                                        <td className="py-1.5 text-foreground">{s.name}</td>
                                                                        <td className="py-1.5 text-right font-mono">{fmtQty(s.qty)}</td>
                                                                        <td className="py-1.5 text-right font-mono">{fmt(s.value)}</td>
                                                                        <td className="py-1.5 text-right font-mono">{fmt(s.avgRate)}</td>
                                                                    </tr>
                                                                ))}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                </div>
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
