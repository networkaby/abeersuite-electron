"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { fmt } from "@/utils/constants";
import { useBiQuery } from "@/modules/bi/hooks/useBiQuery";
import { fmtDate } from "@/modules/bi/lib/format";
import { type BranchOption } from "@/modules/bi/components/BiFilterBar";

interface InactiveRow {
    accountId: number; name: string; phone: string | null;
    lastPurchase: string; daysAgo: number; bills: number; revenue: number;
}
interface Report {
    baseWindowMonths: number;
    days: number;
    branches: BranchOption[];
    activeCustomers: number;
    rows: InactiveRow[];
}

const DAY_OPTIONS = [30, 60, 90, 180];

export default function InactiveCustomersPage() {
    const [days, setDays] = useState(90);
    const [branchId, setBranchId] = useState("");

    const { data, loading, reload } = useBiQuery<Report>(
        `/api/bi/inactive-customers?days=${days}${branchId ? `&branchId=${branchId}` : ""}`,
    );

    return (
        <ScrollArea className="h-full" type="always">
        <div className="max-w-7xl mx-auto space-y-5 px-6 pt-3 pb-6">
            <div className="flex items-end justify-between gap-3 flex-wrap">
                <div>
                    <h1 className="text-2xl font-bold text-foreground">Inactive Customers</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        The win-back call list — customers silent for {days}+ days, ranked by what they used to be worth
                        (base: last {data?.baseWindowMonths ?? 24} months{data ? `; ${data.activeCustomers} still active` : ""}).
                    </p>
                </div>
                <div className="flex items-end gap-2">
                    <div className="space-y-1">
                        <span className="block text-sm font-medium">Silent for</span>
                        <select
                            value={days} onChange={(e) => setDays(Number(e.target.value))}
                            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                        >
                            {DAY_OPTIONS.map((d) => (
                                <option key={d} value={d}>{d}+ days</option>
                            ))}
                        </select>
                    </div>
                    <div className="space-y-1">
                        <span className="block text-sm font-medium">Branch</span>
                        <select
                            value={branchId} onChange={(e) => setBranchId(e.target.value)}
                            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                        >
                            <option value="">All branches</option>
                            {(data?.branches ?? []).map((b) => (
                                <option key={b.id} value={b.id}>{b.name}</option>
                            ))}
                        </select>
                    </div>
                    <Button onClick={reload}>Refresh</Button>
                </div>
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
                                <th className="px-3 py-2 text-left font-medium">Customer</th>
                                <th className="px-3 py-2 text-left font-medium">Phone</th>
                                <th className="px-3 py-2 text-right font-medium">Last Purchase</th>
                                <th className="px-3 py-2 text-right font-medium">Days Ago</th>
                                <th className="px-3 py-2 text-right font-medium">Lifetime Bills</th>
                                <th className="px-3 py-2 text-right font-medium">Lifetime Revenue</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.rows.length === 0 ? (
                                <tr><td colSpan={6} className="py-12 text-center text-muted-foreground text-sm">No inactive customers at this threshold — good sign.</td></tr>
                            ) : data.rows.map((r) => (
                                <tr key={r.accountId} className="border-b last:border-0 hover:bg-muted/40">
                                    <td className="px-3 py-2.5 font-medium text-foreground">{r.name}</td>
                                    <td className="px-3 py-2.5 font-mono text-xs">{r.phone ?? <span className="text-muted-foreground/40">—</span>}</td>
                                    <td className="px-3 py-2.5 text-right text-xs text-muted-foreground">{fmtDate(r.lastPurchase)}</td>
                                    <td className="px-3 py-2.5 text-right font-mono text-red-600">{r.daysAgo}</td>
                                    <td className="px-3 py-2.5 text-right font-mono">{r.bills}</td>
                                    <td className="px-3 py-2.5 text-right font-mono font-semibold">{fmt(r.revenue)}</td>
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
