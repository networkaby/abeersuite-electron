"use client";

import { useEffect, useState, useCallback } from "react";
import axios from "axios";
import Link from "next/link";
import { toast } from "sonner";
import { Plus, Loader2, ChevronRight, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fmt, JOURNAL_STATUS_COLORS } from "@/utils/constants";
import { InvProductPicker } from "@/modules/inventory/components/InvProductPicker";

type VoucherRow = {
    id:          number;
    reference:   string;
    date:        string;
    description: string;
    partyName:   string | null;
    totalAmount: number;
    status:      "DRAFT" | "POSTED" | "CANCELLED";
    _count:      { lines: number };
    createdBy:   { name: string };
};

type LineInput = {
    productId:   number;
    quantity:    string;
    rate:        string;
    discountPct: string;
    taxRate:     string;
};

const emptyLine = (): LineInput => ({
    productId: 0, quantity: "1", rate: "", discountPct: "0", taxRate: "0",
});

export default function PurchasesPage() {
    const [rows, setRows]         = useState<VoucherRow[]>([]);
    const [loading, setLoading]   = useState(true);
    const [statusFilter, setStatusFilter] = useState("");
    const [showCreate, setShowCreate]     = useState(false);
    const [saving, setSaving]     = useState(false);

    const [form, setForm] = useState({
        date:        new Date().toISOString().slice(0, 10),
        description: "",
        partyName:   "",
        partyPhone:  "",
        partyAddress:"",
        shippingAmt: "0",
        roundOff:    "0",
        lines:       [emptyLine()],
    });

    const load = useCallback(() => {
        setLoading(true);
        const q = statusFilter ? `&status=${statusFilter}` : "";
        axios.get<VoucherRow[]>(`/api/inventory/vouchers?type=PURCHASE${q}`)
            .then((r) => setRows(r.data))
            .catch(() => toast.error("Failed to load purchases"))
            .finally(() => setLoading(false));
    }, [statusFilter]);

    useEffect(() => { load(); }, [load]);

    // ── Line helpers ──────────────────────────────────────────────────────────
    const updateLine = (i: number, patch: Partial<LineInput>) =>
        setForm((f) => ({ ...f, lines: f.lines.map((l, idx) => idx === i ? { ...l, ...patch } : l) }));

    const addLine    = () => setForm((f) => ({ ...f, lines: [...f.lines, emptyLine()] }));
    const removeLine = (i: number) => setForm((f) => ({ ...f, lines: f.lines.filter((_, idx) => idx !== i) }));

    // ── Live totals ───────────────────────────────────────────────────────────
    const computedLines = form.lines.map((l) => {
        const qty  = parseFloat(l.quantity)    || 0;
        const rate = parseFloat(l.rate)        || 0;
        const disc = parseFloat(l.discountPct) || 0;
        const tax  = parseFloat(l.taxRate)     || 0;
        const gross    = qty * rate;
        const discAmt  = gross * (disc / 100);
        const taxable  = gross - discAmt;
        const taxAmt   = taxable * (tax / 100);
        const amount   = taxable + taxAmt;
        return { qty, rate, discAmt, taxAmt, amount };
    });
    const subtotal   = computedLines.reduce((s, l) => s + l.amount, 0);
    const totalTax   = computedLines.reduce((s, l) => s + l.taxAmt, 0);
    const shipping   = parseFloat(form.shippingAmt) || 0;
    const roundOff   = parseFloat(form.roundOff)    || 0;
    const grandTotal = subtotal + shipping + roundOff;

    // ── Submit ────────────────────────────────────────────────────────────────
    const submit = async () => {
        if (!form.description.trim()) { toast.error("Description required"); return; }
        if (form.lines.some((l) => !l.productId || !parseFloat(l.rate))) {
            toast.error("All lines need a product and rate"); return;
        }
        setSaving(true);
        try {
            await axios.post("/api/inventory/vouchers", {
                type:         "PURCHASE",
                date:         form.date,
                description:  form.description,
                partyName:    form.partyName   || undefined,
                partyPhone:   form.partyPhone  || undefined,
                partyAddress: form.partyAddress|| undefined,
                shippingAmt:  shipping,
                roundOff,
                lines: form.lines.map((l) => ({
                    productId:   l.productId,
                    quantity:    parseFloat(l.quantity)    || 1,
                    rate:        parseFloat(l.rate)        || 0,
                    discountPct: parseFloat(l.discountPct) || 0,
                    taxRate:     parseFloat(l.taxRate)     || 0,
                })),
            });
            toast.success("Purchase voucher created");
            setShowCreate(false);
            setForm({ date: new Date().toISOString().slice(0, 10), description: "", partyName: "", partyPhone: "", partyAddress: "", shippingAmt: "0", roundOff: "0", lines: [emptyLine()] });
            load();
        } catch (err: unknown) {
            const msg = axios.isAxiosError(err) ? err.response?.data?.error : "Failed";
            toast.error(msg ?? "Failed");
        } finally {
            setSaving(false);
        }
    };

    const cell = "w-full rounded border border-input bg-background px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

    return (
        <div className="space-y-6 max-w-6xl">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-xl font-semibold">Purchase Vouchers</h2>
                    <p className="text-muted-foreground text-sm mt-0.5">Record goods received from suppliers — increases stock.</p>
                </div>
                <Button onClick={() => setShowCreate((v) => !v)}>
                    <Plus size={16} /> New Purchase
                </Button>
            </div>

            {/* Status filter tabs */}
            <div className="flex gap-1">
                {(["", "DRAFT", "POSTED", "CANCELLED"] as const).map((s) => (
                    <Button key={s} variant="outline" size="xs"
                        onClick={() => setStatusFilter(s)}
                        className={`h-auto px-3 py-1.5 text-xs font-medium transition-colors ${statusFilter === s ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:bg-muted"}`}
                    >
                        {s || "All"}
                    </Button>
                ))}
            </div>

            {/* Create form */}
            {showCreate && (
                <div className="rounded-lg border border-border bg-card p-5 shadow space-y-4">
                    <h3 className="font-semibold">New Purchase Voucher</h3>

                    {/* Header fields */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <div className="space-y-1">
                            <Label>Date</Label>
                            <Input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
                        </div>
                        <div className="space-y-1 md:col-span-2">
                            <Label>Description / Narration *</Label>
                            <Input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="e.g. Purchase from ABC Suppliers" />
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div className="space-y-1">
                            <Label>Supplier Name</Label>
                            <Input value={form.partyName} onChange={(e) => setForm((f) => ({ ...f, partyName: e.target.value }))} placeholder="Supplier / Party" />
                        </div>
                        <div className="space-y-1">
                            <Label>Phone</Label>
                            <Input value={form.partyPhone} onChange={(e) => setForm((f) => ({ ...f, partyPhone: e.target.value }))} placeholder="Phone number" />
                        </div>
                        <div className="space-y-1">
                            <Label>Address</Label>
                            <Input value={form.partyAddress} onChange={(e) => setForm((f) => ({ ...f, partyAddress: e.target.value }))} placeholder="Billing address" />
                        </div>
                    </div>

                    {/* Line items table */}
                    <div className="overflow-x-auto rounded-lg border border-border">
                        <table className="w-full text-sm min-w-[700px]">
                            <thead className="bg-muted text-xs text-muted-foreground border-b border-border">
                                <tr>
                                    <th className="px-3 py-2 text-left font-medium">Product</th>
                                    <th className="px-3 py-2 text-right font-medium w-24">Qty</th>
                                    <th className="px-3 py-2 text-right font-medium w-28">Rate (₹)</th>
                                    <th className="px-3 py-2 text-right font-medium w-20">Disc %</th>
                                    <th className="px-3 py-2 text-right font-medium w-20">Tax %</th>
                                    <th className="px-3 py-2 text-right font-medium w-28">Amount (₹)</th>
                                    <th className="px-3 py-2 w-8" />
                                </tr>
                            </thead>
                            <tbody>
                                {form.lines.map((line, i) => (
                                    <tr key={i} className="border-t border-border">
                                        <td className="px-3 py-2 min-w-[200px]">
                                            <InvProductPicker
                                                label=""
                                                value={line.productId || null}
                                                onChange={(id) => updateLine(i, { productId: id ?? 0 })}
                                            />
                                        </td>
                                        <td className="px-3 py-2">
                                            <input type="text" inputMode="decimal" value={line.quantity}
                                                onChange={(e) => updateLine(i, { quantity: e.target.value })}
                                                className={`${cell} text-right`} />
                                        </td>
                                        <td className="px-3 py-2">
                                            <input type="text" inputMode="decimal" value={line.rate}
                                                onChange={(e) => updateLine(i, { rate: e.target.value })}
                                                className={`${cell} text-right`} placeholder="0.00" />
                                        </td>
                                        <td className="px-3 py-2">
                                            <input type="text" inputMode="decimal" value={line.discountPct}
                                                onChange={(e) => updateLine(i, { discountPct: e.target.value })}
                                                className={`${cell} text-right`} />
                                        </td>
                                        <td className="px-3 py-2">
                                            <input type="text" inputMode="decimal" value={line.taxRate}
                                                onChange={(e) => updateLine(i, { taxRate: e.target.value })}
                                                className={`${cell} text-right`} />
                                        </td>
                                        <td className="px-3 py-2 text-right font-mono text-foreground">
                                            {fmt(computedLines[i]?.amount ?? 0)}
                                        </td>
                                        <td className="px-3 py-2 text-center">
                                            {form.lines.length > 1 && (
                                                <Button variant="ghost" size="icon-xs"
                                                    className="text-destructive hover:text-destructive/80"
                                                    onClick={() => removeLine(i)}>
                                                    <Trash2 size={14} />
                                                </Button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <Button variant="link" size="sm" className="h-auto p-0 text-sm" onClick={addLine}>
                        + Add item
                    </Button>

                    {/* Totals + actions */}
                    <div className="flex items-end justify-between gap-4 flex-wrap">
                        <div className="grid grid-cols-2 gap-3 text-sm">
                            <div className="space-y-1">
                                <Label>Shipping (₹)</Label>
                                <Input type="text" inputMode="decimal" value={form.shippingAmt}
                                    onChange={(e) => setForm((f) => ({ ...f, shippingAmt: e.target.value }))} className="w-28" />
                            </div>
                            <div className="space-y-1">
                                <Label>Round Off (₹)</Label>
                                <Input type="text" inputMode="decimal" value={form.roundOff}
                                    onChange={(e) => setForm((f) => ({ ...f, roundOff: e.target.value }))} className="w-28" />
                            </div>
                        </div>

                        <div className="text-right space-y-1 text-sm min-w-[200px]">
                            <div className="flex justify-between gap-6 text-muted-foreground">
                                <span>Subtotal</span><span className="font-mono">₹ {fmt(subtotal)}</span>
                            </div>
                            <div className="flex justify-between gap-6 text-muted-foreground">
                                <span>Tax</span><span className="font-mono">₹ {fmt(totalTax)}</span>
                            </div>
                            {shipping > 0 && (
                                <div className="flex justify-between gap-6 text-muted-foreground">
                                    <span>Shipping</span><span className="font-mono">₹ {fmt(shipping)}</span>
                                </div>
                            )}
                            <div className="flex justify-between gap-6 font-semibold text-base border-t border-border pt-1">
                                <span>Total</span><span className="font-mono">₹ {fmt(grandTotal)}</span>
                            </div>
                        </div>
                    </div>

                    <div className="flex gap-2 justify-end">
                        <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
                        <Button onClick={submit} disabled={saving}>
                            {saving && <Loader2 size={14} className="animate-spin mr-1" />} Save as Draft
                        </Button>
                    </div>
                </div>
            )}

            {/* List */}
            {loading ? (
                <div className="flex justify-center py-12"><Loader2 className="animate-spin text-muted-foreground" size={28} /></div>
            ) : (
                <div className="overflow-hidden rounded-lg border border-border bg-card shadow">
                    {rows.length === 0 ? (
                        <div className="text-center py-16 text-muted-foreground">No purchase vouchers yet</div>
                    ) : (
                        <table className="w-full text-sm">
                            <thead className="border-b border-border bg-muted text-xs text-muted-foreground">
                                <tr>
                                    <th className="px-5 py-3 text-left font-medium">Reference</th>
                                    <th className="px-5 py-3 text-left font-medium">Date</th>
                                    <th className="px-5 py-3 text-left font-medium">Supplier</th>
                                    <th className="px-5 py-3 text-left font-medium">Description</th>
                                    <th className="px-5 py-3 text-right font-medium">Items</th>
                                    <th className="px-5 py-3 text-right font-medium">Total</th>
                                    <th className="px-5 py-3 text-center font-medium">Status</th>
                                    <th className="px-5 py-3 text-left font-medium">By</th>
                                    <th className="px-5 py-3" />
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((r) => (
                                    <tr key={r.id} className="border-b last:border-0 hover:bg-muted/40">
                                        <td className="px-5 py-3 font-mono text-primary">{r.reference}</td>
                                        <td className="px-5 py-3 text-muted-foreground">{new Date(r.date).toLocaleDateString()}</td>
                                        <td className="px-5 py-3">{r.partyName ?? "—"}</td>
                                        <td className="px-5 py-3 text-muted-foreground truncate max-w-[180px]">{r.description}</td>
                                        <td className="px-5 py-3 text-right text-muted-foreground">{r._count.lines}</td>
                                        <td className="px-5 py-3 text-right font-mono">₹ {fmt(Number(r.totalAmount))}</td>
                                        <td className="px-5 py-3 text-center">
                                            <span className={`text-xs px-2 py-0.5 font-medium rounded ${JOURNAL_STATUS_COLORS[r.status]}`}>{r.status}</span>
                                        </td>
                                        <td className="px-5 py-3 text-muted-foreground text-xs">{r.createdBy.name}</td>
                                        <td className="px-5 py-3 text-right">
                                            <Link href={`/office/inventory/purchases/${r.id}`} className="text-muted-foreground/40 hover:text-primary">
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
