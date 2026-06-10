"use client";
// Shared inventory voucher form for the new Tally types: Sales Order, Purchase
// Order, GRN, Challan, Stock Journal, Physical Stock, Rejection In/Out.
// Existing SALE / PURCHASE / ESTIMATE keep their dedicated forms because they
// surface payment mode, party billing, and other SALE-specific UX.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { extractApiError } from "@/shared/lib/api";
import { Loader2, Trash2, Building2 } from "lucide-react";
import { useActiveBranchStore } from "@/store/activeBranchStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { fmt } from "@/utils/constants";
import { InvProductPicker } from "@/modules/inventory/components/InvProductPicker";
import { http } from "@/shared/lib/http";
import { BranchRequired } from "@/shared/components/BranchRequired";
import { TallyDateInput } from "@/shared/components/TallyDateInput";
import { toIsoDate } from "@/shared/hooks/useTallyDate";

export type InvVoucherKind =
    | "SALES_ORDER" | "PURCHASE_ORDER"
    | "GRN" | "CHALLAN"
    | "MANUFACTURING_JOURNAL" | "PHYSICAL_STOCK"
    | "REJECTION_IN" | "REJECTION_OUT";

const TITLES: Record<InvVoucherKind, string> = {
    SALES_ORDER:    "Sales Order",
    PURCHASE_ORDER: "Purchase Order",
    GRN:            "Goods Received Note",
    CHALLAN:        "Delivery Challan",
    MANUFACTURING_JOURNAL:  "Manufacturing Journal",
    PHYSICAL_STOCK: "Physical Stock",
    REJECTION_IN:   "Rejection In",
    REJECTION_OUT:  "Rejection Out",
};

const PARTY_LABEL: Record<InvVoucherKind, string> = {
    SALES_ORDER:    "Customer",
    PURCHASE_ORDER: "Supplier",
    GRN:            "Supplier",
    CHALLAN:        "Customer",
    MANUFACTURING_JOURNAL:  "Counterparty (optional)",
    PHYSICAL_STOCK: "Location (optional)",
    REJECTION_IN:   "Customer (returning)",
    REJECTION_OUT:  "Supplier (receiving)",
};

const NARRATION: Record<InvVoucherKind, string> = {
    SALES_ORDER:    "e.g. SO confirmed by customer ABC for delivery next week",
    PURCHASE_ORDER: "e.g. PO raised against supplier XYZ for stock replenishment",
    GRN:            "e.g. Goods received against PO-2026-0042",
    CHALLAN:        "e.g. Delivered against SO-2026-0017; payment pending",
    MANUFACTURING_JOURNAL:  "e.g. Manufacturing run — consume raw materials, produce finished goods",
    PHYSICAL_STOCK: "Counted on quarterly stock-take. Enter actual on-hand qty per line.",
    REJECTION_IN:   "e.g. Customer returned defective item — see RMA-2026-0008",
    REJECTION_OUT:  "e.g. Returned to supplier — wrong model shipped",
};

type LineInput = {
    productId:   number;
    quantity:    string;
    rate:        string;
    description: string;
};

