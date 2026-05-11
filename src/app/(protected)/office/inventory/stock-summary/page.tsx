"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, ArrowLeft, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fmt } from "@/utils/constants";

type StockSummaryRow = {
    id: number;
    sku: string;
    name: string;
    stock: number;
    lowStockThreshold: number;
    costPaise: number | null;
    unit: { code: string; label: string };
    brand: { name: string } | null;
    category: { name: string } | null;
    isLow: boolean;
};

function rowValue(row: StockSummaryRow): number | null {
    if (row.costPaise == null || row.stock <= 0) return null;
    return (row.stock * row.costPaise) / 100;
}

export default function StockSummaryPage() {
    const router = useRouter();
    const params = useSearchParams();
    const ref = params.get("ref");
    const asOf = params.get("asOf");

    const [rows, setRows] = useState<StockSummaryRow[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        setLoading(true);
        axios
            .get<StockSummaryRow[]>("/api/inventory/reports/stock-summary")
            .then((r) => setRows(r.data))
            .catch(() => toast.error("Failed to load stock summary"))
            .finally(() => setLoading(false));
    }, []);

    const grandTotal = rows.reduce((sum, r) => {
        const v = rowValue(r);
        return v != null ? sum + v : sum;
    }, 0);

    const unknownCostCount = rows.filter((r) => r.costPaise == null).length;

    return (
        <div className="space-y-4">
            <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                    <h2 className="text-xl font-semibold tracking-tight">Stock Summary</h2>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        Live valuation — stock × cost/unit
                        {asOf && (
                            <span className="ml-1">
                                · as at{" "}
                                {new Date(asOf).toLocaleDateString("en-IN", {
                                    day: "2-digit",
                                    month: "short",
                                    year: "numeric",
                                })}
                            </span>
                        )}
                    </p>
                </div>
                {ref === "balance-sheet" && (
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => router.push("/office/accountancy/reports/balance-sheet")}
                    >
                        <ArrowLeft size={14} className="mr-1" />
                        Back to Balance Sheet
                    </Button>
                )}
            </div>

            {loading && (
                <div className="flex justify-center py-16">
                    <Loader2 className="animate-spin text-muted-foreground" size={26} />
                </div>
            )}

            {!loading && (
                <div className="rounded-lg border border-border overflow-hidden">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="bg-muted/40 border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
                                <th className="px-3 py-2 text-left font-medium">SKU</th>
                                <th className="px-3 py-2 text-left font-medium">Name</th>
                                <th className="px-3 py-2 text-left font-medium">Category</th>
                                <th className="px-3 py-2 text-left font-medium">Brand</th>
                                <th className="px-3 py-2 text-left font-medium">Unit</th>
                                <th className="px-3 py-2 text-right font-medium">Stock Qty</th>
                                <th className="px-3 py-2 text-right font-medium">Cost/Unit (₹)</th>
                                <th className="px-3 py-2 text-right font-medium">Value (₹)</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {rows.length === 0 && (
                                <tr>
                                    <td colSpan={8} className="px-3 py-10 text-center text-muted-foreground">
                                        No active products found.
                                    </td>
                                </tr>
                            )}
                            {rows.map((row) => {
                                const value = rowValue(row);
                                return (
                                    <tr
                                        key={row.id}
                                        className={row.isLow ? "bg-amber-50 dark:bg-amber-950/20" : "hover:bg-muted/30"}
                                    >
                                        <td className="px-3 py-2 font-mono text-xs text-muted-foreground whitespace-nowrap">
                                            {row.sku}
                                        </td>
                                        <td className="px-3 py-2 font-medium">
                                            {row.name}
                                            {row.isLow && (
                                                <span className="ml-2 inline-flex items-center gap-0.5 text-amber-600 dark:text-amber-400 text-xs">
                                                    <AlertTriangle size={11} />
                                                    Low
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-3 py-2 text-muted-foreground">
                                            {row.category?.name ?? "—"}
                                        </td>
                                        <td className="px-3 py-2 text-muted-foreground">
                                            {row.brand?.name ?? "—"}
                                        </td>
                                        <td className="px-3 py-2 text-muted-foreground">
                                            {row.unit.code}
                                        </td>
                                        <td className="px-3 py-2 text-right font-mono">
                                            {row.stock}
                                        </td>
                                        <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                                            {row.costPaise != null
                                                ? fmt(row.costPaise / 100)
                                                : <span className="text-muted-foreground/50">—</span>}
                                        </td>
                                        <td className="px-3 py-2 text-right font-mono">
                                            {value != null
                                                ? fmt(value)
                                                : <span className="text-muted-foreground/50">—</span>}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                        <tfoot>
                            <tr className="border-t-2 border-border bg-muted/30 font-semibold">
                                <td colSpan={7} className="px-3 py-2 text-sm">
                                    Total closing stock value
                                    {unknownCostCount > 0 && (
                                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                                            ({unknownCostCount} product{unknownCostCount > 1 ? "s" : ""} excluded — no cost basis)
                                        </span>
                                    )}
                                </td>
                                <td className="px-3 py-2 text-right font-mono">{fmt(grandTotal)}</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            )}
        </div>
    );
}
