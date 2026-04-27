"use client";

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { fmt, GL_TYPE_ORDER, type GlAccountType } from "@/utils/constants";

interface TrialBalanceRow {
    id: number;
    code: string;
    name: string;
    type: GlAccountType;
    normalBalance: "DEBIT" | "CREDIT";
    totalDebits: number;
    totalCredits: number;
    balance: number;
}

interface TrialBalanceData {
    asOf: string;
    rows: TrialBalanceRow[];
    totalDebits: number;
    totalCredits: number;
}

interface LedgerRow {
    id: number;
    date: string;
    reference: string;
    description: string;
    lineDescription: string | null;
    debit: number | null;
    credit: number | null;
    balance: number;
}

interface LedgerData {
    account: { id: number; code: string; name: string; normalBalance: string };
    from: string;
    to: string;
    openingBalance: number;
    closingBalance: number;
    rows: LedgerRow[];
}

interface GlAccount { id: number; code: string; name: string }

const TYPE_COLORS: Record<GlAccountType, string> = {
    ASSET:     "bg-blue-50 text-blue-700",
    LIABILITY: "bg-orange-50 text-orange-700",
    EQUITY:    "bg-purple-50 text-purple-700",
    REVENUE:   "bg-green-50 text-green-700",
    EXPENSE:   "bg-red-50 text-red-700",
};

type TabType = "trial-balance" | "ledger";

