"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { fmt } from "@/utils/constants";
import { toIsoDate } from "@/shared/hooks/useTallyDate";
import { indianFiscalYearStart } from "@/modules/accountancy/lib/period";
import { useBiQuery } from "@/modules/bi/hooks/useBiQuery";
import { fmtQty, fmtDate } from "@/modules/bi/lib/format";
import { BiFilterBar, type BranchOption } from "@/modules/bi/components/BiFilterBar";

type FsnClass = "FAST" | "SLOW" | "NON_MOVING";

interface FsnRow {
    productId: number; sku: string; name: string;
    category: string | null; brand: string | null; unit: string | null;
    fsnClass: FsnClass; qtyOut: number; stock: number;
    turnover: number | null; lastSaleDate: string | null; stockValue: number;
}
interface Report {
    method: string;
    fastMinTurnover: number;
    branches: BranchOption[];
    summary: { fsnClass: FsnClass; items: number; stockValue: number }[];
    rows: FsnRow[];
}

const CLASS_LABELS: Record<FsnClass, string> = { FAST: "Fast", SLOW: "Slow", NON_MOVING: "Non-moving (dead stock)" };
const CLASS_BADGES: Record<FsnClass, string> = {
    FAST: "bg-emerald-500/15 text-emerald-600",
    SLOW: "bg-amber-500/15 text-amber-600",
    NON_MOVING: "bg-red-500/15 text-red-600",
};

export default function FsnPage() {
    const [from, setFrom] = useState(toIsoDate(indianFiscalYearStart()));
    const [to, setTo] = useState(toIsoDate(new Date()));
    const [branchId, setBranchId] = useState("");
    const [classFilter, setClassFilter] = useState<FsnClass | "ALL">("ALL");

    const { data, loading, reload } = useBiQuery<Report>(
        `/api/bi/fsn?from=${from}&to=${to}${branchId ? `&branchId=${branchId}` : ""}`,
    );

    const rows = useMemo(
        () => (data ? (classFilter === "ALL" ? data.rows : data.rows.filter((r) => r.fsnClass === classFilter)) : []),
        [data, classFilter],
    );

    return (
        <ScrollArea className="h-full" type="always">
        <div className="max-w-7xl mx-auto space-y-5 px-6 pt-3 pb-6">
            <div className="flex items-end justify-between gap-3 flex-wrap">
                <div>
                    <h1 className="text-2xl font-bold text-foreground">FSN & Dead Stock</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        Turnover-based (industry standard): Fast (turnover ≥ {data?.fastMinTurnover ?? 3}) / Slow / Non-moving in the period — non-moving with stock on hand is dead stock, its value locked.
                        For the house recency lens that drives Reorder, see <Link href="/office/bi/stock-health" className="underline hover:text-foreground">Stock Health</Link>.
                    </p>
                </div>
                <BiFilterBar
                    from={from} to={to} branchId={branchId} branches={data?.branches ?? []}
                    onFrom={setFrom} onTo={setTo} onBranch={setBranchId} onRefresh={reload}
                />
            </div>

            {loading && (
                <div className="flex justify-center py-20">
                    <Loader2 className="animate-spin text-muted-foreground" size={28} />
                </div>
            )}

            {!loading && data && (
                <>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        {data.summary.map((s) => (
                            <button
                                key={s.fsnClass}
                                onClick={() => setClassFilter(classFilter === s.fsnClass ? "ALL" : s.fsnClass)}
                                className={`rounded-lg border p-3 text-left shadow-sm transition-colors ${
                                    classFilter === s.fsnClass ? "border-primary bg-primary/10" : "border-border bg-card hover:bg-muted/40"
                                }`}
                            >
                                <div className="flex items-center gap-2">
                                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${CLASS_BADGES[s.fsnClass]}`}>
                                        {CLASS_LABELS[s.fsnClass]}
                                    </span>
                                    <span className="text-xs text-muted-foreground">{s.items} items</span>
                                </div>
                                <div className="mt-1 text-lg font-mono font-semibold text-foreground">{fmt(s.stockValue)}</div>
                                <div className="text-[11px] text-muted-foreground">
                                    {s.fsnClass === "NON_MOVING" ? "value locked in dead stock" : "stock value on hand"}
                                </div>
                            </button>
                        ))}
                    </div>

                    <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
                        <table className="w-full text-sm">
                            <thead className="border-b bg-muted text-xs text-muted-foreground">
                                <tr>
                                    <th className="px-3 py-2 text-left font-medium">Item</th>
                                    <th className="px-3 py-2 text-left font-medium">Class</th>
                                    <th className="px-3 py-2 text-right font-medium">Qty Out</th>
                                    <th className="px-3 py-2 text-right font-medium">Stock Now</th>
                                    <th className="px-3 py-2 text-right font-medium">Turnover</th>
                                    <th className="px-3 py-2 text-right font-medium">Last Sale</th>
                                    <th className="px-3 py-2 text-right font-medium">Stock Value</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.length === 0 ? (
                                    <tr><td colSpan={7} className="py-12 text-center text-muted-foreground text-sm">No stock activity in this period.</td></tr>
                                ) : rows.map((r) => (
                                    <tr key={r.productId} className={`border-b last:border-0 hover:bg-muted/40 ${r.fsnClass === "NON_MOVING" ? "bg-red-500/5" : ""}`}>
                                        <td className="px-3 py-2.5">
                                            <span className="font-medium text-foreground">{r.name}</span>
                                            {r.category && <span className="ml-2 text-xs text-muted-foreground">{r.category}</span>}
                                        </td>
                                        <td className="px-3 py-2.5">
                                            <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${CLASS_BADGES[r.fsnClass]}`}>
                                                {CLASS_LABELS[r.fsnClass]}
                                            </span>
                                        </td>
                                        <td className="px-3 py-2.5 text-right font-mono">{fmtQty(r.qtyOut)}{r.unit ? ` ${r.unit}` : ""}</td>
                                        <td className="px-3 py-2.5 text-right font-mono">{fmtQty(r.stock)}</td>
                                        <td className="px-3 py-2.5 text-right font-mono">{r.turnover !== null ? r.turnover.toFixed(1) : "—"}</td>
                                        <td className="px-3 py-2.5 text-right text-xs text-muted-foreground">{fmtDate(r.lastSaleDate)}</td>
                                        <td className="px-3 py-2.5 text-right font-mono font-semibold">{fmt(r.stockValue)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </>
            )}
        </div>
        </ScrollArea>
    );
}
