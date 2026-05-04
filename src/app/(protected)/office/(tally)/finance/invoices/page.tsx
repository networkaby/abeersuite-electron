"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import Link from "next/link";
import { toast } from "sonner";
import { Plus, Loader2, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fmt, INVOICE_STATUS_COLORS } from "@/utils/constants";
import { PartyPicker } from "@/modules/shared/components/PartyPicker";
import { OrderSourceBadge } from "@/modules/ecommerce/components/OrderSourceBadge";
import type { OrderSource } from "@/generated/prisma/enums";

interface Invoice {
    id: number;
    number: string;
    status: "DRAFT" | "SENT" | "PARTIAL" | "PAID" | "VOID";
    issueDate: string;
    dueDate: string;
    totalAmount: string;
    amountPaid: string;
    account: {
        id: number;
        name: string;
        customer?: { id: number; name: string } | null;
        company?: { id: number; name: string } | null;
    } | null;
    shopOrder: { id: number; orderSource: OrderSource } | null;
    createdBy: { name: string };
    _count: { lines: number; payments: number };
}

type LineInput = { description: string; quantity: string; unitPrice: string; taxRate: string };

const STATUS_COLORS = INVOICE_STATUS_COLORS;
const cellClass = "w-full rounded-md border border-input bg-background px-2 py-1 text-sm focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

function partyName(inv: Invoice): string {
    if (inv.account?.customer?.name) return inv.account.customer.name;
    if (inv.account?.company?.name) return inv.account.company.name;
    if (inv.account?.name) return inv.account.name;
    return "—";
}

