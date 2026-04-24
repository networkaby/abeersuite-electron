"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import axios from "axios";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Send, XCircle, Plus } from "lucide-react";
import Link from "next/link";

interface InvoiceLine {
    id: number;
    description: string;
    quantity: number;
    unitPrice: number;
    taxRate: number;
    taxAmount: number;
    amount: number;
}

interface Payment {
    id: number;
    amount: number;
    method: string;
    date: string;
    reference: string | null;
    notes: string | null;
    createdBy: { name: string };
    createdAt: string;
}

interface Invoice {
    id: number;
    number: string;
    status: "DRAFT" | "SENT" | "PARTIAL" | "PAID" | "VOID";
    issueDate: string;
    dueDate: string;
    partyName: string;
    partyType: string;
    partyId: number;
    notes: string | null;
    subtotal: number;
    taxAmount: number;
    totalAmount: number;
    amountPaid: number;
    amountDue: number;
    createdBy: { name: string };
    createdAt: string;
    lines: InvoiceLine[];
    payments: Payment[];
}

const STATUS_COLORS: Record<string, string> = {
    DRAFT:   "bg-gray-100 text-gray-600 border-gray-200",
    SENT:    "bg-blue-100 text-blue-700 border-blue-200",
    PARTIAL: "bg-yellow-100 text-yellow-700 border-yellow-200",
    PAID:    "bg-green-100 text-green-700 border-green-200",
    VOID:    "bg-red-100 text-red-500 border-red-200",
};

const PAYMENT_METHODS = ["CASH", "BANK_TRANSFER", "CARD", "CHEQUE", "MOBILE_PAYMENT", "OTHER"];

function fmt(n: number) {
    return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2 }).format(n);
}

