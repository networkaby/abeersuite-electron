"use client";

/**
 * Shared full-screen voucher form for SALE + PURCHASE.
 *
 * Both are inventory-coupled vouchers — they create stock movements alongside
 * the GL entries via POST /api/inventory/vouchers. The two flows are
 * structurally identical:
 *   • Header — date, party (customer or supplier), narration.
 *   • Item table — product, qty, rate, disc %, tax %, line amount.
 *   • Footer — shipping, round-off, subtotal/tax/grand total, action buttons.
 *
 * The differences are limited and live in PER_KIND below:
 *   • SALE has a CASH / CREDIT pay-mode toggle and a Received / Balance pair
 *     so the cashier can record partial payment at the till.
 *   • PURCHASE auto-creates the party under SUNDRY_CREDITORS (a supplier),
 *     SALE under the default debtor group.
 *   • Rate auto-fills from product.salePrice (SALE) vs product.costPrice
 *     (PURCHASE).
 */

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, Trash2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InvProductCombobox, type SelectedProduct } from "@/modules/inventory/components/InvProductCombobox";
import { PartyCombobox, type SelectedParty } from "@/modules/accountancy/components/PartyCombobox";
import { ACCOUNT_GROUPS } from "@/shared/lib/constants/accounting";
import { fmt } from "@/utils/constants";

type Kind = "SALE" | "PURCHASE";

type LineState = {
    id: number;
    product: SelectedProduct | null;
    quantity: string;
    rate: string;
    discountPct: string;
    taxRate: string;
};

let lineSeq = 0;
const newLine = (): LineState => ({
    id: ++lineSeq,
    product: null,
    quantity: "1",
    rate: "",
    discountPct: "0",
    taxRate: "0",
});

function calcLine(l: LineState) {
    const qty = parseFloat(l.quantity) || 0;
    const rate = parseFloat(l.rate) || 0;
    const disc = parseFloat(l.discountPct) || 0;
    const tax = parseFloat(l.taxRate) || 0;
    const gross = qty * rate;
    const discAmt = gross * (disc / 100);
    const taxable = gross - discAmt;
    const taxAmt = taxable * (tax / 100);
    return { gross, discAmt, taxAmt, amount: taxable + taxAmt };
}

type PartyGroup = "Sundry Debtors" | "Sundry Creditors";

const PER_KIND: Record<Kind, {
    title: string;
    partyPlaceholder: string;
    partyDefaultGroup?: PartyGroup;          // PartyCombobox createUnderGroup
    narrationFallback: (party: SelectedParty | null) => string;
    narrationPlaceholderEmpty: string;
    rateFromProduct: (p: SelectedProduct) => number | null | undefined;
    successPostedMsg: string;
    successDraftMsg: string;
    listPath: string;
    detailPath: (id: number) => string;
}> = {
    SALE: {
        title: "Sale Voucher",
        partyPlaceholder: "Search party by name or phone…",
        narrationFallback: (p) => p ? `Sale to ${p.name}` : "Cash sale",
        narrationPlaceholderEmpty: "Narration (optional — invoice no auto-generated)",
        rateFromProduct: (p) => p.salePrice,
        successPostedMsg: "Sale posted — stock & GL updated",
        successDraftMsg: "Sale saved as draft",
        listPath: "/office/accountancy/sales",
        detailPath: (id) => `/office/accountancy/sales/${id}`,
    },
    PURCHASE: {
        title: "Purchase Voucher",
        partyPlaceholder: "Search supplier by name or phone…",
        partyDefaultGroup: ACCOUNT_GROUPS.SUNDRY_CREDITORS,
        narrationFallback: (p) => p ? `Purchase from ${p.name}` : "Cash purchase",
        narrationPlaceholderEmpty: "Narration (optional — bill ref auto-generated)",
        rateFromProduct: (p) => p.costPrice,
        successPostedMsg: "Purchase posted — stock & GL updated",
        successDraftMsg: "Purchase saved as draft",
        listPath: "/office/accountancy/purchases",
        detailPath: (id) => `/office/accountancy/purchases/${id}`,
    },
};

