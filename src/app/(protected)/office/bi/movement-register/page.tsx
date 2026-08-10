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
import { fmtQty, fmtDate } from "@/modules/bi/lib/format";
import { BiFilterBar, type BranchOption } from "@/modules/bi/components/BiFilterBar";

interface RegisterRow {
    productId: number; sku: string; name: string; unit: string | null; category: string | null;
    opening: number; inQty: number; inValue: number; outQty: number; outValue: number; closing: number;
}
interface LedgerEntry {
    id: number; date: string; branch: string;
    voucherId: number; voucherType: string; voucherNo: string | null;
    inQty: number; outQty: number; rate: number; amount: number;
}
interface Report {
    branches: BranchOption[];
    rows: RegisterRow[];
    totals: { inQty: number; inValue: number; outQty: number; outValue: number };
}
interface Detail { opening: number; entries: LedgerEntry[] }

export default function MovementRegisterPage() {
    const [from, setFrom] = useState(toIsoDate(indianFiscalYearStart()));
    const [to, setTo] = useState(toIsoDate(new Date()));
    const [branchId, setBranchId] = useState("");
    const [expanded, setExpanded] = useState<number | null>(null);
    const [detail, setDetail] = useState<Record<number, Detail>>({});
    const [detailLoading, setDetailLoading] = useState(false);

    const query = `from=${from}&to=${to}${branchId ? `&branchId=${branchId}` : ""}`;
    const { data, loading, reload } = useBiQuery<Report>(`/api/bi/movement-register?${query}`);

    const toggle = (productId: number) => {
        if (expanded === productId) { setExpanded(null); return; }
        setExpanded(productId);
        if (!detail[productId]) {
            setDetailLoading(true);
            axios.get<Detail>(`/api/bi/movement-register?${query}&productId=${productId}`)
                .then((r) => setDetail((d) => ({ ...d, [productId]: r.data })))
                .catch(() => toast.error("Failed to load ledger rows"))
                .finally(() => setDetailLoading(false));
        }
    };

    return (
        <ScrollArea className="h-full" type="always">
        <div className="max-w-7xl mx-auto space-y-5 px-6 pt-3 pb-6">
            <div className="flex items-end justify-between gap-3 flex-wrap">
                <div>
                    <h1 className="text-2xl font-bold text-foreground">Item Movement Register</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        Opening, in, out and closing per item — click a row for the dated voucher-wise ledger.
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
                <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
                    <table className="w-full text-sm">
                        <thead className="border-b bg-muted text-xs text-muted-foreground">
                            <tr>
                                <th className="px-3 py-2 text-left font-medium">Item</th>
                                <th className="px-3 py-2 text-right font-medium">Opening</th>
                                <th className="px-3 py-2 text-right font-medium">In Qty</th>
                                <th className="px-3 py-2 text-right font-medium">In Value</th>
                                <th className="px-3 py-2 text-right font-medium">Out Qty</th>
                                <th className="px-3 py-2 text-right font-medium">Out Value</th>
                                <th className="px-3 py-2 text-right font-medium">Closing</th>
                                <th className="px-3 py-2 w-8" />
                            </tr>
                        </thead>
                        <tbody>
                            {data.rows.length === 0 ? (
                                <tr><td colSpan={8} className="py-12 text-center text-muted-foreground text-sm">No stock movement in this period.</td></tr>
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
                                    <td className="px-3 py-2.5 text-right font-mono text-muted-foreground">{fmtQty(r.opening)}</td>
                                    <td className="px-3 py-2.5 text-right font-mono">{r.inQty > 0 ? fmtQty(r.inQty) : <span className="text-muted-foreground/65">—</span>}</td>
                                    <td className="px-3 py-2.5 text-right font-mono text-muted-foreground">{r.inValue > 0 ? fmt(r.inValue) : "—"}</td>
                                    <td className="px-3 py-2.5 text-right font-mono">{r.outQty > 0 ? fmtQty(r.outQty) : <span className="text-muted-foreground/65">—</span>}</td>
                                    <td className="px-3 py-2.5 text-right font-mono text-muted-foreground">{r.outValue > 0 ? fmt(r.outValue) : "—"}</td>
                                    <td className="px-3 py-2.5 text-right font-mono font-semibold">{fmtQty(r.closing)}</td>
                                    <td className="px-3 py-2.5 text-muted-foreground">
                                        {expanded === r.productId ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                    </td>
                                </tr>
                                {expanded === r.productId && (
                                    <tr key={`${r.productId}-detail`} className="border-b bg-muted/20">
                                        <td colSpan={8} className="px-6 py-3">
                                            {detailLoading && !detail[r.productId] ? (
                                                <Loader2 className="animate-spin text-muted-foreground" size={18} />
                                            ) : (
                                                <table className="w-full text-xs">
                                                    <thead className="text-muted-foreground">
                                                        <tr>
                                                            <th className="py-1 text-left font-medium">Date</th>
                                                            <th className="py-1 text-left font-medium">Voucher</th>
                                                            <th className="py-1 text-left font-medium">Branch</th>
                                                            <th className="py-1 text-right font-medium">In</th>
                                                            <th className="py-1 text-right font-medium">Out</th>
                                                            <th className="py-1 text-right font-medium">Rate</th>
                                                            <th className="py-1 text-right font-medium">Balance</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {(() => {
                                                            const d = detail[r.productId];
                                                            if (!d) return null;
                                                            let balance = d.opening;
                                                            return d.entries.map((e) => {
                                                                balance += e.inQty - e.outQty;
                                                                return (
                                                                    <tr key={e.id} className="border-t border-border/50">
                                                                        <td className="py-1.5 text-muted-foreground">{fmtDate(e.date)}</td>
                                                                        <td className="py-1.5 font-mono">{e.voucherNo ?? e.voucherType}</td>
                                                                        <td className="py-1.5 text-muted-foreground">{e.branch}</td>
                                                                        <td className="py-1.5 text-right font-mono">{e.inQty > 0 ? fmtQty(e.inQty) : "—"}</td>
                                                                        <td className="py-1.5 text-right font-mono">{e.outQty > 0 ? fmtQty(e.outQty) : "—"}</td>
                                                                        <td className="py-1.5 text-right font-mono text-muted-foreground">{fmt(e.rate)}</td>
                                                                        <td className="py-1.5 text-right font-mono font-semibold">{fmtQty(balance)}</td>
                                                                    </tr>
                                                                );
                                                            });
                                                        })()}
                                                    </tbody>
                                                </table>
                                            )}
                                        </td>
                                    </tr>
                                )}
                                </>
                            ))}
                        </tbody>
                        {data.rows.length > 0 && (
                            <tfoot className="border-t bg-muted/30 font-semibold">
                                <tr>
                                    <td className="px-3 py-2.5">Total</td>
                                    <td />
                                    <td className="px-3 py-2.5 text-right font-mono">{fmtQty(data.totals.inQty)}</td>
                                    <td className="px-3 py-2.5 text-right font-mono">{fmt(data.totals.inValue)}</td>
                                    <td className="px-3 py-2.5 text-right font-mono">{fmtQty(data.totals.outQty)}</td>
                                    <td className="px-3 py-2.5 text-right font-mono">{fmt(data.totals.outValue)}</td>
                                    <td colSpan={2} />
                                </tr>
                            </tfoot>
                        )}
                    </table>
                </div>
            )}
        </div>
        </ScrollArea>
    );
}