export default function ReportsPage() {
    const [tab, setTab] = useState<TabType>("trial-balance");
    const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10));
    const [tbData, setTbData] = useState<TrialBalanceData | null>(null);
    const [tbLoading, setTbLoading] = useState(false);

    const [accounts, setAccounts] = useState<GlAccount[]>([]);
    const [selectedAccount, setSelectedAccount] = useState("");
    const [ledgerFrom, setLedgerFrom] = useState(new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10));
    const [ledgerTo, setLedgerTo] = useState(new Date().toISOString().slice(0, 10));
    const [ledgerData, setLedgerData] = useState<LedgerData | null>(null);
    const [ledgerLoading, setLedgerLoading] = useState(false);

    useEffect(() => {
        axios.get<GlAccount[]>("/api/finance/gl-accounts")
            .then((r) => setAccounts(r.data))
            .catch(() => { });
    }, []);

    const loadTrialBalance = useCallback(() => {
        setTbLoading(true);
        axios.get<TrialBalanceData>(`/api/finance/reports/trial-balance?asOf=${asOf}`)
            .then((r) => setTbData(r.data))
            .catch(() => toast.error("Failed to load trial balance"))
            .finally(() => setTbLoading(false));
    }, [asOf]);

    const loadLedger = () => {
        if (!selectedAccount) { toast.error("Select an account"); return; }
        setLedgerLoading(true);
        axios.get<LedgerData>(`/api/finance/reports/ledger/${selectedAccount}?from=${ledgerFrom}&to=${ledgerTo}`)
            .then((r) => setLedgerData(r.data))
            .catch(() => toast.error("Failed to load ledger"))
            .finally(() => setLedgerLoading(false));
    };

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (tab === "trial-balance") loadTrialBalance();
    }, [tab, loadTrialBalance]);

    const grouped = TYPE_ORDER.map((type) => ({
        type,
        rows: tbData?.rows.filter((r) => r.type === type) ?? [],
    }));

    return (
        <div className="max-w-5xl mx-auto space-y-6">
            <div>
                <h1 className="text-2xl font-bold text-foreground">Financial Reports</h1>
                <p className="text-sm text-muted-foreground mt-0.5">Trial Balance &amp; General Ledger</p>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 border-b-2 border-border">
                {([["trial-balance", "Trial Balance"], ["ledger", "General Ledger"]] as [TabType, string][]).map(([key, label]) => (
                    <button
                        key={key}
                        onClick={() => setTab(key)}
                        className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-[2px] transition-colors ${
                            tab === key
                                ? "border-primary text-primary"
                                : "border-transparent text-muted-foreground hover:text-foreground"
                        }`}
                    >
                        {label}
                    </button>
                ))}
            </div>

            {/* Trial Balance */}
            {tab === "trial-balance" && (
                <div className="space-y-5">
                    <div className="flex items-end gap-3">
                        <div className="space-y-1">
                            <Label>As of Date</Label>
                            <Input
                                type="date"
                                value={asOf}
                                onChange={(e) => setAsOf(e.target.value)}
                                className="w-auto"
                            />
                        </div>
                        <Button onClick={loadTrialBalance}>Run Report</Button>
                    </div>

                    {tbLoading ? (
                        <div className="flex justify-center py-12">
                            <Loader2 className="animate-spin text-muted-foreground" size={28} />
                        </div>
                    ) : tbData ? (
                        <div className="space-y-4">
                            <p className="text-xs text-muted-foreground">
                                As at {new Date(tbData.asOf).toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })}
                            </p>

                            {grouped.map(({ type, rows }) => rows.length === 0 ? null : (
                                <div key={type} className="border-2 border-border shadow bg-card overflow-hidden">
                                    <div className={`px-5 py-2.5 border-b-2 border-border ${TYPE_COLORS[type]}`}>
                                        <span className="text-xs font-bold uppercase tracking-wider">{type}</span>
                                    </div>
                                    <table className="w-full text-sm">
                                        <thead className="text-xs text-muted-foreground bg-muted border-b-2 border-border">
                                            <tr>
                                                <th className="px-5 py-2 text-left font-medium">Code</th>
                                                <th className="px-5 py-2 text-left font-medium">Account</th>
                                                <th className="px-5 py-2 text-right font-medium">Total Debits</th>
                                                <th className="px-5 py-2 text-right font-medium">Total Credits</th>
                                                <th className="px-5 py-2 text-right font-medium">Balance</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {rows.map((r) => (
                                                <tr key={r.id} className="border-b last:border-0 hover:bg-muted/40">
                                                    <td className="px-5 py-3 font-mono text-muted-foreground">{r.code}</td>
                                                    <td className="px-5 py-3 font-medium text-foreground">{r.name}</td>
                                                    <td className="px-5 py-3 text-right font-mono">
                                                        {r.totalDebits > 0 ? fmt(r.totalDebits) : <span className="text-muted-foreground/40">—</span>}
                                                    </td>
                                                    <td className="px-5 py-3 text-right font-mono">
                                                        {r.totalCredits > 0 ? fmt(r.totalCredits) : <span className="text-muted-foreground/40">—</span>}
                                                    </td>
                                                    <td className={`px-5 py-3 text-right font-mono font-semibold ${r.balance < 0 ? "text-destructive" : "text-foreground"}`}>
                                                        {fmt(r.balance)}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            ))}

                            {/* Totals */}
                            <div className="border-2 border-border shadow bg-card p-5 flex justify-end gap-12 text-sm font-semibold">
                                <div className="text-right">
                                    <p className="text-xs text-muted-foreground mb-1">Total Debits</p>
                                    <p className="font-mono text-foreground">{fmt(tbData.totalDebits)}</p>
                                </div>
                                <div className="text-right">
                                    <p className="text-xs text-muted-foreground mb-1">Total Credits</p>
                                    <p className="font-mono text-foreground">{fmt(tbData.totalCredits)}</p>
                                </div>
                                <div className="text-right">
                                    <p className="text-xs text-muted-foreground mb-1">Difference</p>
                                    <p className={`font-mono ${Math.abs(tbData.totalDebits - tbData.totalCredits) < 0.005 ? "text-green-600" : "text-destructive"}`}>
                                        {fmt(Math.abs(tbData.totalDebits - tbData.totalCredits))}
                                        {Math.abs(tbData.totalDebits - tbData.totalCredits) < 0.005 && " ✓"}
                                    </p>
                                </div>
                            </div>
                        </div>
                    ) : null}
                </div>
            )}

            {/* General Ledger */}
            {tab === "ledger" && (
                <div className="space-y-5">
                    <div className="flex items-end gap-3 flex-wrap">
                        <div className="space-y-1">
                            <Label>Account</Label>
                            <Select value={selectedAccount} onValueChange={setSelectedAccount}>
                                <SelectTrigger className="min-w-56">
                                    <SelectValue placeholder="Select account" />
                                </SelectTrigger>
                                <SelectContent>
                                    {accounts.map((a) => (
                                        <SelectItem key={a.id} value={String(a.id)}>
                                            {a.code} — {a.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1">
                            <Label>From</Label>
                            <Input type="date" value={ledgerFrom} onChange={(e) => setLedgerFrom(e.target.value)} className="w-auto" />
                        </div>
                        <div className="space-y-1">
                            <Label>To</Label>
                            <Input type="date" value={ledgerTo} onChange={(e) => setLedgerTo(e.target.value)} className="w-auto" />
                        </div>
                        <Button onClick={loadLedger}>Run Report</Button>
                    </div>

                    {ledgerLoading ? (
                        <div className="flex justify-center py-12">
                            <Loader2 className="animate-spin text-muted-foreground" size={28} />
                        </div>
                    ) : ledgerData ? (
                        <div className="border-2 border-border shadow bg-card overflow-hidden">
                            <div className="px-5 py-3 border-b-2 border-border bg-muted flex items-center justify-between">
                                <div>
                                    <span className="font-mono text-muted-foreground mr-2">{ledgerData.account.code}</span>
                                    <span className="font-semibold text-foreground">{ledgerData.account.name}</span>
                                </div>
                                <div className="flex gap-8 text-sm">
                                    <div className="text-right">
                                        <p className="text-xs text-muted-foreground">Opening Balance</p>
                                        <p className="font-mono font-semibold">{fmt(ledgerData.openingBalance)}</p>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-xs text-muted-foreground">Closing Balance</p>
                                        <p className="font-mono font-semibold text-primary">{fmt(ledgerData.closingBalance)}</p>
                                    </div>
                                </div>
                            </div>
                            {ledgerData.rows.length === 0 ? (
                                <div className="text-center py-10 text-muted-foreground text-sm">No transactions in this period</div>
                            ) : (
                                <table className="w-full text-sm">
                                    <thead className="text-xs text-muted-foreground border-b-2 border-border bg-muted">
                                        <tr>
                                            <th className="px-5 py-2 text-left font-medium">Date</th>
                                            <th className="px-5 py-2 text-left font-medium">Reference</th>
                                            <th className="px-5 py-2 text-left font-medium">Description</th>
                                            <th className="px-5 py-2 text-right font-medium">Debit</th>
                                            <th className="px-5 py-2 text-right font-medium">Credit</th>
                                            <th className="px-5 py-2 text-right font-medium">Balance</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {ledgerData.rows.map((row) => (
                                            <tr key={row.id} className="border-b last:border-0 hover:bg-muted/40">
                                                <td className="px-5 py-3 text-muted-foreground whitespace-nowrap">{new Date(row.date).toLocaleDateString()}</td>
                                                <td className="px-5 py-3 font-mono text-primary">{row.reference}</td>
                                                <td className="px-5 py-3 text-foreground">
                                                    <p>{row.description}</p>
                                                    {row.lineDescription && <p className="text-xs text-muted-foreground">{row.lineDescription}</p>}
                                                </td>
                                                <td className="px-5 py-3 text-right font-mono">
                                                    {row.debit != null ? fmt(row.debit) : <span className="text-muted-foreground/40">—</span>}
                                                </td>
                                                <td className="px-5 py-3 text-right font-mono">
                                                    {row.credit != null ? fmt(row.credit) : <span className="text-muted-foreground/40">—</span>}
                                                </td>
                                                <td className={`px-5 py-3 text-right font-mono font-semibold ${row.balance < 0 ? "text-destructive" : "text-foreground"}`}>
                                                    {fmt(row.balance)}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    ) : null}
                </div>
            )}
        </div>
    );
}
