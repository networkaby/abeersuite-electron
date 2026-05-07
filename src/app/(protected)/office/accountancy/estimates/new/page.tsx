"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, Trash2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InvProductCombobox, type SelectedProduct } from "@/modules/inventory/components/InvProductCombobox";
import { PartyCombobox, type SelectedParty } from "@/modules/accountancy/components/PartyCombobox";
import { fmt } from "@/utils/constants";

type LineState = {
    id:          number;
    product:     SelectedProduct | null;
    quantity:    string;
    rate:        string;
    discountPct: string;
    taxRate:     string;
};

let lineId = 0;
const newLine = (): LineState => ({
    id:          ++lineId,
    product:     null,
    quantity:    "1",
    rate:        "",
    discountPct: "0",
    taxRate:     "0",
});

function calcLine(l: LineState) {
    const qty     = parseFloat(l.quantity)    || 0;
    const rate    = parseFloat(l.rate)        || 0;
    const disc    = parseFloat(l.discountPct) || 0;
    const tax     = parseFloat(l.taxRate)     || 0;
    const gross   = qty * rate;
    const discAmt = gross * (disc / 100);
    const taxable = gross - discAmt;
    const taxAmt  = taxable * (tax / 100);
    return { gross, discAmt, taxAmt, amount: taxable + taxAmt };
}

