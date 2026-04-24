"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Plus, Pencil, Check, X, Loader2, TrendingUp, TrendingDown } from "lucide-react";

type GlAccountType = "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";
type NormalBalance = "DEBIT" | "CREDIT";

interface GlAccount {
    id: number;
    code: string;
    name: string;
    type: GlAccountType;
    normalBalance: NormalBalance;
    description: string | null;
    isActive: boolean;
    balance: number;
    _count: { lines: number };
}

const TYPE_COLORS: Record<GlAccountType, string> = {
    ASSET:     "bg-blue-100 text-blue-700",
    LIABILITY: "bg-orange-100 text-orange-700",
    EQUITY:    "bg-purple-100 text-purple-700",
    REVENUE:   "bg-green-100 text-green-700",
    EXPENSE:   "bg-red-100 text-red-700",
};

const TYPE_ORDER: GlAccountType[] = ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"];

function fmt(n: number) {
    return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

export default function ChartOfAccountsPage() {
    const [accounts, setAccounts] = useState<GlAccount[]>([]);
    const [loading, setLoading] = useState(true);
    const [showAdd, setShowAdd] = useState(false);
    const [editingId, setEditingId] = useState<number | null>(null);
    const [editName, setEditName] = useState("");
    const [editDesc, setEditDesc] = useState("");
    const [saving, setSaving] = useState(false);

    const [newForm, setNewForm] = useState({
        code: "", name: "", type: "ASSET" as GlAccountType,
        normalBalance: "DEBIT" as NormalBalance, description: "",
    });

    const load = () => {
        setLoading(true);
        axios.get<GlAccount[]>("/api/finance/gl-accounts?activeOnly=false")
            .then((r) => setAccounts(r.data))
            .catch(() => toast.error("Failed to load accounts"))
            .finally(() => setLoading(false));
    };

    useEffect(load, []);

    const grouped = TYPE_ORDER.map((type) => ({
        type,
        rows: accounts.filter((a) => a.type === type),
    }));

    const startEdit = (a: GlAccount) => {
        setEditingId(a.id);
        setEditName(a.name);
        setEditDesc(a.description ?? "");
    };

    const saveEdit = async (id: number) => {
        setSaving(true);
        try {
            await axios.patch(`/api/finance/gl-accounts/${id}`, { name: editName, description: editDesc });
            toast.success("Updated");
            setEditingId(null);
            load();
        } catch {
            toast.error("Failed to update");
        } finally {
            setSaving(false);
        }
    };

    const toggleActive = async (a: GlAccount) => {
        if (a.isActive) {
            try {
                await axios.delete(`/api/finance/gl-accounts/${a.id}`);
                toast.success("Deactivated");
                load();
            } catch (err: unknown) {
                const msg = axios.isAxiosError(err) ? err.response?.data?.error : "Failed";
                toast.error(msg ?? "Failed");
            }
        } else {
            await axios.patch(`/api/finance/gl-accounts/${a.id}`, { isActive: true });
            toast.success("Activated");
            load();
        }
    };

    const addAccount = async () => {
        if (!newForm.code || !newForm.name) { toast.error("Code and name required"); return; }
        setSaving(true);
        try {
            await axios.post("/api/finance/gl-accounts", newForm);
            toast.success("Account created");
            setShowAdd(false);
            setNewForm({ code: "", name: "", type: "ASSET", normalBalance: "DEBIT", description: "" });
            load();
        } catch (err: unknown) {
            const msg = axios.isAxiosError(err) ? err.response?.data?.error : "Failed";
            toast.error(msg ?? "Failed to create account");
        } finally {
            setSaving(false);
        }
    };

    if (loading) return (
        <div className="flex items-center justify-center h-64">
            <Loader2 className="animate-spin text-gray-400" size={32} />
        </div>
    );

    return (
        <div className="max-w-5xl mx-auto space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Chart of Accounts</h1>
                    <p className="text-sm text-gray-500 mt-0.5">General Ledger master list</p>
                </div>
                <button
                    onClick={() => setShowAdd((v) => !v)}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
                >
                    <Plus size={16} /> New Account
                </button>
            </div>

            {/* Add form */}
            {showAdd && (
                <div className="bg-white border rounded-xl p-5 shadow-sm space-y-4">
                    <h2 className="font-semibold text-gray-800">New GL Account</h2>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="text-xs font-medium text-gray-600">Code</label>
                            <input
                                value={newForm.code}
                                onChange={(e) => setNewForm((f) => ({ ...f, code: e.target.value }))}
                                className="mt-1 block w-full border rounded-lg px-3 py-2 text-sm"
                                placeholder="e.g. 1100"
                            />
                        </div>
                        <div>
                            <label className="text-xs font-medium text-gray-600">Name</label>
                            <input
                                value={newForm.name}
                                onChange={(e) => setNewForm((f) => ({ ...f, name: e.target.value }))}
                                className="mt-1 block w-full border rounded-lg px-3 py-2 text-sm"
                                placeholder="Account name"
                            />
                        </div>
                        <div>
                            <label className="text-xs font-medium text-gray-600">Type</label>
                            <select
                                value={newForm.type}
                                onChange={(e) => {
                                    const t = e.target.value as GlAccountType;
                                    const nb: NormalBalance = ["ASSET", "EXPENSE"].includes(t) ? "DEBIT" : "CREDIT";
                                    setNewForm((f) => ({ ...f, type: t, normalBalance: nb }));
                                }}
                                className="mt-1 block w-full border rounded-lg px-3 py-2 text-sm"
                            >
                                {TYPE_ORDER.map((t) => <option key={t}>{t}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="text-xs font-medium text-gray-600">Normal Balance</label>
                            <select
                                value={newForm.normalBalance}
                                onChange={(e) => setNewForm((f) => ({ ...f, normalBalance: e.target.value as NormalBalance }))}
                                className="mt-1 block w-full border rounded-lg px-3 py-2 text-sm"
                            >
                                <option>DEBIT</option>
                                <option>CREDIT</option>
                            </select>
                        </div>
                        <div className="col-span-2">
                            <label className="text-xs font-medium text-gray-600">Description</label>
                            <input
                                value={newForm.description}
                                onChange={(e) => setNewForm((f) => ({ ...f, description: e.target.value }))}
                                className="mt-1 block w-full border rounded-lg px-3 py-2 text-sm"
                                placeholder="Optional"
                            />
                        </div>
                    </div>
                    <div className="flex gap-2 justify-end">
                        <button onClick={() => setShowAdd(false)} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">Cancel</button>
                        <button
                            onClick={addAccount}
                            disabled={saving}
                            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
                        >
                            {saving && <Loader2 size={14} className="animate-spin" />} Save
                        </button>
                    </div>
                </div>
            )}

            {/* Account groups */}
            {grouped.map(({ type, rows }) => rows.length === 0 ? null : (
                <div key={type} className="bg-white rounded-xl border shadow-sm overflow-hidden">
                    <div className={`px-5 py-3 flex items-center justify-between ${TYPE_COLORS[type].replace("text-", "border-b border-")} border-b`}>
                        <span className={`text-xs font-bold uppercase tracking-wider px-2 py-1 rounded-full ${TYPE_COLORS[type]}`}>{type}</span>
                        <span className="text-xs text-gray-400">{rows.length} accounts</span>
                    </div>
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-xs text-gray-400 border-b bg-gray-50">
                                <th className="px-5 py-2 text-left font-medium">Code</th>
                                <th className="px-5 py-2 text-left font-medium">Name</th>
                                <th className="px-5 py-2 text-left font-medium">Normal Balance</th>
                                <th className="px-5 py-2 text-right font-medium">Current Balance</th>
                                <th className="px-5 py-2 text-right font-medium">Entries</th>
                                <th className="px-5 py-2 text-center font-medium">Status</th>
                                <th className="px-5 py-2" />
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((a) => (
                                <tr key={a.id} className={`border-b last:border-0 hover:bg-gray-50 ${!a.isActive ? "opacity-50" : ""}`}>
                                    <td className="px-5 py-3 font-mono text-gray-700">{a.code}</td>
                                    <td className="px-5 py-3">
                                        {editingId === a.id ? (
                                            <input
                                                value={editName}
                                                onChange={(e) => setEditName(e.target.value)}
                                                className="border rounded px-2 py-1 text-sm w-full"
                                                autoFocus
                                            />
                                        ) : (
                                            <span className="font-medium text-gray-800">{a.name}</span>
                                        )}
                                        {a.description && editingId !== a.id && (
                                            <p className="text-xs text-gray-400 mt-0.5">{a.description}</p>
                                        )}
                                        {editingId === a.id && (
                                            <input
                                                value={editDesc}
                                                onChange={(e) => setEditDesc(e.target.value)}
                                                className="border rounded px-2 py-1 text-xs w-full mt-1"
                                                placeholder="Description"
                                            />
                                        )}
                                    </td>
                                    <td className="px-5 py-3">
                                        <span className="text-xs text-gray-500">{a.normalBalance}</span>
                                    </td>
                                    <td className="px-5 py-3 text-right font-mono">
                                        <span className={a.balance < 0 ? "text-red-600" : "text-gray-800"}>
                                            {a.balance < 0 && <TrendingDown size={12} className="inline mr-1" />}
                                            {a.balance > 0 && <TrendingUp size={12} className="inline mr-1 text-green-500" />}
                                            {fmt(a.balance)}
                                        </span>
                                    </td>
                                    <td className="px-5 py-3 text-right text-gray-400">{a._count.lines}</td>
                                    <td className="px-5 py-3 text-center">
                                        <span className={`text-xs px-2 py-0.5 rounded-full ${a.isActive ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                                            {a.isActive ? "Active" : "Inactive"}
                                        </span>
                                    </td>
                                    <td className="px-5 py-3 text-right">
                                        <div className="flex items-center gap-1 justify-end">
                                            {editingId === a.id ? (
                                                <>
                                                    <button onClick={() => saveEdit(a.id)} className="p-1.5 text-green-600 hover:bg-green-50 rounded" disabled={saving}>
                                                        {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                                                    </button>
                                                    <button onClick={() => setEditingId(null)} className="p-1.5 text-gray-400 hover:bg-gray-100 rounded">
                                                        <X size={14} />
                                                    </button>
                                                </>
                                            ) : (
                                                <>
                                                    <button onClick={() => startEdit(a)} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded">
                                                        <Pencil size={14} />
                                                    </button>
                                                    <button
                                                        onClick={() => toggleActive(a)}
                                                        className={`p-1.5 rounded text-xs ${a.isActive ? "text-red-400 hover:bg-red-50" : "text-green-600 hover:bg-green-50"}`}
                                                    >
                                                        {a.isActive ? <X size={14} /> : <Check size={14} />}
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            ))}
        </div>
    );
}