export default function InvoicesPage() {
    const [invoices, setInvoices] = useState<Invoice[]>([]);
    const [loading, setLoading] = useState(true);
    const [statusFilter, setStatusFilter] = useState("");
    const [orderSourceFilter, setOrderSourceFilter] = useState("");
    const [showCreate, setShowCreate] = useState(false);
    const [saving, setSaving] = useState(false);
    const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);

    const [form, setForm] = useState({
        issueDate: new Date().toISOString().slice(0, 10),
        dueDate: "",
        notes: "",
        status: "DRAFT" as "DRAFT" | "SENT",
        lines: [{ description: "", quantity: "1", unitPrice: "", taxRate: "0" }] as LineInput[],
    });

    const load = () => {
        setLoading(true);
        const params = new URLSearchParams();
        if (statusFilter) params.set("status", statusFilter);
        if (orderSourceFilter) params.set("orderSource", orderSourceFilter);
        axios.get<Invoice[]>(`/api/finance/invoices?${params}`)
            .then((r) => setInvoices(r.data))
            .catch(() => toast.error("Failed to load"))
            .finally(() => setLoading(false));
    };

    useEffect(load, [statusFilter, orderSourceFilter]);

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
        if (!selectedAccountId) { toast.error("Please select a party"); return; }
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
                accountId: selectedAccountId,
                issueDate: form.issueDate,
                dueDate: form.dueDate,
                notes: form.notes || undefined,
                status: form.status,
                lines,
            });
            toast.success(`Invoice created${form.status === "SENT" ? " & JE posted" : " as draft"}`);
            setShowCreate(false);
            setSelectedAccountId(null);
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
                    <h1 className="text-2xl font-bold text-foreground">Invoices</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">Customer billing records</p>
                </div>
                <Button onClick={() => setShowCreate((v) => !v)}>
                    <Plus size={16} /> New Invoice
                </Button>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap gap-3 items-center">
                <div className="flex gap-1 flex-wrap">
                    {(["", "DRAFT", "SENT", "PARTIAL", "PAID", "VOID"] as const).map((s) => (
                        <Button
                            key={s}
                            onClick={() => setStatusFilter(s)}
                            variant="outline"
                            size="xs"
                            className={`h-auto px-3 py-1.5 text-xs font-medium transition-colors ${
                                statusFilter === s
                                    ? "border-primary bg-primary text-primary-foreground"
                                    : "border-border bg-card text-muted-foreground hover:bg-muted"
                            }`}
                        >
                            {s || "All Status"}
                        </Button>
                    ))}
                </div>
                <Select value={orderSourceFilter} onValueChange={setOrderSourceFilter}>
                    <SelectTrigger className="w-36 h-7 text-xs">
                        <SelectValue placeholder="All Channels" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="">All Channels</SelectItem>
                        <SelectItem value="ONLINE">Online</SelectItem>
                        <SelectItem value="IN_STORE">In Store</SelectItem>
                        <SelectItem value="PHONE">Phone</SelectItem>
                        <SelectItem value="WHATSAPP">WhatsApp</SelectItem>
                        <SelectItem value="OTHER">Other</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            {/* Create form */}
            {showCreate && (
                <div className="space-y-5 rounded-lg border border-border bg-card p-5 shadow">
                    <h2 className="font-semibold text-foreground">New Invoice</h2>

                    <PartyPicker
                        label="Bill To"
                        showCashOption
                        allowCompany
                        placeholder="Search customer or company by name / phone…"
                        onSelect={(id) => setSelectedAccountId(id)}
                    />

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                            <Label>Issue Date</Label>
                            <Input
                                type="date"
                                value={form.issueDate}
                                onChange={(e) => setForm((f) => ({ ...f, issueDate: e.target.value }))}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label>Due Date</Label>
                            <Input
                                type="date"
                                value={form.dueDate}
                                onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
                            />
                        </div>
                        <div className="col-span-2 space-y-1.5">
                            <Label>Notes</Label>
                            <Textarea
                                value={form.notes}
                                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                                rows={2}
                                placeholder="Optional"
                            />
                        </div>
                    </div>

                    {/* Line items */}
                    <div className="overflow-hidden rounded-lg border border-border">
                        <table className="w-full text-sm">
                            <thead className="border-b border-border bg-muted text-xs text-muted-foreground">
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
                                    <tr key={i} className="border-t border-border">
                                        <td className="px-3 py-2">
                                            <Input
                                                value={l.description}
                                                onChange={(e) => updateLine(i, { description: e.target.value })}
                                                className={cellClass}
                                                placeholder="Service or product description"
                                            />
                                        </td>
                                        <td className="px-3 py-2">
                                            <Input type="number" min="0" step="0.001" value={l.quantity}
                                                onChange={(e) => updateLine(i, { quantity: e.target.value })}
                                                className={`${cellClass} text-right`} />
                                        </td>
                                        <td className="px-3 py-2">
                                            <Input type="number" min="0" step="0.01" value={l.unitPrice}
                                                onChange={(e) => updateLine(i, { unitPrice: e.target.value })}
                                                className={`${cellClass} text-right`} placeholder="0.00" />
                                        </td>
                                        <td className="px-3 py-2">
                                            <Input type="number" min="0" max="100" step="0.5" value={l.taxRate}
                                                onChange={(e) => updateLine(i, { taxRate: e.target.value })}
                                                className={`${cellClass} text-right`} />
                                        </td>
                                        <td className="px-3 py-2 text-right font-mono text-foreground">{fmt(lineTotal(l))}</td>
                                        <td className="px-3 py-2 text-center">
                                            {form.lines.length > 1 && (
                                                <Button onClick={() => removeLine(i)} variant="ghost" size="icon-xs" className="text-destructive hover:text-destructive/80">×</Button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot className="border-t border-border bg-muted font-semibold">
                                <tr>
                                    <td colSpan={4} className="px-3 py-2 text-right text-muted-foreground">Grand Total</td>
                                    <td className="px-3 py-2 text-right font-mono">{fmt(grandTotal)}</td>
                                    <td />
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                    <Button onClick={addLine} variant="link" size="sm" className="h-auto p-0 text-sm">+ Add line</Button>

                    <div className="flex items-center justify-between pt-2">
                        <div className="flex items-center gap-3">
                            <Label>Create as</Label>
                            <Select value={form.status} onValueChange={(v) => setForm((f) => ({ ...f, status: v as "DRAFT" | "SENT" }))}>
                                <SelectTrigger className="w-auto"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="DRAFT">Draft (no JE yet)</SelectItem>
                                    <SelectItem value="SENT">Sent (auto-post AR/Revenue JE)</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="flex gap-2">
                            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
                            <Button onClick={submit} disabled={saving}>
                                {saving && <Loader2 size={14} className="animate-spin" />} Create Invoice
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            {/* List */}
            {loading ? (
                <div className="flex justify-center py-12">
                    <Loader2 className="animate-spin text-muted-foreground" size={28} />
                </div>
            ) : (
                <div className="overflow-hidden rounded-lg border border-border bg-card shadow">
                    {invoices.length === 0 ? (
                        <div className="text-center py-16 text-muted-foreground">No invoices yet</div>
                    ) : (
                        <table className="w-full text-sm">
                            <thead className="border-b border-border bg-muted text-xs text-muted-foreground">
                                <tr>
                                    <th className="px-5 py-3 text-left font-medium">Invoice #</th>
                                    <th className="px-5 py-3 text-left font-medium">Billed To</th>
                                    <th className="px-5 py-3 text-left font-medium">Channel</th>
                                    <th className="px-5 py-3 text-left font-medium">Issue Date</th>
                                    <th className="px-5 py-3 text-right font-medium">Total</th>
                                    <th className="px-5 py-3 text-center font-medium">Status</th>
                                    <th className="px-5 py-3" />
                                </tr>
                            </thead>
                            <tbody>
                                {invoices.map((inv) => (
                                    <tr key={inv.id} className="border-b last:border-0 hover:bg-muted/40">
                                        <td className="px-5 py-3 font-mono text-primary">{inv.number}</td>
                                        <td className="px-5 py-3">
                                            <p className="font-medium text-foreground">{partyName(inv)}</p>
                                            {inv.account?.company && (
                                                <p className="text-xs text-muted-foreground">Company</p>
                                            )}
                                        </td>
                                        <td className="px-5 py-3">
                                            {inv.shopOrder ? (
                                                <OrderSourceBadge source={inv.shopOrder.orderSource} size="sm" />
                                            ) : (
                                                <span className="text-xs text-muted-foreground">—</span>
                                            )}
                                        </td>
                                        <td className="px-5 py-3 text-muted-foreground">{new Date(inv.issueDate).toLocaleDateString()}</td>
                                        <td className="px-5 py-3 text-right font-mono">{fmt(Number(inv.totalAmount))}</td>
                                        <td className="px-5 py-3 text-center">
                                            <span className={`text-xs px-2 py-0.5 font-medium ${STATUS_COLORS[inv.status]}`}>
                                                {inv.status}
                                            </span>
                                        </td>
                                        <td className="px-5 py-3 text-right">
                                            <Link href={`/office/finance/invoices/${inv.id}`} className="text-muted-foreground/40 hover:text-primary">
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
