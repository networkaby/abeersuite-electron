"use client";

// HSN-wise view — products grouped by their *resolved* HSN/SAC code, then by
// resolved rate within each HSN. Mirrors the layout users expect from GSTR-1
// § 12 but built from master data (not posted vouchers — that's the existing
// HSN Summary report). Click a row → Item-wise tab filtered by that HSN.

import { useMemo } from "react";
import { AlertTriangle, ChevronRight } from "lucide-react";
import type { GstClassificationPayload, ProductRow } from "./types";

interface Props {
    data: GstClassificationPayload;
    onDrillToHsn: (hsn: string | null) => void;
}

type HsnBucket = {
    hsn: string | null;
    rate: number | null;
    rateLabel: string | null;
    taxability: string | null;
    products: ProductRow[];
};

export function HsnWiseTab({ data, onDrillToHsn }: Props) {
    const buckets = useMemo<HsnBucket[]>(() => {
        const map = new Map<string, HsnBucket>();
        for (const p of data.products) {
            const hsn = p.resolved.hsnCode ?? null;
            const rate = p.resolved.gstRate ?? null;
            const rateLabel = p.resolved.gstRateLabel ?? null;
            const taxability = p.resolved.taxability ?? null;
            const key = `${hsn ?? "__none__"}|${rate ?? "__none__"}`;
            let b = map.get(key);
            if (!b) {
                b = { hsn, rate, rateLabel, taxability, products: [] };
                map.set(key, b);
            }
            b.products.push(p);
        }
        return [...map.values()].sort((a, b) => {
            if (a.hsn == null && b.hsn != null) return 1;
            if (b.hsn == null && a.hsn != null) return -1;
            const byHsn = (a.hsn ?? "").localeCompare(b.hsn ?? "");
            if (byHsn !== 0) return byHsn;
            return (a.rate ?? 0) - (b.rate ?? 0);
        });
    }, [data.products]);

    const noHsnTotal = buckets
        .filter((b) => b.hsn == null)
        .reduce((s, b) => s + b.products.length, 0);

    return (
        <div className="space-y-4">
            {noHsnTotal > 0 && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-300/40 bg-amber-50 dark:bg-amber-900/10 px-4 py-3 text-sm">
                    <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-700 dark:text-amber-400" />
                    <p className="text-amber-900 dark:text-amber-200">
                        <strong>{noHsnTotal}</strong> product{noHsnTotal === 1 ? " has" : "s have"} no HSN/SAC code anywhere in the cascade.
                        Set an HSN on the product, its group, or in Org Defaults to silence this warning.
                    </p>
                </div>
            )}

            <div className="overflow-hidden rounded-lg border border-border bg-card">
                <table className="w-full text-sm">
                    <thead className="border-b bg-muted text-xs uppercase tracking-wide text-muted-foreground">
                        <tr>
                            <th className="px-3 py-2 text-left font-medium">HSN / SAC</th>
                            <th className="px-3 py-2 text-left font-medium">Rate</th>
                            <th className="px-3 py-2 text-left font-medium">Taxability</th>
                            <th className="px-3 py-2 text-left font-medium">Sample items</th>
                            <th className="px-3 py-2 text-right font-medium">Products</th>
                            <th className="px-3 py-2" />
                        </tr>
                    </thead>
                    <tbody>
                        {buckets.length === 0 ? (
                            <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">No products.</td></tr>
                        ) : buckets.map((b, i) => (
                            <tr
                                key={i}
                                className={`cursor-pointer border-b last:border-0 hover:bg-muted/40 ${b.hsn == null ? "bg-amber-50/40 dark:bg-amber-950/10" : ""}`}
                                onClick={() => onDrillToHsn(b.hsn)}
                            >
                                <td className="px-3 py-2.5 font-mono">{b.hsn ?? <em className="text-muted-foreground">(no HSN)</em>}</td>
                                <td className="px-3 py-2.5 font-mono">{b.rate != null ? `${b.rate.toFixed(b.rate % 1 === 0 ? 0 : 2)}%` : <em className="text-muted-foreground">—</em>}</td>
                                <td className="px-3 py-2.5">{b.taxability ?? <em className="text-muted-foreground">—</em>}</td>
                                <td className="max-w-md truncate px-3 py-2.5 text-xs text-muted-foreground">
                                    {b.products.slice(0, 4).map((p) => p.name).join(", ")}
                                    {b.products.length > 4 ? ` +${b.products.length - 4}` : ""}
                                </td>
                                <td className="px-3 py-2.5 text-right font-mono">{b.products.length}</td>
                                <td className="px-3 py-2.5 text-muted-foreground"><ChevronRight className="size-4" /></td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <p className="text-xs text-muted-foreground">
                Master-derived view. For period-bound GSTR-1 § 12 numbers (posted transactions only),
                see the <strong>HSN / SAC Summary</strong> report.
            </p>
        </div>
    );
}
