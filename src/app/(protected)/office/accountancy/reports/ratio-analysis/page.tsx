"use client";

import { useEffect, useState, useCallback } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fmt } from "@/utils/constants";
import { formatDateInput } from "@/modules/accountancy/lib/period";

type RatioData = {
    from: string; to: string;
    principalGroups: {
        workingCapital: number;
        cashInHand: number; bankAccounts: number; bankOd: number;
        sundryDebtors: number; sundryCreditors: number;
        sales: number; purchases: number; stockInHand: number;
        netProfit: number;
        wkgCapTurnover: number | null;
        inventoryTurnover: number | null;
    };
    ratios: {
        currentRatio:    number | null;
        quickRatio:      number | null;
        debtEquity:      number | null;
        grossProfitPct:  number | null;
        netProfitPct:    number | null;
        opCostPct:       number | null;
        recvDays:        number | null;
        roiPct:          number | null;
        returnOnWcPct:   number | null;
    };
};

const num = (v: number | null, suffix = ""): string =>
    v === null || !Number.isFinite(v) ? "—" : `${v.toFixed(2)}${suffix}`;

const ratio = (v: number | null): string =>
    v === null || !Number.isFinite(v) ? "—" : `${v.toFixed(2)} : 1`;

export default function RatioAnalysisPage() {
    const [asOf, setAsOf] = useState(formatDateInput(new Date()));
    const [data, setData] = useState<RatioData | null>(null);
    const [loading, setLoading] = useState(false);

    const load = useCallback(() => {
        setLoading(true);
        axios.get<RatioData>(`/api/accountancy/reports/ratio-analysis?asOf=${asOf}`)
            .then((r) => setData(r.data))
            .catch(() => toast.error("Failed to load ratio analysis"))
            .finally(() => setLoading(false));
    }, [asOf]);

    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(load, [load]);

    return (
        <div className="max-w-6xl mx-auto space-y-5">
            <div className="flex items-end justify-between gap-3 flex-wrap">
                <div>
                    <h1 className="text-2xl font-bold text-foreground">Ratio Analysis</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        Principal-group balances and the standard nine ratios — period is the current Indian fiscal year up to the chosen date.
                    </p>
                </div>
                <div className="flex items-end gap-2">
                    <div className="space-y-1">
                        <Label>As on</Label>
                        <Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className="w-auto" />
                    </div>
                    <Button onClick={load}>Refresh</Button>
                </div>
            </div>

            {loading && (
                <div className="flex justify-center py-20">
                    <Loader2 className="animate-spin text-muted-foreground" size={28} />
                </div>
            )}

            {!loading && data && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                    {/* ── Principal Groups ─────────────────────────────────────── */}
                    <Panel title="Principal Groups">
                        <Row label="Working Capital" sub="Current Assets − Current Liabilities" value={fmt(data.principalGroups.workingCapital)} bold />
                        <Row label="Cash-in-Hand"   value={fmt(data.principalGroups.cashInHand)} />
                        <Row label="Bank Accounts"  value={fmt(data.principalGroups.bankAccounts)} />
                        <Row label="Bank OD A/c"    value={fmt(data.principalGroups.bankOd)} />
                        <Row label="Sundry Debtors"   sub="due till today" value={fmt(data.principalGroups.sundryDebtors)} />
                        <Row label="Sundry Creditors" sub="due till today" value={fmt(data.principalGroups.sundryCreditors)} />
                        <Row label="Sales Accounts"    value={fmt(data.principalGroups.sales)} />
                        <Row label="Purchase Accounts" value={fmt(data.principalGroups.purchases)} />
                        <Row label="Stock-in-Hand"     value={fmt(data.principalGroups.stockInHand)} />
                        <Row label="Nett Profit"       value={fmt(data.principalGroups.netProfit)} bold />
                        <Row label="Wkg. Capital Turnover" sub="Sales Accounts / Working Capital" value={num(data.principalGroups.wkgCapTurnover)} />
                        <Row label="Inventory Turnover"    sub="Sales Accounts / Closing Stock"  value={num(data.principalGroups.inventoryTurnover)} />
                    </Panel>

                    {/* ── Principal Ratios ─────────────────────────────────────── */}
                    <Panel title="Principal Ratios">
                        <Row label="Current Ratio" sub="Current Assets : Current Liabilities" value={ratio(data.ratios.currentRatio)} bold />
                        <Row label="Quick Ratio"   sub="(Current Assets − Stock-in-Hand) : Current Liabilities" value={ratio(data.ratios.quickRatio)} />
                        <Row label="Debt/Equity Ratio" sub="Loans (Liability) : Capital Account + Nett Profit" value={ratio(data.ratios.debtEquity)} />
                        <Row label="Gross Profit %"   value={num(data.ratios.grossProfitPct, " %")} />
                        <Row label="Nett Profit %"    value={num(data.ratios.netProfitPct, " %")} />
                        <Row label="Operating Cost %" sub="as percentage of Sales Accounts" value={num(data.ratios.opCostPct, " %")} />
                        <Row label="Recv. Turnover in days" sub="payment performance of Debtors" value={num(data.ratios.recvDays, " days")} />
                        <Row label="Return on Investment %" sub="Nett Profit / Capital Account + Nett Profit" value={num(data.ratios.roiPct, " %")} />
                        <Row label="Return on Wkg. Capital %" sub="(Nett Profit / Working Capital) %" value={num(data.ratios.returnOnWcPct, " %")} />
                    </Panel>
                </div>
            )}
        </div>
    );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div className="rounded-lg border border-border bg-card shadow-sm">
            <div className="border-b border-border px-4 py-2.5">
                <h2 className="font-semibold">{title}</h2>
            </div>
            <div className="divide-y divide-border">{children}</div>
        </div>
    );
}

function Row({
    label, sub, value, bold = false,
}: {
    label: string;
    sub?:  string;
    value: string;
    bold?: boolean;
}) {
    return (
        <div className="flex items-start justify-between gap-4 px-4 py-2.5">
            <div className="min-w-0">
                <div className={`text-sm ${bold ? "font-semibold text-foreground" : "text-foreground"}`}>{label}</div>
                {sub && <div className="text-xs text-muted-foreground italic">{sub}</div>}
            </div>
            <div className={`text-sm font-mono shrink-0 tabular-nums ${bold ? "font-bold" : "font-medium"}`}>{value}</div>
        </div>
    );
}
