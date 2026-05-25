"use client";

// Rate-wise view — every GST slab + an "Unresolved" bucket. Click a row to
// drill into the Item-wise tab pre-filtered by that rate.

import { ChevronRight, AlertTriangle } from "lucide-react";
import type { GstClassificationPayload } from "./types";

interface Props {
    data: GstClassificationPayload;
    onDrillToRate: (rateId: number | null) => void;
}

export function RateWiseTab({ data, onDrillToRate }: Props) {
    const totalResolved = data.summary.totalProducts - data.summary.productsUnresolved;
    return (
        <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="Total products" value={data.summary.totalProducts} />
                <Stat label="Resolved" value={totalResolved} tone="ok" />
                <Stat label="Unresolved" value={data.summary.productsUnresolved} tone={data.summary.productsUnresolved > 0 ? "warn" : "muted"} />
                <Stat label="With HSN" value={data.summary.productsWithHsn} />
            </div>

            <div className="overflow-hidden rounded-lg border border-border bg-card">
                <table className="w-full text-sm">
                    <thead className="border-b bg-muted text-xs uppercase tracking-wide text-muted-foreground">
                        <tr>
                            <th className="px-3 py-2 text-left font-medium">Rate</th>
                            <th className="px-3 py-2 text-left font-medium">Label</th>
                            <th className="px-3 py-2 text-right font-medium">Products</th>
                            <th className="px-3 py-2" />
                        </tr>
                    </thead>
                    <tbody>
                        {data.rates.length === 0 ? (
                            <tr><td colSpan={4} className="px-3 py-8 text-center text-muted-foreground">No GST rates seeded.</td></tr>
                        ) : data.rates.map((r) => (
                            <tr
                                key={r.id}
                                className="cursor-pointer border-b last:border-0 hover:bg-muted/40"
                                onClick={() => onDrillToRate(r.id)}
                            >
                                <td className="px-3 py-2.5 font-mono">{r.rate.toFixed(r.rate % 1 === 0 ? 0 : 2)}%</td>
                                <td className="px-3 py-2.5">
                                    <span className={r.isActive ? "" : "text-muted-foreground italic"}>{r.label}</span>
                                    {!r.isActive && <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px]">inactive</span>}
                                </td>
                                <td className="px-3 py-2.5 text-right font-mono">{r.productCount}</td>
                                <td className="px-3 py-2.5 text-muted-foreground"><ChevronRight className="size-4" /></td>
                            </tr>
                        ))}
                        {data.summary.productsUnresolved > 0 && (
                            <tr
                                className="cursor-pointer border-b bg-amber-50/50 dark:bg-amber-950/10 hover:bg-amber-100/60 dark:hover:bg-amber-950/30"
                                onClick={() => onDrillToRate(null)}
                            >
                                <td className="px-3 py-2.5">
                                    <AlertTriangle className="inline size-4 text-amber-600" />
                                </td>
                                <td className="px-3 py-2.5 font-medium text-amber-900 dark:text-amber-200">Unresolved (no rate anywhere in cascade)</td>
                                <td className="px-3 py-2.5 text-right font-mono">{data.summary.productsUnresolved}</td>
                                <td className="px-3 py-2.5 text-muted-foreground"><ChevronRight className="size-4" /></td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {data.orgDefaults.defaultGstRate && (
                <p className="text-xs text-muted-foreground">
                    Org default GST rate: <strong>{data.orgDefaults.defaultGstRate.label}</strong>. Products with no own rate and no group rate fall through to this.
                </p>
            )}
        </div>
    );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "ok" | "warn" | "muted" }) {
    const toneCls =
        tone === "ok" ? "border-emerald-300/50 bg-emerald-50/60 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-300"
        : tone === "warn" ? "border-amber-300/60 bg-amber-50/60 dark:bg-amber-950/20 text-amber-700 dark:text-amber-300"
        : tone === "muted" ? "text-muted-foreground"
        : "";
    return (
        <div className={`rounded-lg border bg-card p-3 ${toneCls}`}>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
            <p className="mt-1 text-2xl font-bold">{value}</p>
        </div>
    );
}