export default function NewEstimatePage() {
    const router = useRouter();
    const [saving, setSaving] = useState(false);
    const [lines,  setLines]  = useState<LineState[]>([newLine()]);
    const today = new Date().toISOString().slice(0, 10);

    const [party, setParty] = useState<SelectedParty | null>(null);
    const [header, setHeader] = useState({
        date:         today,
        description:  "",
        shippingAmt:  "",
        roundOff:     "",
        validDays:    "30",
    });

    const updateLine = (id: number, patch: Partial<LineState>) =>
        setLines((ls) => ls.map((l) => l.id === id ? { ...l, ...patch } : l));

    const removeLine = (id: number) =>
        setLines((ls) => ls.filter((l) => l.id !== id));

    const addLine = () => setLines((ls) => [...ls, newLine()]);

    // Auto-fill sale price
    const handleProductSelect = useCallback((lineId_: number, product: SelectedProduct | null) => {
        setLines((ls) => ls.map((l) => {
            if (l.id !== lineId_) return l;
            return {
                ...l,
                product,
                rate: product?.salePrice != null ? String(product.salePrice) : l.rate,
            };
        }));
    }, []);

    // Totals
    const computed   = lines.map(calcLine);
    const subtotal   = computed.reduce((s, c) => s + c.amount, 0);
    const totalTax   = computed.reduce((s, c) => s + c.taxAmt, 0);
    const shipping   = parseFloat(header.shippingAmt) || 0;
    const roundOff   = parseFloat(header.roundOff)    || 0;
    const grandTotal = subtotal + shipping + roundOff;

    const submit = async () => {
        const validLines = lines.filter((l) => l.product && parseFloat(l.quantity) > 0);
        if (!validLines.length) { toast.error("Add at least one item with a product and quantity"); return; }

        const description = header.description.trim()
            || (party ? `Estimate for ${party.name}` : "Estimate");

        setSaving(true);
        try {
            const res = await axios.post<{ id: number }>("/api/inventory/vouchers", {
                type:        "ESTIMATE",
                date:        header.date,
                description,
                partyName:   party?.name  || undefined,
                partyPhone:  party?.phone || undefined,
                partyType:   party?.partyType,
                partyId:     party?.partyId,
                shippingAmt: shipping,
                roundOff,
                lines: validLines.map((l) => ({
                    productId:   l.product!.id,
                    quantity:    parseFloat(l.quantity)    || 1,
                    rate:        parseFloat(l.rate)        || 0,
                    discountPct: parseFloat(l.discountPct) || 0,
                    taxRate:     parseFloat(l.taxRate)     || 0,
                })),
            });

            toast.success("Estimate saved");
            router.push(`/office/accountancy/estimates/${res.data.id}`);
        } catch (err: unknown) {
            toast.error(axios.isAxiosError(err) ? err.response?.data?.error : "Save failed");
        } finally {
            setSaving(false);
        }
    };

    const cell = "bg-transparent border-0 outline-none text-sm text-right w-full focus:bg-accent/40 rounded px-1 tabular-nums";

    return (
        <div className="flex flex-col h-[calc(100vh-4rem)] -m-8 bg-background">
            {/* ── Top bar ──────────────────────────────────────────────────── */}
            <div className="flex items-center justify-between border-b border-border bg-card px-6 py-3 shrink-0">
                <div className="flex items-center gap-3">
                    <h1 className="text-lg font-bold tracking-tight">Estimate / Quotation</h1>
                    <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 font-medium">No stock impact</span>
                </div>
                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <div className="flex items-center gap-2">
                        <span>Valid</span>
                        <Input type="number" min="1" value={header.validDays}
                            onChange={(e) => setHeader((h) => ({ ...h, validDays: e.target.value }))}
                            className="h-7 w-16 text-xs text-right" />
                        <span>days</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <span>Date</span>
                        <Input type="date" value={header.date}
                            onChange={(e) => setHeader((h) => ({ ...h, date: e.target.value }))}
                            className="h-7 w-36 text-xs" />
                    </div>
                </div>
            </div>

            {/* ── Customer row ─────────────────────────────────────────────── */}
            <div className="flex items-center gap-4 border-b border-border bg-card/60 px-6 py-3 shrink-0">
                <div className="w-80">
                    <PartyCombobox
                        value={party}
                        onChange={setParty}
                        placeholder="Search customer by name or phone…"
                    />
                </div>
                {party?.phone && (
                    <span className="text-xs text-muted-foreground tabular-nums">{party.phone}</span>
                )}
                <Input
                    value={header.description}
                    onChange={(e) => setHeader((h) => ({ ...h, description: e.target.value }))}
                    placeholder={party ? `Narration (default: Estimate for ${party.name})` : "Narration (optional — estimate no auto-generated)"}
                    className="h-8 flex-1"
                />
            </div>

            {/* ── Item table ───────────────────────────────────────────────── */}
            <div className="flex-1 overflow-auto">
                <table className="w-full text-sm border-collapse">
                    <thead className="sticky top-0 z-10 bg-muted border-b border-border text-xs text-muted-foreground">
                        <tr>
                            <th className="w-6 px-2 py-2 text-center font-medium">#</th>
                            <th className="px-3 py-2 text-left font-medium min-w-[220px]">ITEM</th>
                            <th className="px-3 py-2 text-right font-medium w-24">QTY</th>
                            <th className="px-3 py-2 text-right font-medium w-8 text-muted-foreground/60">UNIT</th>
                            <th className="px-3 py-2 text-right font-medium w-28">PRICE/UNIT (₹)</th>
                            <th className="px-3 py-2 text-right font-medium w-20">DISC %</th>
                            <th className="px-3 py-2 text-right font-medium w-28">TAX %</th>
                            <th className="px-3 py-2 text-right font-medium w-32">AMOUNT (₹)</th>
                            <th className="w-8" />
                        </tr>
                    </thead>
                    <tbody>
                        {lines.map((line, i) => {
                            const c = computed[i];
                            return (
                                <tr key={line.id} className="border-b border-border/50 hover:bg-muted/20 group">
                                    <td className="px-2 py-1.5 text-center text-muted-foreground text-xs">{i + 1}</td>
                                    <td className="px-3 py-1.5 relative">
                                        <InvProductCombobox
                                            value={line.product?.id ?? null}
                                            onChange={(p) => handleProductSelect(line.id, p)}
                                            autoFocus={i === 0 && !line.product}
                                        />
                                    </td>
                                    <td className="px-3 py-1.5">
                                        <input type="number" min="0.001" step="0.001" value={line.quantity}
                                            onChange={(e) => updateLine(line.id, { quantity: e.target.value })}
                                            className={cell} />
                                    </td>
                                    <td className="px-1 py-1.5 text-center text-xs text-muted-foreground">
                                        {line.product?.unitCode ?? "—"}
                                    </td>
                                    <td className="px-3 py-1.5">
                                        <input type="number" min="0" step="0.01" value={line.rate}
                                            onChange={(e) => updateLine(line.id, { rate: e.target.value })}
                                            className={cell} placeholder="0.00" />
                                    </td>
                                    <td className="px-3 py-1.5">
                                        <input type="number" min="0" max="100" step="0.01" value={line.discountPct}
                                            onChange={(e) => updateLine(line.id, { discountPct: e.target.value })}
                                            className={cell} />
                                    </td>
                                    <td className="px-3 py-1.5">
                                        <input type="number" min="0" max="100" step="0.01" value={line.taxRate}
                                            onChange={(e) => updateLine(line.id, { taxRate: e.target.value })}
                                            className={cell} />
                                    </td>
                                    <td className="px-3 py-1.5 text-right font-mono font-medium">
                                        {c.amount > 0 ? fmt(c.amount) : ""}
                                    </td>
                                    <td className="px-1 py-1.5 text-center opacity-0 group-hover:opacity-100 transition-opacity">
                                        {lines.length > 1 && (
                                            <Button variant="ghost" size="icon-xs"
                                                className="text-destructive/60 hover:text-destructive"
                                                onClick={() => removeLine(line.id)}>
                                                <Trash2 size={12} />
                                            </Button>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                        <tr>
                            <td colSpan={9} className="px-5 py-2">
                                <Button variant="ghost" size="sm" className="text-primary h-auto py-1 text-xs" onClick={addLine}>
                                    <Plus size={12} className="mr-1" /> Add Item
                                </Button>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>

            {/* ── Footer ───────────────────────────────────────────────────── */}
            <div className="border-t border-border bg-card shrink-0">
                <div className="flex items-end justify-between px-6 py-4 gap-8">
                    <div className="flex items-center gap-4 text-sm">
                        <div className="space-y-1">
                            <label className="text-xs text-muted-foreground">Shipping (₹)</label>
                            <Input type="number" min="0" step="0.01" value={header.shippingAmt}
                                onChange={(e) => setHeader((h) => ({ ...h, shippingAmt: e.target.value }))}
                                className="h-7 w-24 text-xs text-right" placeholder="0" />
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs text-muted-foreground">Round Off</label>
                            <Input type="number" step="0.01" value={header.roundOff}
                                onChange={(e) => setHeader((h) => ({ ...h, roundOff: e.target.value }))}
                                className="h-7 w-20 text-xs text-right" placeholder="0" />
                        </div>
                    </div>

                    <div className="min-w-[200px] text-sm space-y-0.5">
                        <div className="flex justify-between gap-8 text-muted-foreground">
                            <span>Subtotal</span><span className="font-mono">₹ {fmt(subtotal)}</span>
                        </div>
                        {totalTax > 0 && (
                            <div className="flex justify-between gap-8 text-muted-foreground">
                                <span>Tax</span><span className="font-mono">₹ {fmt(totalTax)}</span>
                            </div>
                        )}
                        {shipping > 0 && (
                            <div className="flex justify-between gap-8 text-muted-foreground">
                                <span>Shipping</span><span className="font-mono">₹ {fmt(shipping)}</span>
                            </div>
                        )}
                        <div className="flex justify-between gap-8 font-bold text-base border-t border-border pt-1">
                            <span>Estimate Total</span><span className="font-mono">₹ {fmt(grandTotal)}</span>
                        </div>
                    </div>

                    <div className="flex gap-2 shrink-0">
                        <Button variant="outline" onClick={() => router.push("/office/accountancy/estimates")}>
                            Cancel
                        </Button>
                        <Button onClick={submit} disabled={saving}>
                            {saving && <Loader2 size={13} className="animate-spin mr-1" />} Save Estimate
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}
