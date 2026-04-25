"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import Link from "next/link";
import { toast } from "sonner";
import { Plus, Loader2, ChevronRight } from "lucide-react";

interface JournalEntry {
    id: number;
    date: string;
    reference: string;
    description: string;
    status: "DRAFT" | "POSTED" | "VOIDED";
    totalDebit: number;
    _count: { lines: number };
    createdBy: { name: string };
}

type LineInput = { accountId: number; type: "DEBIT" | "CREDIT"; amount: string; description: string };

interface GlAccount { id: number; code: string; name: string; type: string }

const STATUS_COLORS = {
    DRAFT:  "bg-yellow-100 text-yellow-700",
    POSTED: "bg-green-100 text-green-700",
    VOIDED: "bg-gray-100 text-gray-500",
};

function fmt(n: number) {
    return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2 }).format(n);
}

export default function JournalEntriesPage() {
    const [entries, setEntries] = useState<JournalEntry[]>([]);
    const [accounts, setAccounts] = useState<GlAccount[]>([]);
    const [loading, setLoading] = useState(true);
    const [showCreate, setShowCreate] = useState(false);
    const [saving, setSaving] = useState(false);
    const [statusFilter, setStatusFilter] = useState("");

    const [form, setForm] = useState({
        date: new Date().toISOString().slice(0, 10),
        description: "",
        lines: [
            { accountId: 0, type: "DEBIT" as "DEBIT" | "CREDIT", amount: "", description: "" },
            { accountId: 0, type: "CREDIT" as "DEBIT" | "CREDIT", amount: "", description: "" },
        ] as LineInput[],
    });

    const load = () => {
        setLoading(true);
        const q = statusFilter ? `?status=${statusFilter}` : "";
        axios.get<JournalEntry[]>(`/api/finance/journal-entries${q}`)
            .then((r) => setEntries(r.data))
            .catch(() => toast.error("Failed to load"))
            .finally(() => setLoading(false));
    };

    useEffect(load, [statusFilter]);

    useEffect(() => {
        axios.get<GlAccount[]>("/api/finance/gl-accounts")
            .then((r) => setAccounts(r.data))
            .catch(() => { });
    }, []);

    const addLine = () => setForm((f) => ({
        ...f,
        lines: [...f.lines, { accountId: 0, type: "DEBIT", amount: "", description: "" }],
    }));

    const removeLine = (i: number) => setForm((f) => ({ ...f, lines: f.lines.filter((_, idx) => idx !== i) }));

    const updateLine = (i: number, patch: Partial<LineInput>) =>
        setForm((f) => ({ ...f, lines: f.lines.map((l, idx) => idx === i ? { ...l, ...patch } : l) }));

    const totalDebits = form.lines.filter((l) => l.type === "DEBIT").reduce((s, l) => s + (parseFloat(l.amount) || 0), 0);
    const totalCredits = form.lines.filter((l) => l.type === "CREDIT").reduce((s, l) => s + (parseFloat(l.amount) || 0), 0);
    const balanced = Math.abs(totalDebits - totalCredits) < 0.005;

    const submit = async () => {
        if (!form.description.trim()) { toast.error("Description required"); return; }
        if (!balanced) { toast.error("Debits must equal credits"); return; }
        const lines = form.lines.map((l) => ({
            accountId: Number(l.accountId),
            type: l.type,
            amount: parseFloat(l.amount),
            description: l.description || undefined,
        }));
        setSaving(true);
        try {
            await axios.post("/api/finance/journal-entries", { date: form.date, description: form.description, lines });
            toast.success("Journal entry created");
            setShowCreate(false);
            load();
        } catch (err: unknown) {
            const msg = axios.isAxiosError(err) ? err.response?.data?.error : "Failed";
            toast.error(msg ?? "Failed");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="max-w-5xl mx-auto space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Journal Entries</h1>
                    <p className="text-sm text-gray-500 mt-0.5">Double-entry bookkeeping records</p>
                </div>
                <button
                    onClick={() => setShowCreate((v) => !v)}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
                >
                    <Plus size={16} /> New Entry
                </button>
            </div>

            {/* Filters */}
            <div className="flex gap-2">
                {(["", "DRAFT", "POSTED", "VOIDED"] as const).map((s) => (
                    <button
                        key={s}
                        onClick={() => setStatusFilter(s)}
                        className={`px-3 py-1.5 text-xs rounded-lg border font-medium transition-colors ${statusFilter === s ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600 hover:bg-gray-50"}`}
                    >
                        {s || "All"}
                    </button>
                ))}
            </div>

            {/* Create form */}
            {showCreate && (
                <div className="bg-white border rounded-xl p-5 shadow-sm space-y-4">
                    <h2 className="font-semibold text-gray-800">New Journal Entry</h2>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="text-xs font-medium text-gray-600">Date</label>
                            <input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                                className="mt-1 block w-full border rounded-lg px-3 py-2 text-sm" />
                        </div>
                        <div>
                            <label className="text-xs font-medium text-gray-600">Description</label>
                            <input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                                className="mt-1 block w-full border rounded-lg px-3 py-2 text-sm" placeholder="Narration" />
                        </div>
                    </div>

                    {/* Lines */}
                    <div className="border rounded-lg overflow-hidden">
                        <table className="w-full text-sm">
                            <thead className="bg-gray-50 text-xs text-gray-500">
                                <tr>
                                    <th className="px-3 py-2 text-left font-medium">Account</th>
                                    <th className="px-3 py-2 text-left font-medium w-24">Type</th>
                                    <th className="px-3 py-2 text-right font-medium w-32">Amount</th>
                                    <th className="px-3 py-2 text-left font-medium">Note</th>
                                    <th className="px-3 py-2 w-8" />
                                </tr>
                            </thead>
                            <tbody>
                                {form.lines.map((line, i) => (
                                    <tr key={i} className="border-t">
                                        <td className="px-3 py-2">
                                            <select
                                                value={line.accountId}
                                                onChange={(e) => updateLine(i, { accountId: Number(e.target.value) })}
                                                className="w-full border rounded px-2 py-1 text-sm"
                                            >
                                                <option value={0}>Select account</option>
                                                {accounts.map((a) => (
                                                    <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                                                ))}
                                            </select>
                                        </td>
                                        <td className="px-3 py-2">
                                            <select
                                                value={line.type}
                                                onChange={(e) => updateLine(i, { type: e.target.value as "DEBIT" | "CREDIT" })}
                                                className="w-full border rounded px-2 py-1 text-sm"
                                            >
                                                <option>DEBIT</option>
                                                <option>CREDIT</option>
                                            </select>
                                        </td>
                                        <td className="px-3 py-2">
                                            <input
                                                type="number" min="0" step="0.01"
                                                value={line.amount}
                                                onChange={(e) => updateLine(i, { amount: e.target.value })}
                                                className="w-full border rounded px-2 py-1 text-sm text-right"
                                                placeholder="0.00"
                                            />
                                        </td>
                                        <td className="px-3 py-2">
                                            <input value={line.description} onChange={(e) => updateLine(i, { description: e.target.value })}
                                                className="w-full border rounded px-2 py-1 text-sm" placeholder="Optional" />
                                        </td>
                                        <td className="px-3 py-2 text-center">
                                            {form.lines.length > 2 && (
                                                <button onClick={() => removeLine(i)} className="text-red-400 hover:text-red-600">
                                                    ×
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot className="bg-gray-50 border-t text-xs font-medium">
                                <tr>
                                    <td colSpan={2} className="px-3 py-2 text-gray-500">Totals</td>
                                    <td className="px-3 py-2 text-right">
                                        <div className={balanced ? "text-green-600" : "text-red-600"}>
                                            DR {fmt(totalDebits)} / CR {fmt(totalCredits)}
                                        </div>
                                        {!balanced && <div className="text-red-500">Not balanced</div>}
                                    </td>
                                    <td colSpan={2} />
                                </tr>
                            </tfoot>
                        </table>
                    </div>

                    <div className="flex items-center justify-between">
                        <button onClick={addLine} className="text-sm text-blue-600 hover:underline">+ Add line</button>
                        <div className="flex gap-2">
                            <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">Cancel</button>
                            <button
                                onClick={submit}
                                disabled={saving || !balanced}
                                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
                            >
                                {saving && <Loader2 size={14} className="animate-spin" />} Save as Draft
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* List */}
            {loading ? (
                <div className="flex justify-center py-12"><Loader2 className="animate-spin text-gray-400" size={28} /></div>
            ) : (
                <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
                    {entries.length === 0 ? (
                        <div className="text-center py-16 text-gray-400">No journal entries yet</div>
                    ) : (
                        <table className="w-full text-sm">
                            <thead className="bg-gray-50 text-xs text-gray-500 border-b">
                                <tr>
                                    <th className="px-5 py-3 text-left font-medium">Reference</th>
                                    <th className="px-5 py-3 text-left font-medium">Date</th>
                                    <th className="px-5 py-3 text-left font-medium">Description</th>
                                    <th className="px-5 py-3 text-right font-medium">Amount</th>
                                    <th className="px-5 py-3 text-center font-medium">Status</th>
                                    <th className="px-5 py-3 text-left font-medium">By</th>
                                    <th className="px-5 py-3" />
                                </tr>
                            </thead>
                            <tbody>
                                {entries.map((e) => (
                                    <tr key={e.id} className="border-b last:border-0 hover:bg-gray-50">
                                        <td className="px-5 py-3 font-mono text-blue-600">{e.reference}</td>
                                        <td className="px-5 py-3 text-gray-600">{new Date(e.date).toLocaleDateString()}</td>
                                        <td className="px-5 py-3 text-gray-700">{e.description}</td>
                                        <td className="px-5 py-3 text-right font-mono">{fmt(e.totalDebit)}</td>
                                        <td className="px-5 py-3 text-center">
                                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[e.status]}`}>
                                                {e.status}
                                            </span>
                                        </td>
                                        <td className="px-5 py-3 text-gray-400 text-xs">{e.createdBy.name}</td>
                                        <td className="px-5 py-3 text-right">
                                            <Link href={`/finance/journal-entries/${e.id}`} className="text-gray-300 hover:text-blue-600">
                                                <ChevronRight size={16} />
                                            </Link>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            )}
        </div>
    );
}
