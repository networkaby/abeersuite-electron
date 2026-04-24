"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

type GlAccountType = "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";

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

const TYPE_ORDER: GlAccountType[] = ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"];
const TYPE_COLORS: Record<GlAccountType, string> = {
    ASSET:     "bg-blue-50 text-blue-700",
    LIABILITY: "bg-orange-50 text-orange-700",
    EQUITY:    "bg-purple-50 text-purple-700",
    REVENUE:   "bg-green-50 text-green-700",
    EXPENSE:   "bg-red-50 text-red-700",
};

function fmt(n: number) {
    return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2 }).format(n);
}

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

    const loadTrialBalance = () => {
        setTbLoading(true);
        axios.get<TrialBalanceData>(`/api/finance/reports/trial-balance?asOf=${asOf}`)
            .then((r) => setTbData(r.data))
            .catch(() => toast.error("Failed to load trial balance"))
            .finally(() => setTbLoading(false));
    };

    const loadLedger = () => {
        if (!selectedAccount) { toast.error("Select an account"); return; }
        setLedgerLoading(true);
        axios.get<LedgerData>(`/api/finance/reports/ledger/${selectedAccount}?from=${ledgerFrom}&to=${ledgerTo}`)
            .then((r) => setLedgerData(r.data))
            .catch(() => toast.error("Failed to load ledger"))
            .finally(() => setLedgerLoading(false));
    };

    useEffect(() => {
        if (tab === "trial-balance") loadTrialBalance();
    }, [tab]);

    const grouped = TYPE_ORDER.map((type) => ({
        type,
        rows: tbData?.rows.filter((r) => r.type === type) ?? [],
    }));

    return (
        <div className="max-w-5xl mx-auto space-y-6">
            <div>
                <h1 className="text-2xl font-bold text-gray-900">Financial Reports</h1>
                <p className="text-sm text-gray-500 mt-0.5">Trial Balance & General Ledger</p>
            </div>

            {/* Tabs */}
            <div className="flex gap-2 border-b">
                {([["trial-balance", "Trial Balance"], ["ledger", "General Ledger"]] as [TabType, string][]).map(([key, label]) => (
                    <button
                        key={key}
                        onClick={() => setTab(key)}
                        className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${tab === key ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700"}`}
                    >
                        {label}
                    </button>
                ))}
            </div>

            {/* Trial Balance */}
            {tab === "trial-balance" && (
                <div className="space-y-5">
                    <div className="flex items-end gap-3">
                        <div>
                            <label className="text-xs font-medium text-gray-600">As of Date</label>
                            <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)}
                                className="mt-1 block border rounded-lg px-3 py-2 text-sm" />
                        </div>
                        <button onClick={loadTrialBalance}
                            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
                            Run Report
                        </button>
                    </div>

                    {tbLoading ? (
                        <div className="flex justify-center py-12"><Loader2 className="animate-spin text-gray-400" size={28} /></div>
                    ) : tbData ? (
                        <div className="space-y-4">
                            <p className="text-xs text-gray-400">As at {new Date(tbData.asOf).toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })}</p>

                            {grouped.map(({ type, rows }) => rows.length === 0 ? null : (
                                <div key={type} className="bg-white rounded-xl border shadow-sm overflow-hidden">
                                    <div className={`px-5 py-2.5 border-b ${TYPE_COLORS[type]}`}>
                                        <span className="text-xs font-bold uppercase tracking-wider">{type}</span>
                                    </div>
                                    <table className="w-full text-sm">
                                        <thead className="text-xs text-gray-400 bg-gray-50 border-b">
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
                                                <tr key={r.id} className="border-b last:border-0 hover:bg-gray-50">
                                                    <td className="px-5 py-3 font-mono text-gray-500">{r.code}</td>
                                                    <td className="px-5 py-3 font-medium text-gray-800">{r.name}</td>
                                                    <td className="px-5 py-3 text-right font-mono">{r.totalDebits > 0 ? fmt(r.totalDebits) : <span className="text-gray-300">—</span>}</td>
                                                    <td className="px-5 py-3 text-right font-mono">{r.totalCredits > 0 ? fmt(r.totalCredits) : <span className="text-gray-300">—</span>}</td>
                                                    <td className={`px-5 py-3 text-right font-mono font-semibold ${r.balance < 0 ? "text-red-600" : "text-gray-900"}`}>
                                                        {fmt(r.balance)}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            ))}

                            {/* Totals */}
                            <div className="bg-white rounded-xl border shadow-sm p-5 flex justify-end gap-12 text-sm font-semibold">
                                <div className="text-right">
                                    <p className="text-xs text-gray-400 mb-1">Total Debits</p>
                                    <p className="font-mono text-gray-900">{fmt(tbData.totalDebits)}</p>
                                </div>
                                <div className="text-right">
                                    <p className="text-xs text-gray-400 mb-1">Total Credits</p>
                                    <p className="font-mono text-gray-900">{fmt(tbData.totalCredits)}</p>
                                </div>
                                <div className="text-right">
                                    <p className="text-xs text-gray-400 mb-1">Difference</p>
                                    <p className={`font-mono ${Math.abs(tbData.totalDebits - tbData.totalCredits) < 0.005 ? "text-green-600" : "text-red-600"}`}>
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
                        <div>
                            <label className="text-xs font-medium text-gray-600">Account</label>
                            <select value={selectedAccount} onChange={(e) => setSelectedAccount(e.target.value)}
                                className="mt-1 block border rounded-lg px-3 py-2 text-sm min-w-56">
                                <option value="">Select account</option>
                                {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="text-xs font-medium text-gray-600">From</label>
                            <input type="date" value={ledgerFrom} onChange={(e) => setLedgerFrom(e.target.value)}
                                className="mt-1 block border rounded-lg px-3 py-2 text-sm" />
                        </div>
                        <div>
                            <label className="text-xs font-medium text-gray-600">To</label>
                            <input type="date" value={ledgerTo} onChange={(e) => setLedgerTo(e.target.value)}
                                className="mt-1 block border rounded-lg px-3 py-2 text-sm" />
                        </div>
                        <button onClick={loadLedger}
                            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
                            Run Report
                        </button>
                    </div>

                    {ledgerLoading ? (
                        <div className="flex justify-center py-12"><Loader2 className="animate-spin text-gray-400" size={28} /></div>
                    ) : ledgerData ? (
                        <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
                            <div className="px-5 py-3 border-b bg-gray-50 flex items-center justify-between">
                                <div>
                                    <span className="font-mono text-gray-500 mr-2">{ledgerData.account.code}</span>
                                    <span className="font-semibold text-gray-800">{ledgerData.account.name}</span>
                                </div>
                                <div className="flex gap-8 text-sm">
                                    <div className="text-right">
                                        <p className="text-xs text-gray-400">Opening Balance</p>
                                        <p className="font-mono font-semibold">{fmt(ledgerData.openingBalance)}</p>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-xs text-gray-400">Closing Balance</p>
                                        <p className="font-mono font-semibold text-blue-700">{fmt(ledgerData.closingBalance)}</p>
                                    </div>
                                </div>
                            </div>
                            {ledgerData.rows.length === 0 ? (
                                <div className="text-center py-10 text-gray-400 text-sm">No transactions in this period</div>
                            ) : (
                                <table className="w-full text-sm">
                                    <thead className="text-xs text-gray-400 border-b bg-gray-50">
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
                                            <tr key={row.id} className="border-b last:border-0 hover:bg-gray-50">
                                                <td className="px-5 py-3 text-gray-600 whitespace-nowrap">{new Date(row.date).toLocaleDateString()}</td>
                                                <td className="px-5 py-3 font-mono text-blue-600">{row.reference}</td>
                                                <td className="px-5 py-3 text-gray-700">
                                                    <p>{row.description}</p>
                                                    {row.lineDescription && <p className="text-xs text-gray-400">{row.lineDescription}</p>}
                                                </td>
                                                <td className="px-5 py-3 text-right font-mono">
                                                    {row.debit != null ? fmt(row.debit) : <span className="text-gray-300">—</span>}
                                                </td>
                                                <td className="px-5 py-3 text-right font-mono">
                                                    {row.credit != null ? fmt(row.credit) : <span className="text-gray-300">—</span>}
                                                </td>
                                                <td className={`px-5 py-3 text-right font-mono font-semibold ${row.balance < 0 ? "text-red-600" : "text-gray-900"}`}>
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
