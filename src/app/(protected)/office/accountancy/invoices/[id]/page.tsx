"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useSession } from "next-auth/react";
import axios from "axios";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Send, Plus } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Dialog, DialogContent, DialogHeader, DialogTitle,
    DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { fmt } from "@/utils/constants";
import { LifecycleActions } from "@/modules/accountancy/components/LifecycleActions";
import { hasPermissionWithScope } from "@/shared/lib/auth/permissionScope";

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
    DRAFT:   "bg-muted text-muted-foreground border-border",
    SENT:    "bg-blue-100 text-blue-700 border-blue-200",
    PARTIAL: "bg-yellow-100 text-yellow-700 border-yellow-200",
    PAID:    "bg-green-100 text-green-700 border-green-200",
    VOID:    "bg-destructive/10 text-destructive border-destructive/20",
};

const PAYMENT_METHODS = ["CASH", "BANK_TRANSFER", "CARD", "CHEQUE", "MOBILE_PAYMENT", "OTHER"];


export default function InvoiceDetailPage() {
    const { id } = useParams<{ id: string }>();
    const { data: session } = useSession();
    const permissions = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    const canCancel     = hasPermissionWithScope(permissions, "finance:invoice:cancel");
    const canDelete     = hasPermissionWithScope(permissions, "finance:invoice:delete");
    const canHardDelete = hasPermissionWithScope(permissions, "finance:invoice:hard-delete");

    const [invoice, setInvoice] = useState<Invoice | null>(null);
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);
    const [showPayment, setShowPayment] = useState(false);
    const [payForm, setPayForm] = useState({
        amount: "", method: "CASH", date: new Date().toISOString().slice(0, 10),
        reference: "", notes: "", cashGlAccountCode: "1000",
    });
    const [paying, setPaying] = useState(false);

    const load = () => {
        setLoading(true);
        axios.get<Invoice>(`/api/accountancy/invoices/${id}`)
            .then((r) => setInvoice(r.data))
            .catch(() => toast.error("Failed to load"))
            .finally(() => setLoading(false));
    };

    useEffect(load, [id]);

    const sendInvoice = async () => {
        setSending(true);
        try {
            await axios.patch(`/api/accountancy/invoices/${id}`, { status: "SENT" });
            toast.success("Invoice sent — AR/Revenue JE posted");
            load();
        } catch (err: unknown) {
            const msg = axios.isAxiosError(err) ? err.response?.data?.error : "Failed";
            toast.error(msg ?? "Failed");
        } finally { setSending(false); }
    };

    const recordPayment = async () => {
        if (!payForm.amount || parseFloat(payForm.amount) <= 0) { toast.error("Amount required"); return; }
        setPaying(true);
        try {
            await axios.post(`/api/accountancy/invoices/${id}/payments`, {
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

    if (loading) return (
        <div className="flex items-center justify-center h-64">
            <Loader2 className="animate-spin text-muted-foreground" size={32} />
        </div>
    );
    if (!invoice) return <div className="text-center py-24 text-muted-foreground">Not found</div>;

    const canSend = invoice.status === "DRAFT";
    const canPay  = ["SENT", "PARTIAL"].includes(invoice.status);

    return (
        <div className="max-w-3xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex items-center gap-4">
                <Link href="/office/accountancy/invoices" className="text-muted-foreground hover:text-foreground">
                    <ArrowLeft size={20} />
                </Link>
                <div className="flex-1">
                    <div className="flex items-center gap-3">
                        <h1 className="text-xl font-bold text-foreground font-mono">{invoice.number}</h1>
                        <span className={`text-xs px-2.5 py-1 border font-medium ${STATUS_COLORS[invoice.status]}`}>
                            {invoice.status}
                        </span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5">{invoice.partyName} · {invoice.partyType}</p>
                </div>
                <div className="flex gap-2 items-center">
                    {canSend && (
                        <Button onClick={sendInvoice} disabled={sending}>
                            {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                            Send &amp; Post JE
                        </Button>
                    )}
                    {canPay && (
                        <Button
                            onClick={() => setShowPayment(true)}
                            className="bg-green-600 hover:bg-green-700 text-white border-green-600"
                        >
                            <Plus size={14} /> Record Payment
                        </Button>
                    )}
                    <LifecycleActions
                        voucher={invoice}
                        apiBasePath={`/api/accountancy/invoices/${id}`}
                        listPath="/office/accountancy/invoices"
                        label="Invoice"
                        canCancel={canCancel}
                        canDelete={canDelete}
                        canHardDelete={canHardDelete}
                        onChanged={load}
                    />
                </div>
            </div>

            {/* Summary cards */}
            <div className="grid grid-cols-3 gap-4">
                {[
                    { label: "Total",  value: fmt(Number(invoice.totalAmount)), color: "text-foreground" },
                    { label: "Paid",   value: fmt(Number(invoice.amountPaid)),  color: "text-green-700" },
                    { label: "Due",    value: fmt(Number(invoice.amountDue)),   color: "text-orange-600" },
                ].map(({ label, value, color }) => (
                    <div key={label} className="rounded-lg border border-border bg-card p-4 text-center shadow">
                        <p className="text-xs text-muted-foreground mb-1">{label}</p>
                        <p className={`text-xl font-bold font-mono ${color}`}>{value}</p>
                    </div>
                ))}
            </div>

            {/* Meta */}
            <div className="grid grid-cols-2 gap-4 rounded-lg border border-border bg-card p-5 text-sm shadow">
                <div>
                    <p className="text-xs text-muted-foreground mb-1">Issue Date</p>
                    <p className="font-medium">{new Date(invoice.issueDate).toLocaleDateString()}</p>
                </div>
                <div>
                    <p className="text-xs text-muted-foreground mb-1">Due Date</p>
                    <p className="font-medium">{new Date(invoice.dueDate).toLocaleDateString()}</p>
                </div>
                <div>
                    <p className="text-xs text-muted-foreground mb-1">Created by</p>
                    <p className="font-medium">{invoice.createdBy.name}</p>
                </div>
                {invoice.notes && (
                    <div className="col-span-2">
                        <p className="text-xs text-muted-foreground mb-1">Notes</p>
                        <p>{invoice.notes}</p>
                    </div>
                )}
            </div>

            {/* Line items */}
            <div className="overflow-hidden rounded-lg border border-border bg-card shadow">
                <div className="border-b border-border bg-muted px-5 py-3">
                    <h3 className="text-sm font-semibold text-foreground">Line Items</h3>
                </div>
                <table className="w-full text-sm">
                    <thead className="border-b border-border bg-muted text-xs text-muted-foreground">
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
                                <td className="px-5 py-3 text-foreground">{l.description}</td>
                                <td className="px-5 py-3 text-right">{Number(l.quantity)}</td>
                                <td className="px-5 py-3 text-right font-mono">{fmt(Number(l.unitPrice))}</td>
                                <td className="px-5 py-3 text-right text-muted-foreground">{Number(l.taxRate)}%</td>
                                <td className="px-5 py-3 text-right font-mono font-medium">{fmt(Number(l.amount))}</td>
                            </tr>
                        ))}
                    </tbody>
                    <tfoot className="bg-muted border-t-2 border-border text-sm font-semibold">
                        <tr>
                            <td colSpan={4} className="px-5 py-2 text-right text-muted-foreground">Subtotal</td>
                            <td className="px-5 py-2 text-right font-mono">{fmt(Number(invoice.subtotal))}</td>
                        </tr>
                        {Number(invoice.taxAmount) > 0 && (
                            <tr>
                                <td colSpan={4} className="px-5 py-2 text-right text-muted-foreground">Tax</td>
                                <td className="px-5 py-2 text-right font-mono">{fmt(Number(invoice.taxAmount))}</td>
                            </tr>
                        )}
                        <tr>
                            <td colSpan={4} className="px-5 py-2 text-right text-foreground">Total</td>
                            <td className="px-5 py-2 text-right font-mono text-foreground">{fmt(Number(invoice.totalAmount))}</td>
                        </tr>
                    </tfoot>
                </table>
            </div>

            {/* Payments */}
            {invoice.payments.length > 0 && (
                <div className="overflow-hidden rounded-lg border border-border bg-card shadow">
                    <div className="border-b border-border bg-muted px-5 py-3">
                        <h3 className="text-sm font-semibold text-foreground">Payments Received</h3>
                    </div>
                    <table className="w-full text-sm">
                        <thead className="border-b border-border bg-muted text-xs text-muted-foreground">
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
                                    <td className="px-5 py-3 text-muted-foreground">{p.reference ?? "—"}</td>
                                    <td className="px-5 py-3 text-right font-mono font-semibold text-green-700">{fmt(Number(p.amount))}</td>
                                    <td className="px-5 py-3 text-muted-foreground text-xs">{p.createdBy.name}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Payment Dialog */}
            <Dialog open={showPayment} onOpenChange={(open) => { if (!open) setShowPayment(false); }}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Record Payment</DialogTitle>
                        <DialogDescription>
                            Amount due: <strong>{fmt(Number(invoice.amountDue))}</strong>
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid grid-cols-2 gap-3">
                        <div className="col-span-2 space-y-1.5">
                            <Label>Amount</Label>
                            <Input
                                type="number" min="0" step="0.01"
                                value={payForm.amount}
                                onChange={(e) => setPayForm((f) => ({ ...f, amount: e.target.value }))}
                                placeholder="0.00"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label>Payment Method</Label>
                            <Select value={payForm.method} onValueChange={(v) => setPayForm((f) => ({ ...f, method: v }))}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {PAYMENT_METHODS.map((m) => <SelectItem key={m} value={m}>{m.replace(/_/g, " ")}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1.5">
                            <Label>Date</Label>
                            <Input
                                type="date"
                                value={payForm.date}
                                onChange={(e) => setPayForm((f) => ({ ...f, date: e.target.value }))}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label>Debit GL Account</Label>
                            <Select value={payForm.cashGlAccountCode} onValueChange={(v) => setPayForm((f) => ({ ...f, cashGlAccountCode: v }))}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="1000">1000 — Cash</SelectItem>
                                    <SelectItem value="1010">1010 — Bank Account</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1.5">
                            <Label>Reference</Label>
                            <Input
                                value={payForm.reference}
                                onChange={(e) => setPayForm((f) => ({ ...f, reference: e.target.value }))}
                                placeholder="Cheque / bank ref"
                            />
                        </div>
                        <div className="col-span-2 space-y-1.5">
                            <Label>Notes</Label>
                            <Input
                                value={payForm.notes}
                                onChange={(e) => setPayForm((f) => ({ ...f, notes: e.target.value }))}
                                placeholder="Optional"
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowPayment(false)}>Cancel</Button>
                        <Button
                            onClick={recordPayment}
                            disabled={paying}
                            className="bg-green-600 hover:bg-green-700 text-white border-green-600"
                        >
                            {paying && <Loader2 size={14} className="animate-spin" />} Record Payment
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

        </div>
    );
}
