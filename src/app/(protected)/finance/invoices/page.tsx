"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import Link from "next/link";
import { toast } from "sonner";
import { Plus, Loader2, ChevronRight } from "lucide-react";

interface Invoice {
    id: number;
    number: string;
    status: "DRAFT" | "SENT" | "PARTIAL" | "PAID" | "VOID";
    issueDate: string;
    dueDate: string;
    partyName: string;
    partyType: string;
    totalAmount: number;
    amountPaid: number;
    amountDue: number;
    createdBy: { name: string };
    _count: { lines: number; payments: number };
}

type LineInput = { description: string; quantity: string; unitPrice: string; taxRate: string };

const STATUS_COLORS: Record<string, string> = {
    DRAFT:   "bg-gray-100 text-gray-600",
    SENT:    "bg-blue-100 text-blue-700",
    PARTIAL: "bg-yellow-100 text-yellow-700",
    PAID:    "bg-green-100 text-green-700",
    VOID:    "bg-red-100 text-red-500",
};

function fmt(n: number) {
    return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2 }).format(n);
}

export default function InvoicesPage() {
    const [invoices, setInvoices] = useState<Invoice[]>([]);
    const [loading, setLoading] = useState(true);
    const [statusFilter, setStatusFilter] = useState("");
    const [showCreate, setShowCreate] = useState(false);
    const [saving, setSaving] = useState(false);

    const [form, setForm] = useState({
        partyName: "",
        partyType: "customer" as "customer" | "company",
        partyId: "",
        issueDate: new Date().toISOString().slice(0, 10),
        dueDate: "",
        notes: "",
        status: "DRAFT" as "DRAFT" | "SENT",
        lines: [{ description: "", quantity: "1", unitPrice: "", taxRate: "0" }] as LineInput[],
    });

    const load = () => {
        setLoading(true);
        const q = statusFilter ? `?status=${statusFilter}` : "";
        axios.get<Invoice[]>(`/api/finance/invoices${q}`)
            .then((r) => setInvoices(r.data))
            .catch(() => toast.error("Failed to load"))
            .finally(() => setLoading(false));
    };

    useEffect(load, [statusFilter]);

    const addLine = () => setForm((f) => ({
        ...f,
        lines: [...f.lines, { description: "", quantity: "1", unitPrice: "", taxRate: "0" }],
    }));

    const removeLine = (i: number) => setForm((f) => ({ ...f, lines: f.lines.filter((_, idx) => idx !== i) }));

    const updateLine = (i: number, patch: Partial<LineInput>) =>
        setForm((f) => ({ ...f, lines: f.lines.map((l, idx) => idx === i ? { ...l, ...patch } : l) }));

    const lineTotal = (l: LineInput) => {
        const sub = (parseFloat(l.quantity) || 0) * (parseFloat(l.unitPrice) || 0);
        return sub + sub * ((parseFloat(l.taxRate) || 0) / 100);
    };
    const grandTotal = form.lines.reduce((s, l) => s + lineTotal(l), 0);

    const submit = async () => {
        if (!form.partyName.trim()) { toast.error("Party name required"); return; }
        if (!form.partyId) { toast.error("Party ID required"); return; }
        if (!form.dueDate) { toast.error("Due date required"); return; }
        const lines = form.lines.map((l) => ({
            description: l.description,
            quantity: parseFloat(l.quantity),
            unitPrice: parseFloat(l.unitPrice),
            taxRate: parseFloat(l.taxRate) || 0,
        }));
        setSaving(true);
        try {
            await axios.post("/api/finance/invoices", {
                partyName: form.partyName,
                partyType: form.partyType,
                partyId: Number(form.partyId),
                issueDate: form.issueDate,
                dueDate: form.dueDate,
                notes: form.notes || undefined,
                status: form.status,
                lines,
            });
            toast.success(`Invoice created${form.status === "SENT" ? " & JE posted" : " as draft"}`);
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
                    <h1 className="text-2xl font-bold text-gray-900">Invoices</h1>
                    <p className="text-sm text-gray-500 mt-0.5">Customer billing records</p>
                </div>
                <button
                    onClick={() => setShowCreate((v) => !v)}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
                >
                    <Plus size={16} /> New Invoice
                </button>
            </div>

            {/* Status filters */}
            <div className="flex gap-2 flex-wrap">
                {(["", "DRAFT", "SENT", "PARTIAL", "PAID", "VOID"] as const).map((s) => (
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
                <div className="bg-white border rounded-xl p-5 shadow-sm space-y-5">
                    <h2 className="font-semibold text-gray-800">New Invoice</h2>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="text-xs font-medium text-gray-600">Party Type</label>
                            <select value={form.partyType} onChange={(e) => setForm((f) => ({ ...f, partyType: e.target.value as "customer" | "company" }))}
                                className="mt-1 block w-full border rounded-lg px-3 py-2 text-sm">
                                <option value="customer">Customer</option>
                                <option value="company">Company</option>
                            </select>
                        </div>
                        <div>
                            <label className="text-xs font-medium text-gray-600">Party ID</label>
                            <input type="number" value={form.partyId} onChange={(e) => setForm((f) => ({ ...f, partyId: e.target.value }))}
                                className="mt-1 block w-full border rounded-lg px-3 py-2 text-sm" placeholder="Customer or Company ID" />
                        </div>
                        <div className="col-span-2">
                            <label className="text-xs font-medium text-gray-600">Bill To (Name)</label>
                            <input value={form.partyName} onChange={(e) => setForm((f) => ({ ...f, partyName: e.target.value }))}
                                className="mt-1 block w-full border rounded-lg px-3 py-2 text-sm" placeholder="Customer or company name" />
                        </div>
                        <div>
                            <label className="text-xs font-medium text-gray-600">Issue Date</label>
                            <input type="date" value={form.issueDate} onChange={(e) => setForm((f) => ({ ...f, issueDate: e.target.value }))}
                                className="mt-1 block w-full border rounded-lg px-3 py-2 text-sm" />
                        </div>
                        <div>
                            <label className="text-xs font-medium text-gray-600">Due Date</label>
                            <input type="date" value={form.dueDate} onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
                                className="mt-1 block w-full border rounded-lg px-3 py-2 text-sm" />
                        </div>
                        <div className="col-span-2">
                            <label className="text-xs font-medium text-gray-600">Notes</label>
                            <textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                                rows={2} className="mt-1 block w-full border rounded-lg px-3 py-2 text-sm" placeholder="Optional" />
                        </div>
                    </div>

                    {/* Line items */}
                    <div className="border rounded-lg overflow-hidden">
                        <table className="w-full text-sm">
                            <thead className="bg-gray-50 text-xs text-gray-500">
                                <tr>
                                    <th className="px-3 py-2 text-left font-medium">Description</th>
                                    <th className="px-3 py-2 text-right font-medium w-20">Qty</th>
                                    <th className="px-3 py-2 text-right font-medium w-28">Unit Price</th>
                                    <th className="px-3 py-2 text-right font-medium w-20">Tax %</th>
                                    <th className="px-3 py-2 text-right font-medium w-28">Total</th>
                                    <th className="px-3 py-2 w-8" />
                                </tr>
                            </thead>
                            <tbody>
                                {form.lines.map((l, i) => (
                                    <tr key={i} className="border-t">
                                        <td className="px-3 py-2">
                                            <input value={l.description} onChange={(e) => updateLine(i, { description: e.target.value })}
                                                className="w-full border rounded px-2 py-1 text-sm" placeholder="Service description" />
                                        </td>
                                        <td className="px-3 py-2">
                                            <input type="number" min="0" step="0.001" value={l.quantity}
                                                onChange={(e) => updateLine(i, { quantity: e.target.value })}
                                                className="w-full border rounded px-2 py-1 text-sm text-right" />
                                        </td>
                                        <td className="px-3 py-2">
                                            <input type="number" min="0" step="0.01" value={l.unitPrice}
                                                onChange={(e) => updateLine(i, { unitPrice: e.target.value })}
                                                className="w-full border rounded px-2 py-1 text-sm text-right" placeholder="0.00" />
                                        </td>
                                        <td className="px-3 py-2">
                                            <input type="number" min="0" max="100" step="0.5" value={l.taxRate}
                                                onChange={(e) => updateLine(i, { taxRate: e.target.value })}
                                                className="w-full border rounded px-2 py-1 text-sm text-right" />
                                        </td>
                                        <td className="px-3 py-2 text-right font-mono text-gray-700">{fmt(lineTotal(l))}</td>
                                        <td className="px-3 py-2 text-center">
                                            {form.lines.length > 1 && (
                                                <button onClick={() => removeLine(i)} className="text-red-400 hover:text-red-600">×</button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot className="bg-gray-50 border-t font-semibold">
                                <tr>
                                    <td colSpan={4} className="px-3 py-2 text-right text-gray-600">Grand Total</td>
                                    <td className="px-3 py-2 text-right font-mono">{fmt(grandTotal)}</td>
                                    <td />
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                    <button onClick={addLine} className="text-sm text-blue-600 hover:underline">+ Add line</button>

                    <div className="flex items-center justify-between pt-2">
                        <div className="flex items-center gap-3">
                            <label className="text-sm font-medium text-gray-600">Create as</label>
                            <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as "DRAFT" | "SENT" }))}
                                className="border rounded-lg px-3 py-1.5 text-sm">
                                <option value="DRAFT">Draft (no JE yet)</option>
                                <option value="SENT">Sent (auto-post AR/Revenue JE)</option>
                            </select>
                        </div>
                        <div className="flex gap-2">
                            <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">Cancel</button>
                            <button onClick={submit} disabled={saving}
                                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
                                {saving && <Loader2 size={14} className="animate-spin" />} Create Invoice
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
                    {invoices.length === 0 ? (
                        <div className="text-center py-16 text-gray-400">No invoices yet</div>
                    ) : (
                        <table className="w-full text-sm">
                            <thead className="bg-gray-50 text-xs text-gray-500 border-b">
                                <tr>
                                    <th className="px-5 py-3 text-left font-medium">Invoice #</th>
                                    <th className="px-5 py-3 text-left font-medium">Billed To</th>
                                    <th className="px-5 py-3 text-left font-medium">Issue Date</th>
                                    <th className="px-5 py-3 text-left font-medium">Due Date</th>
                                    <th className="px-5 py-3 text-right font-medium">Total</th>
                                    <th className="px-5 py-3 text-right font-medium">Due</th>
                                    <th className="px-5 py-3 text-center font-medium">Status</th>
                                    <th className="px-5 py-3" />
                                </tr>
                            </thead>
                            <tbody>
                                {invoices.map((inv) => (
                                    <tr key={inv.id} className="border-b last:border-0 hover:bg-gray-50">
                                        <td className="px-5 py-3 font-mono text-blue-600">{inv.number}</td>
                                        <td className="px-5 py-3">
                                            <p className="font-medium text-gray-800">{inv.partyName}</p>
                                            <p className="text-xs text-gray-400 capitalize">{inv.partyType}</p>
                                        </td>
                                        <td className="px-5 py-3 text-gray-600">{new Date(inv.issueDate).toLocaleDateString()}</td>
                                        <td className="px-5 py-3 text-gray-600">{new Date(inv.dueDate).toLocaleDateString()}</td>
                                        <td className="px-5 py-3 text-right font-mono">{fmt(Number(inv.totalAmount))}</td>
                                        <td className="px-5 py-3 text-right font-mono text-orange-600">{fmt(Number(inv.amountDue))}</td>
                                        <td className="px-5 py-3 text-center">
                                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[inv.status]}`}>
                                                {inv.status}
                                            </span>
                                        </td>
                                        <td className="px-5 py-3 text-right">
                                            <Link href={`/finance/invoices/${inv.id}`} className="text-gray-300 hover:text-blue-600">
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
