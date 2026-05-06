"use client";

import { useEffect, useState, useCallback } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { indianFiscalYearStart, formatDateInput } from "@/modules/tally/lib/period";

type Bucket = { type: string; total: number; posted: number; draft: number; cancelled: number };
type StatsData = {
    from: string; to: string;
    voucherTypes:    Bucket[];
    invVoucherTypes: Bucket[];
    other:   { invoices: number; cancelledInvoices: number; journalEntries: number };
    masters: {
        groups: number; ledgers: number; parties: number;
        stockItems: number; stockGroups: number; categories: number;
        brands: number; units: number;
    };
};

const VOUCHER_LABEL: Record<string, string> = {
    CONTRA: "Contra", PAYMENT: "Payment", RECEIPT: "Receipt",
    CREDIT_NOTE: "Credit Note", DEBIT_NOTE: "Debit Note",
};

const INV_VOUCHER_LABEL: Record<string, string> = {
    PURCHASE: "Purchase", SALE: "Sale", ESTIMATE: "Estimate",
    RECEIPT: "Receipt Note (GRN)", ISSUE: "Issue", ADJUSTMENT: "Adjustment",
    STOCK_JOURNAL: "Stock Journal", PHYSICAL_STOCK: "Physical Stock",
    GRN: "GRN", CHALLAN: "Delivery Challan",
    REJECTION_IN: "Rejection In", REJECTION_OUT: "Rejection Out",
    SALES_ORDER: "Sales Order", PURCHASE_ORDER: "Purchase Order",
};

export default function StatisticsPage() {
    const fyStart = indianFiscalYearStart();
    const [from, setFrom] = useState(formatDateInput(fyStart));
    const [to, setTo]     = useState(formatDateInput(new Date()));
    const [data, setData] = useState<StatsData | null>(null);
    const [loading, setLoading] = useState(false);

    const load = useCallback(() => {
        setLoading(true);
        axios.get<StatsData>(`/api/finance/reports/statistics?from=${from}&to=${to}`)
            .then((r) => setData(r.data))
            .catch(() => toast.error("Failed to load statistics"))
            .finally(() => setLoading(false));
    }, [from, to]);

    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(load, [load]);

    return (
        <div className="max-w-6xl mx-auto space-y-5">
            <div className="flex items-end justify-between gap-3 flex-wrap">
                <div>
                    <h1 className="text-2xl font-bold text-foreground">Statistics</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        Counts of every voucher kind in the period, plus current master totals — Tally&apos;s F11 stat sheet.
                    </p>
                </div>
                <div className="flex items-end gap-2">
                    <div className="space-y-1">
                        <Label>From</Label>
                        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-auto" />
                    </div>
                    <div className="space-y-1">
                        <Label>To</Label>
                        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-auto" />
                    </div>
                    <Button onClick={load}>Run</Button>
                </div>
            </div>

            {loading && (
                <div className="flex justify-center py-20">
                    <Loader2 className="animate-spin text-muted-foreground" size={28} />
                </div>
            )}

            {!loading && data && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                    <VoucherTypeCard
                        title="Accounting Vouchers"
                        empty="No accounting vouchers in this period."
                        rows={data.voucherTypes}
                        labels={VOUCHER_LABEL}
                        extras={[
                            { label: "Journal Entries", value: data.other.journalEntries },
                            { label: "Invoices",        value: data.other.invoices, dim: data.other.cancelledInvoices > 0 ? `${data.other.cancelledInvoices} cancelled` : undefined },
                        ]}
                    />

                    <VoucherTypeCard
                        title="Inventory Vouchers"
                        empty="No inventory vouchers in this period."
                        rows={data.invVoucherTypes}
                        labels={INV_VOUCHER_LABEL}
                    />

                    <MasterCard masters={data.masters} />
                </div>
            )}
        </div>
    );
}

function VoucherTypeCard({
    title, rows, labels, empty, extras,
}: {
    title:  string;
    empty:  string;
    rows:   Bucket[];
    labels: Record<string, string>;
    extras?: { label: string; value: number; dim?: string }[];
}) {
    const total = rows.reduce((s, r) => s + r.total, 0);
    return (
        <div className="rounded-lg border border-border bg-card shadow-sm">
            <div className="border-b border-border px-4 py-2.5 flex items-center justify-between">
                <h2 className="font-semibold">{title}</h2>
                <span className="text-xs text-muted-foreground">total {total}</span>
            </div>
            <table className="w-full text-sm">
                <thead className="bg-muted text-xs text-muted-foreground border-b border-border">
                    <tr>
                        <th className="px-3 py-1.5 text-left font-medium">Type</th>
                        <th className="px-3 py-1.5 text-right font-medium w-16">Posted</th>
                        <th className="px-3 py-1.5 text-right font-medium w-16">Draft</th>
                        <th className="px-3 py-1.5 text-right font-medium w-20">Cancelled</th>
                        <th className="px-3 py-1.5 text-right font-medium w-16">Total</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.length === 0 && (!extras || extras.length === 0) ? (
                        <tr>
                            <td colSpan={5} className="py-8 text-center text-muted-foreground text-xs">{empty}</td>
                        </tr>
                    ) : (
                        <>
                            {rows.map((r) => (
                                <tr key={r.type} className="border-b last:border-0 hover:bg-muted/40">
                                    <td className="px-3 py-2 text-foreground">{labels[r.type] ?? r.type}</td>
                                    <td className="px-3 py-2 text-right font-mono">{r.posted || <span className="text-muted-foreground/40">—</span>}</td>
                                    <td className="px-3 py-2 text-right font-mono">{r.draft || <span className="text-muted-foreground/40">—</span>}</td>
                                    <td className="px-3 py-2 text-right font-mono">{r.cancelled || <span className="text-muted-foreground/40">—</span>}</td>
                                    <td className="px-3 py-2 text-right font-mono font-semibold">{r.total}</td>
                                </tr>
                            ))}
                            {extras?.map((e) => (
                                <tr key={e.label} className="border-b last:border-0">
                                    <td className="px-3 py-2 text-foreground">
                                        {e.label}
                                        {e.dim && <span className="ml-2 text-xs text-muted-foreground">{e.dim}</span>}
                                    </td>
                                    <td colSpan={3} />
                                    <td className="px-3 py-2 text-right font-mono font-semibold">{e.value}</td>
                                </tr>
                            ))}
                        </>
                    )}
                </tbody>
            </table>
        </div>
    );
}

function MasterCard({ masters }: { masters: StatsData["masters"] }) {
    const items: { label: string; value: number }[] = [
        { label: "Account Groups", value: masters.groups },
        { label: "Ledgers (GL)",   value: masters.ledgers },
        { label: "Party A/cs",     value: masters.parties },
        { label: "Stock Groups",   value: masters.stockGroups },
        { label: "Stock Items",    value: masters.stockItems },
        { label: "Categories",     value: masters.categories },
        { label: "Brands",         value: masters.brands },
        { label: "Units",          value: masters.units },
    ];
    return (
        <div className="rounded-lg border border-border bg-card shadow-sm lg:col-span-2">
            <div className="border-b border-border px-4 py-2.5">
                <h2 className="font-semibold">Masters</h2>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y divide-border">
                {items.map((i) => (
                    <div key={i.label} className="px-4 py-3">
                        <div className="text-xs text-muted-foreground">{i.label}</div>
                        <div className="mt-0.5 text-lg font-mono font-semibold">{i.value.toLocaleString()}</div>
                    </div>
                ))}
            </div>
        </div>
    );
}