export default function InvoiceDetailPage() {
    const { id } = useParams<{ id: string }>();
    const [invoice, setInvoice] = useState<Invoice | null>(null);
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);
    const [showVoid, setShowVoid] = useState(false);
    const [voidReason, setVoidReason] = useState("");
    const [voiding, setVoiding] = useState(false);
    const [showPayment, setShowPayment] = useState(false);
    const [payForm, setPayForm] = useState({
        amount: "", method: "CASH", date: new Date().toISOString().slice(0, 10),
        reference: "", notes: "", cashGlAccountCode: "1000",
    });
    const [paying, setPaying] = useState(false);

    const load = () => {
        setLoading(true);
        axios.get<Invoice>(`/api/finance/invoices/${id}`)
            .then((r) => setInvoice(r.data))
            .catch(() => toast.error("Failed to load"))
            .finally(() => setLoading(false));
    };

    useEffect(load, [id]);

    const sendInvoice = async () => {
        setSending(true);
        try {
            await axios.patch(`/api/finance/invoices/${id}`, { status: "SENT" });
            toast.success("Invoice sent — AR/Revenue JE posted");
            load();
        } catch (err: unknown) {
            const msg = axios.isAxiosError(err) ? err.response?.data?.error : "Failed";
            toast.error(msg ?? "Failed");
        } finally { setSending(false); }
    };

    const voidInvoice = async () => {
        if (!voidReason.trim()) { toast.error("Reason required"); return; }
        setVoiding(true);
        try {
            await axios.post(`/api/finance/invoices/${id}/void`, { reason: voidReason });
            toast.success("Invoice voided");
            setShowVoid(false);
            load();
        } catch (err: unknown) {
            const msg = axios.isAxiosError(err) ? err.response?.data?.error : "Failed";
            toast.error(msg ?? "Failed");
        } finally { setVoiding(false); }
    };

    const recordPayment = async () => {
        if (!payForm.amount || parseFloat(payForm.amount) <= 0) { toast.error("Amount required"); return; }
        setPaying(true);
        try {
            await axios.post(`/api/finance/invoices/${id}/payments`, {
                amount: parseFloat(payForm.amount),
                method: payForm.method,
                date: payForm.date,
                reference: payForm.reference || undefined,
                notes: payForm.notes || undefined,
                cashGlAccountCode: payForm.cashGlAccountCode,
            });
            toast.success("Payment recorded — JE posted");
            setShowPayment(false);
            setPayForm({ amount: "", method: "CASH", date: new Date().toISOString().slice(0, 10), reference: "", notes: "", cashGlAccountCode: "1000" });
            load();
        } catch (err: unknown) {
            const msg = axios.isAxiosError(err) ? err.response?.data?.error : "Failed";
            toast.error(msg ?? "Failed");
        } finally { setPaying(false); }
    };

    if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="animate-spin text-gray-400" size={32} /></div>;
    if (!invoice) return <div className="text-center py-24 text-gray-400">Not found</div>;

    const canSend = invoice.status === "DRAFT";
    const canPay  = ["SENT", "PARTIAL"].includes(invoice.status);
    const canVoid = !["VOID", "PAID"].includes(invoice.status);

    return (
        <div className="max-w-3xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex items-center gap-4">
                <Link href="/finance/invoices" className="text-gray-400 hover:text-gray-600"><ArrowLeft size={20} /></Link>
                <div className="flex-1">
                    <div className="flex items-center gap-3">
                        <h1 className="text-xl font-bold text-gray-900 font-mono">{invoice.number}</h1>
                        <span className={`text-xs px-2.5 py-1 rounded-full border font-medium ${STATUS_COLORS[invoice.status]}`}>{invoice.status}</span>
                    </div>
                    <p className="text-sm text-gray-500 mt-0.5">{invoice.partyName} · {invoice.partyType}</p>
                </div>
                <div className="flex gap-2">
                    {canSend && (
                        <button onClick={sendInvoice} disabled={sending}
                            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                            {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Send & Post JE
                        </button>
                    )}
                    {canPay && (
                        <button onClick={() => setShowPayment(true)}
                            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700">
                            <Plus size={14} /> Record Payment
                        </button>
                    )}
                    {canVoid && (
                        <button onClick={() => setShowVoid(true)}
                            className="flex items-center gap-2 px-4 py-2 border border-red-300 text-red-600 rounded-lg text-sm font-medium hover:bg-red-50">
                            <XCircle size={14} /> Void
                        </button>
                    )}
                </div>
            </div>

            {/* Summary cards */}
            <div className="grid grid-cols-3 gap-4">
                {[
                    { label: "Total", value: fmt(Number(invoice.totalAmount)), color: "text-gray-900" },
                    { label: "Paid", value: fmt(Number(invoice.amountPaid)), color: "text-green-700" },
                    { label: "Due", value: fmt(Number(invoice.amountDue)), color: "text-orange-600" },
                ].map(({ label, value, color }) => (
                    <div key={label} className="bg-white border rounded-xl p-4 text-center shadow-sm">
                        <p className="text-xs text-gray-400 mb-1">{label}</p>
                        <p className={`text-xl font-bold font-mono ${color}`}>{value}</p>
                    </div>
                ))}
            </div>

            {/* Meta */}
            <div className="bg-white rounded-xl border shadow-sm p-5 grid grid-cols-2 gap-4 text-sm">
                <div><p className="text-xs text-gray-400 mb-1">Issue Date</p><p className="font-medium">{new Date(invoice.issueDate).toLocaleDateString()}</p></div>
                <div><p className="text-xs text-gray-400 mb-1">Due Date</p><p className="font-medium">{new Date(invoice.dueDate).toLocaleDateString()}</p></div>
                <div><p className="text-xs text-gray-400 mb-1">Created by</p><p className="font-medium">{invoice.createdBy.name}</p></div>
                {invoice.notes && <div className="col-span-2"><p className="text-xs text-gray-400 mb-1">Notes</p><p>{invoice.notes}</p></div>}
            </div>

            {/* Line items */}
            <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
                <div className="px-5 py-3 border-b bg-gray-50">
                    <h3 className="text-sm font-semibold text-gray-700">Line Items</h3>
                </div>
                <table className="w-full text-sm">
                    <thead className="text-xs text-gray-500 border-b">
                        <tr>
                            <th className="px-5 py-2 text-left font-medium">Description</th>
                            <th className="px-5 py-2 text-right font-medium">Qty</th>
                            <th className="px-5 py-2 text-right font-medium">Unit Price</th>
                            <th className="px-5 py-2 text-right font-medium">Tax</th>
                            <th className="px-5 py-2 text-right font-medium">Total</th>
                        </tr>
                    </thead>
                    <tbody>
                        {invoice.lines.map((l) => (
                            <tr key={l.id} className="border-b last:border-0">
                                <td className="px-5 py-3 text-gray-800">{l.description}</td>
                                <td className="px-5 py-3 text-right">{Number(l.quantity)}</td>
                                <td className="px-5 py-3 text-right font-mono">{fmt(Number(l.unitPrice))}</td>
                                <td className="px-5 py-3 text-right text-gray-400">{Number(l.taxRate)}%</td>
                                <td className="px-5 py-3 text-right font-mono font-medium">{fmt(Number(l.amount))}</td>
                            </tr>
                        ))}
                    </tbody>
                    <tfoot className="bg-gray-50 border-t text-sm font-semibold">
                        <tr><td colSpan={4} className="px-5 py-2 text-right text-gray-500">Subtotal</td><td className="px-5 py-2 text-right font-mono">{fmt(Number(invoice.subtotal))}</td></tr>
                        {Number(invoice.taxAmount) > 0 && <tr><td colSpan={4} className="px-5 py-2 text-right text-gray-500">Tax</td><td className="px-5 py-2 text-right font-mono">{fmt(Number(invoice.taxAmount))}</td></tr>}
                        <tr><td colSpan={4} className="px-5 py-2 text-right text-gray-800">Total</td><td className="px-5 py-2 text-right font-mono text-gray-900">{fmt(Number(invoice.totalAmount))}</td></tr>
                    </tfoot>
                </table>
            </div>

            {/* Payments */}
            {invoice.payments.length > 0 && (
                <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
                    <div className="px-5 py-3 border-b bg-gray-50">
                        <h3 className="text-sm font-semibold text-gray-700">Payments Received</h3>
                    </div>
                    <table className="w-full text-sm">
                        <thead className="text-xs text-gray-500 border-b">
                            <tr>
                                <th className="px-5 py-2 text-left font-medium">Date</th>
                                <th className="px-5 py-2 text-left font-medium">Method</th>
                                <th className="px-5 py-2 text-left font-medium">Reference</th>
                                <th className="px-5 py-2 text-right font-medium">Amount</th>
                                <th className="px-5 py-2 text-left font-medium">By</th>
                            </tr>
                        </thead>
                        <tbody>
                            {invoice.payments.map((p) => (
                                <tr key={p.id} className="border-b last:border-0">
                                    <td className="px-5 py-3">{new Date(p.date).toLocaleDateString()}</td>
                                    <td className="px-5 py-3 capitalize">{p.method.replace(/_/g, " ")}</td>
                                    <td className="px-5 py-3 text-gray-400">{p.reference ?? "—"}</td>
                                    <td className="px-5 py-3 text-right font-mono font-semibold text-green-700">{fmt(Number(p.amount))}</td>
                                    <td className="px-5 py-3 text-gray-400 text-xs">{p.createdBy.name}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Payment modal */}
            {showPayment && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md space-y-4">
                        <h3 className="font-semibold text-gray-900">Record Payment</h3>
                        <p className="text-sm text-gray-500">Amount due: <strong>{fmt(Number(invoice.amountDue))}</strong></p>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="col-span-2">
                                <label className="text-xs font-medium text-gray-600">Amount</label>
                                <input type="number" min="0" step="0.01" value={payForm.amount}
                                    onChange={(e) => setPayForm((f) => ({ ...f, amount: e.target.value }))}
                                    className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" placeholder="0.00" />
                            </div>
                            <div>
                                <label className="text-xs font-medium text-gray-600">Payment Method</label>
                                <select value={payForm.method} onChange={(e) => setPayForm((f) => ({ ...f, method: e.target.value }))}
                                    className="mt-1 w-full border rounded-lg px-3 py-2 text-sm">
                                    {PAYMENT_METHODS.map((m) => <option key={m}>{m}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="text-xs font-medium text-gray-600">Date</label>
                                <input type="date" value={payForm.date} onChange={(e) => setPayForm((f) => ({ ...f, date: e.target.value }))}
                                    className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" />
                            </div>
                            <div>
                                <label className="text-xs font-medium text-gray-600">Debit GL Account</label>
                                <select value={payForm.cashGlAccountCode} onChange={(e) => setPayForm((f) => ({ ...f, cashGlAccountCode: e.target.value }))}
                                    className="mt-1 w-full border rounded-lg px-3 py-2 text-sm">
                                    <option value="1000">1000 — Cash</option>
                                    <option value="1010">1010 — Bank Account</option>
                                </select>
                            </div>
                            <div>
                                <label className="text-xs font-medium text-gray-600">Reference</label>
                                <input value={payForm.reference} onChange={(e) => setPayForm((f) => ({ ...f, reference: e.target.value }))}
                                    className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" placeholder="Cheque / bank ref" />
                            </div>
                            <div className="col-span-2">
                                <label className="text-xs font-medium text-gray-600">Notes</label>
                                <input value={payForm.notes} onChange={(e) => setPayForm((f) => ({ ...f, notes: e.target.value }))}
                                    className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" placeholder="Optional" />
                            </div>
                        </div>
                        <div className="flex gap-2 justify-end">
                            <button onClick={() => setShowPayment(false)} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">Cancel</button>
                            <button onClick={recordPayment} disabled={paying}
                                className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center gap-2">
                                {paying && <Loader2 size={14} className="animate-spin" />} Record Payment
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Void modal */}
            {showVoid && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md space-y-4">
                        <h3 className="font-semibold text-gray-900">Void Invoice</h3>
                        <p className="text-sm text-gray-600">This will reverse all posted journal entries for this invoice.</p>
                        <div>
                            <label className="text-xs font-medium text-gray-600">Reason</label>
                            <textarea value={voidReason} onChange={(e) => setVoidReason(e.target.value)}
                                rows={3} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" placeholder="Reason..." />
                        </div>
                        <div className="flex gap-2 justify-end">
                            <button onClick={() => setShowVoid(false)} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">Cancel</button>
                            <button onClick={voidInvoice} disabled={voiding}
                                className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 flex items-center gap-2">
                                {voiding && <Loader2 size={14} className="animate-spin" />} Confirm Void
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