export function TradingVoucherForm({ kind }: { kind: Kind }) {
    const router = useRouter();
    const copy = PER_KIND[kind];

    const [saving, setSaving] = useState(false);
    const [lines, setLines] = useState<LineState[]>([newLine()]);
    // CASH / CREDIT toggle — SALE only. PURCHASE infers from supplier presence.
    const [payMode, setPayMode] = useState<"CREDIT" | "CASH">("CASH");
    const today = new Date().toISOString().slice(0, 10);
    const [party, setParty] = useState<SelectedParty | null>(null);
    const [header, setHeader] = useState({
        date: today,
        description: "",
        shippingAmt: "",
        roundOff: "",
        received: "",          // SALE only
    });

    const updateLine = (id: number, patch: Partial<LineState>) =>
        setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
    const removeLine = (id: number) => setLines((ls) => ls.filter((l) => l.id !== id));
    const addLine = () => setLines((ls) => [...ls, newLine()]);

    const handleProductSelect = useCallback((lineId_: number, product: SelectedProduct | null) => {
        setLines((ls) => ls.map((l) => {
            if (l.id !== lineId_) return l;
            const fillRate = product ? copy.rateFromProduct(product) : null;
            return {
                ...l,
                product,
                rate: fillRate != null ? String(fillRate) : l.rate,
            };
        }));
    }, [copy]);

    // Totals
    const computed = lines.map(calcLine);
    const subtotal = computed.reduce((s, c) => s + c.amount, 0);
    const totalTax = computed.reduce((s, c) => s + c.taxAmt, 0);
    const shipping = parseFloat(header.shippingAmt) || 0;
    const roundOff = parseFloat(header.roundOff) || 0;
    const grandTotal = subtotal + shipping + roundOff;
    const received = parseFloat(header.received) || 0;
    const balance = grandTotal - received;

    const submit = async (andPost = false) => {
        // Sale-specific: credit sales require a party (so we know who owes us).
        if (kind === "SALE" && payMode === "CREDIT" && !party) {
            toast.error("Pick or create a party for a credit sale");
            return;
        }
        const validLines = lines.filter((l) => l.product && parseFloat(l.quantity) > 0);
        if (!validLines.length) {
            toast.error("Add at least one item with a product and quantity");
            return;
        }

        const description = header.description.trim() || copy.narrationFallback(party);
        const inferredPayMode = kind === "SALE" ? payMode : (party ? "CREDIT" : "CASH");

        setSaving(true);
        try {
            const res = await axios.post<{ id: number }>("/api/inventory/vouchers", {
                type: kind,
                date: header.date,
                description,
                partyName: party?.name || undefined,
                partyPhone: party?.phone || undefined,
                partyType: party?.partyType,
                partyId: party?.partyId,
                paymentMode: inferredPayMode,
                shippingAmt: shipping,
                roundOff,
                ...(kind === "SALE" ? { amountReceived: received } : {}),
                lines: validLines.map((l) => ({
                    productId: l.product!.id,
                    quantity: parseFloat(l.quantity) || 1,
                    rate: parseFloat(l.rate) || 0,
                    discountPct: parseFloat(l.discountPct) || 0,
                    taxRate: parseFloat(l.taxRate) || 0,
                })),
            });

            if (andPost) {
                await axios.post(`/api/inventory/vouchers/${res.data.id}/post`);
                toast.success(copy.successPostedMsg);
            } else {
                toast.success(copy.successDraftMsg);
            }
            router.push(copy.detailPath(res.data.id));
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
                <div className="flex items-center gap-4">
                    <h1 className="text-lg font-bold tracking-tight">{copy.title}</h1>
                    {/* Credit / Cash toggle — SALE only */}
                    {kind === "SALE" && (
                        <div className="flex rounded-md border border-border overflow-hidden text-xs font-semibold">
                            {(["CASH", "CREDIT"] as const).map((m) => (
                                <button
                                    key={m}
                                    type="button"
                                    onClick={() => setPayMode(m)}
                                    className={`px-3 py-1.5 transition-colors ${
                                        payMode === m
                                            ? "bg-primary text-primary-foreground"
                                            : "bg-card text-muted-foreground hover:bg-muted"
                                    }`}
                                >
                                    {m}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <div className="flex items-center gap-2">
                        <span>Date</span>
                        <Input
                            type="date"
                            value={header.date}
                            onChange={(e) => setHeader((h) => ({ ...h, date: e.target.value }))}
                            className="h-7 w-36 text-xs"
                        />
                    </div>
                </div>
            </div>

            {/* ── Party row ─────────────────────────────────────────────── */}
            <div className="flex items-center gap-4 border-b border-border bg-card/60 px-6 py-3 shrink-0">
                <div className="w-80">
                    <PartyCombobox
                        value={party}
                        onChange={setParty}
                        placeholder={copy.partyPlaceholder}
                        createUnderGroup={copy.partyDefaultGroup}
                    />
                </div>
                {party?.phone && (
                    <span className="text-xs text-muted-foreground tabular-nums">{party.phone}</span>
                )}
                <Input
                    value={header.description}
                    onChange={(e) => setHeader((h) => ({ ...h, description: e.target.value }))}
                    placeholder={party ? `Narration (default: ${copy.narrationFallback(party)})` : copy.narrationPlaceholderEmpty}
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
                                        <input
                                            type="number"
                                            min="0.001"
                                            step="0.001"
                                            value={line.quantity}
                                            onChange={(e) => updateLine(line.id, { quantity: e.target.value })}
                                            className={cell}
                                        />
                                    </td>
                                    <td className="px-1 py-1.5 text-center text-xs text-muted-foreground">
                                        {line.product?.unitCode ?? "—"}
                                    </td>
                                    <td className="px-3 py-1.5">
                                        <input
                                            type="number"
                                            min="0"
                                            step="0.01"
                                            value={line.rate}
                                            onChange={(e) => updateLine(line.id, { rate: e.target.value })}
                                            className={cell}
                                            placeholder="0.00"
                                        />
                                    </td>
                                    <td className="px-3 py-1.5">
                                        <input
                                            type="number"
                                            min="0"
                                            max="100"
                                            step="0.01"
                                            value={line.discountPct}
                                            onChange={(e) => updateLine(line.id, { discountPct: e.target.value })}
                                            className={cell}
                                        />
                                    </td>
                                    <td className="px-3 py-1.5">
                                        <input
                                            type="number"
                                            min="0"
                                            max="100"
                                            step="0.01"
                                            value={line.taxRate}
                                            onChange={(e) => updateLine(line.id, { taxRate: e.target.value })}
                                            className={cell}
                                        />
                                    </td>
                                    <td className="px-3 py-1.5 text-right font-mono font-medium">
                                        {c.amount > 0 ? fmt(c.amount) : ""}
                                    </td>
                                    <td className="px-1 py-1.5 text-center opacity-0 group-hover:opacity-100 transition-opacity">
                                        {lines.length > 1 && (
                                            <Button
                                                variant="ghost"
                                                size="icon-xs"
                                                className="text-destructive/60 hover:text-destructive"
                                                onClick={() => removeLine(line.id)}
                                            >
                                                <Trash2 size={12} />
                                            </Button>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                        <tr>
                            <td colSpan={9} className="px-5 py-2">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="text-primary h-auto py-1 text-xs"
                                    onClick={addLine}
                                >
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
                    {/* Left: shipping + round off */}
                    <div className="flex items-center gap-4 text-sm">
                        <div className="space-y-1">
                            <label className="text-xs text-muted-foreground">Shipping (₹)</label>
                            <Input
                                type="number"
                                min="0"
                                step="0.01"
                                value={header.shippingAmt}
                                onChange={(e) => setHeader((h) => ({ ...h, shippingAmt: e.target.value }))}
                                className="h-7 w-24 text-xs text-right"
                                placeholder="0"
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs text-muted-foreground">Round Off</label>
                            <Input
                                type="number"
                                step="0.01"
                                value={header.roundOff}
                                onChange={(e) => setHeader((h) => ({ ...h, roundOff: e.target.value }))}
                                className="h-7 w-20 text-xs text-right"
                                placeholder="0"
                            />
                        </div>
                    </div>

                    {/* Centre: received + balance — SALE only */}
                    {kind === "SALE" && (
                        <div className="flex items-center gap-6 text-sm">
                            <div className="space-y-1">
                                <label className="text-xs text-muted-foreground">Received (₹)</label>
                                <Input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={header.received}
                                    onChange={(e) => setHeader((h) => ({ ...h, received: e.target.value }))}
                                    className="h-7 w-28 text-xs text-right"
                                    placeholder="0"
                                />
                            </div>
                            <div className="space-y-1">
                                <p className="text-xs text-muted-foreground">Balance</p>
                                <p className={`font-mono font-semibold text-sm ${balance > 0 ? "text-destructive" : "text-green-600"}`}>
                                    ₹ {fmt(balance)}
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Right: totals + actions */}
                    <div className="flex items-end gap-8">
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
                                <span>Total</span><span className="font-mono">₹ {fmt(grandTotal)}</span>
                            </div>
                        </div>

                        <div className="flex gap-2 shrink-0">
                            <Button variant="outline" onClick={() => router.push(copy.listPath)}>
                                Cancel
                            </Button>
                            <Button variant="outline" onClick={() => submit(false)} disabled={saving}>
                                {saving && <Loader2 size={13} className="animate-spin mr-1" />} Save Draft
                            </Button>
                            <Button onClick={() => submit(true)} disabled={saving}>
                                {saving && <Loader2 size={13} className="animate-spin mr-1" />} Save &amp; Post
                            </Button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