const cell = "w-full rounded border border-input bg-background px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export function InvVoucherForm({ type, redirectTo }: { type: InvVoucherKind; redirectTo: string }) {
    const router = useRouter();
    const activeBranchId = useActiveBranchStore((s) => s.activeBranchId);
    const [saving, setSaving] = useState(false);

    const [form, setForm] = useState({
        date:         toIsoDate(new Date()),
        description:  "",
        partyName:    "",
        partyPhone:   "",
        partyAddress: "",
        showPrices:   true,
        lines:        [{ productId: 0, quantity: "1", rate: "0", description: "" }] as LineInput[],
    });

    // Stock Journal needs an explicit IN/OUT toggle per line via signed amount.
    // Keeping the form simple for now: positive entries = IN, negative = OUT.
    // Physical Stock interprets `quantity` as the new on-hand value (delta is computed at post time).

    const updateLine = (i: number, patch: Partial<LineInput>) =>
        setForm((f) => ({ ...f, lines: f.lines.map((l, idx) => idx === i ? { ...l, ...patch } : l) }));
    const addLine    = () => setForm((f) => ({ ...f, lines: [...f.lines, { productId: 0, quantity: "1", rate: "0", description: "" }] }));
    const removeLine = (i: number) => setForm((f) => ({ ...f, lines: f.lines.filter((_, idx) => idx !== i) }));

    const subtotal = form.lines.reduce((s, l) => s + (parseFloat(l.quantity) || 0) * (parseFloat(l.rate) || 0), 0);

    const submit = async (postAfterSave: boolean) => {
        if (!form.description.trim()) { toast.error("Description required"); return; }
        if (form.lines.some((l) => !l.productId || !parseFloat(l.quantity))) {
            toast.error("Each line needs a product and quantity"); return;
        }

        setSaving(true);
        try {
            const created = await http.post<{ id: number }>("/api/inventory/vouchers", {
                type,
                branchId:     activeBranchId ?? undefined,
                date:         form.date,
                description:  form.description,
                partyName:    form.partyName    || undefined,
                partyPhone:   form.partyPhone   || undefined,
                partyAddress: form.partyAddress || undefined,
                showPrices:   type === "CHALLAN" ? form.showPrices : undefined,
                lines: form.lines.map((l) => ({
                    productId:   l.productId,
                    quantity:    parseFloat(l.quantity) || 0,
                    rate:        parseFloat(l.rate)     || 0,
                    description: l.description || undefined,
                })),
            });
            if (postAfterSave) {
                await http.post(`/api/inventory/vouchers/${created.data.id}/post`);
                toast.success(`${TITLES[type]} saved & posted`);
            } else {
                toast.success(`${TITLES[type]} saved as draft`);
            }
            router.push(redirectTo);
        } catch (err: unknown) {
            toast.error(extractApiError(err, "Failed"));
        } finally {
            setSaving(false);
        }
    };

    return (
        <BranchRequired action={`post this ${TITLES[type].toLowerCase()}`}>
        <div className="max-w-4xl mx-auto space-y-5">
            <div className="flex items-start justify-between">
                <div>
                    <h1 className="text-xl font-bold">New {TITLES[type]}</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">Reference number is auto-assigned on save.</p>
                </div>
                {activeBranchId && (
                    <div className="flex items-center gap-1.5 px-2 py-0.5 text-xs text-muted-foreground border border-border/60 rounded">
                        <Building2 size={12} className="shrink-0" />
                        <span>{activeBranchId}</span>
                    </div>
                )}
            </div>

            <div className="rounded-lg border border-border bg-card p-5 shadow space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="space-y-1.5">
                        <Label>Date</Label>
                        <TallyDateInput value={form.date} onValueChange={(iso) => setForm((f) => ({ ...f, date: iso }))} />
                    </div>
                    <div className="space-y-1.5">
                        <Label>{PARTY_LABEL[type]}</Label>
                        <Input value={form.partyName} onChange={(e) => setForm((f) => ({ ...f, partyName: e.target.value }))} placeholder="Name" />
                    </div>
                    <div className="space-y-1.5">
                        <Label>Phone</Label>
                        <Input value={form.partyPhone} onChange={(e) => setForm((f) => ({ ...f, partyPhone: e.target.value }))} placeholder="Phone" />
                    </div>
                </div>

                <div className="space-y-1.5">
                    <Label>Description / Narration *</Label>
                    <Textarea
                        value={form.description}
                        rows={2}
                        placeholder={NARRATION[type]}
                        onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                    />
                </div>

                {/* Challan-only price visibility toggle */}
                {type === "CHALLAN" && (
                    <div className="flex items-center justify-between rounded-md border border-border bg-muted/40 px-4 py-3">
                        <div>
                            <p className="text-sm font-medium">Show prices on printed challan</p>
                            <p className="text-xs text-muted-foreground">When off, the print only shows quantities — useful for B2B deliveries where pricing is confidential.</p>
                        </div>
                        <Switch checked={form.showPrices} onCheckedChange={(v) => setForm((f) => ({ ...f, showPrices: v }))} />
                    </div>
                )}

                <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="w-full text-sm min-w-[700px]">
                        <thead className="bg-muted text-xs text-muted-foreground border-b border-border">
                            <tr>
                                <th className="px-3 py-2 text-left font-medium">Item</th>
                                <th className="px-3 py-2 text-right font-medium w-28">{type === "PHYSICAL_STOCK" ? "Counted Qty" : "Qty"}</th>
                                <th className="px-3 py-2 text-right font-medium w-32">Rate (₹)</th>
                                <th className="px-3 py-2 text-right font-medium w-32">Amount (₹)</th>
                                <th className="px-3 py-2 text-left font-medium">Note</th>
                                <th className="px-3 py-2 w-8" />
                            </tr>
                        </thead>
                        <tbody>
                            {form.lines.map((line, i) => {
                                const qty = parseFloat(line.quantity) || 0;
                                const rate = parseFloat(line.rate) || 0;
                                return (
                                    <tr key={i} className="border-t border-border">
                                        <td className="px-3 py-2 min-w-[200px]">
                                            <InvProductPicker
                                                label=""
                                                value={line.productId || null}
                                                onChange={(id) => updateLine(i, { productId: id ?? 0 })}
                                            />
                                        </td>
                                        <td className="px-3 py-2">
                                            <input type="text" inputMode="decimal"
                                                value={line.quantity}
                                                onChange={(e) => updateLine(i, { quantity: e.target.value })}
                                                className={`${cell} text-right`} />
                                        </td>
                                        <td className="px-3 py-2">
                                            <input type="text" inputMode="decimal" value={line.rate}
                                                onChange={(e) => updateLine(i, { rate: e.target.value })}
                                                className={`${cell} text-right`} />
                                        </td>
                                        <td className="px-3 py-2 text-right font-mono text-xs">{fmt(qty * rate)}</td>
                                        <td className="px-3 py-2">
                                            <Input
                                                value={line.description}
                                                onChange={(e) => updateLine(i, { description: e.target.value })}
                                                className={cell}
                                                placeholder="Optional"
                                            />
                                        </td>
                                        <td className="px-3 py-2 text-center">
                                            {form.lines.length > 1 && (
                                                <Button onClick={() => removeLine(i)} variant="ghost" size="icon-xs" className="text-destructive hover:text-destructive/80">
                                                    <Trash2 size={14} />
                                                </Button>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                        <tfoot className="border-t border-border bg-muted text-xs font-medium">
                            <tr>
                                <td colSpan={3} className="px-3 py-2 text-muted-foreground">Subtotal</td>
                                <td className="px-3 py-2 text-right font-mono">{fmt(subtotal)}</td>
                                <td colSpan={2} />
                            </tr>
                        </tfoot>
                    </table>
                </div>

                <div className="flex items-center justify-between">
                    <Button onClick={addLine} variant="link" size="sm" className="h-auto p-0 text-sm">+ Add line</Button>
                    <div className="flex gap-2">
                        <Button variant="outline" onClick={() => router.push(redirectTo)}>Cancel</Button>
                        <Button onClick={() => submit(false)} variant="outline" disabled={saving}>
                            {saving && <Loader2 size={14} className="animate-spin" />} Save Draft
                        </Button>
                        <Button onClick={() => submit(true)} disabled={saving} className="bg-green-600 hover:bg-green-700 text-white border-green-600">
                            {saving && <Loader2 size={14} className="animate-spin" />} Save & Post
                        </Button>
                    </div>
                </div>
            </div>
        </div>
        </BranchRequired>
    );
}

