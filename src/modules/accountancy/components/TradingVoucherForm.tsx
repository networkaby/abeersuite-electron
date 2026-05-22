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

import { useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, Trash2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { InvProductCombobox, type SelectedProduct } from "@/modules/inventory/components/InvProductCombobox";
import {
    PartySearchAndCreate,
    type PartySearchAndCreateHandle,
    type PickedParty,
} from "@/shared/components/PartySearchAndCreate";
import { ACCOUNT_GROUPS } from "@/shared/lib/constants/accounting";
import { fmt } from "@/utils/constants";
// SALE was moved to the full-page /sale route — SaleDialog export is gone.
// Purchase uses the full-page /purchase route now — no dialog store.
import { useEstimateDialogStore } from "@/store/estimateDialogStore";
import { TallyDateInput } from "@/shared/components/TallyDateInput";
import { toIsoDate } from "@/shared/hooks/useTallyDate";

// SALE + PURCHASE moved to full-page routes (/sale, /purchase) — dialog
// covers Estimate only now. The Kind union stays as a single-member union
// to keep the existing PER_KIND lookup shape; collapse if more kinds drop.
type Kind = "ESTIMATE";

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
    narrationFallback: (party: { name: string } | null) => string;
    narrationPlaceholderEmpty: string;
    rateFromProduct: (p: SelectedProduct) => number | null | undefined;
    successPostedMsg: string;
    successDraftMsg: string;
    listPath: string;
    detailPath: (id: number) => string;
}> = {
    ESTIMATE: {
        title: "Estimate / Quotation",
        partyPlaceholder: "Search customer by name or phone…",
        narrationFallback: (p) => p ? `Estimate for ${p.name}` : "Estimate",
        narrationPlaceholderEmpty: "Narration (optional — estimate no auto-generated)",
        rateFromProduct: (p) => p.salePrice,
        successPostedMsg: "Estimate saved",
        successDraftMsg: "Estimate saved",
        listPath: "/office/accountancy/estimates",
        detailPath: (id) => `/office/accountancy/estimates/${id}`,
    },
};

export function TradingVoucherForm({ kind }: { kind: Kind }) {
    const router = useRouter();
    const copy = PER_KIND[kind];
    const estimateStore = useEstimateDialogStore();
    const { open, setOpen } = estimateStore;
    // Per-kind feature flags
    const isEstimate = kind === "ESTIMATE";
    const showCashCreditToggle = false; // SALE-only path lives at /sale now
    const showReceivedBalance = false; // SALE-only path lives at /sale now
    const showSaveAndPost = !isEstimate;
    const showValidDays = isEstimate;
    const showNoStockBadge = isEstimate;

    const [saving, setSaving] = useState(false);
    const [lines, setLines] = useState<LineState[]>([newLine()]);
    // CASH / CREDIT toggle — SALE only. PURCHASE infers from supplier presence.
    const [payMode, setPayMode] = useState<"CREDIT" | "CASH">("CASH");
    const today = toIsoDate(new Date());
    const [party, setParty] = useState<PickedParty | null>(null);
    const partyPickerRef = useRef<PartySearchAndCreateHandle>(null);
    const [header, setHeader] = useState({
        date: today,
        description: "",
        shippingAmt: "",
        roundOff: "",
        received: "",          // SALE only
        validDays: "15",       // ESTIMATE only
    });

    const reset = () => {
        setLines([newLine()]);
        setPayMode("CASH");
        setParty(null);
        partyPickerRef.current?.clear();
        setHeader({ date: toIsoDate(new Date()), description: "", shippingAmt: "", roundOff: "", received: "", validDays: "15" });
    };

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
        const validLines = lines.filter((l) => l.product && parseFloat(l.quantity) > 0);
        if (!validLines.length) {
            toast.error("Add at least one item with a product and quantity");
            return;
        }

        const description = header.description.trim() || copy.narrationFallback(party);
        // Purchase + Estimate infer payMode from whether a party is linked.
        const inferredPayMode = party ? "CREDIT" : "CASH";

        setSaving(true);
        try {
            const res = await axios.post<{ id: number }>("/api/inventory/vouchers", {
                type: kind,
                date: header.date,
                description,
                partyName: party?.name || undefined,
                partyPhone: party?.phone || undefined,
                partyType: party?.kind,
                partyId: party?.id,
                paymentMode: inferredPayMode,
                shippingAmt: shipping,
                roundOff,
                // amountReceived was SALE-only and SALE is now on /sale.
                ...(isEstimate ? { validDays: parseInt(header.validDays, 10) || 15 } : {}),
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
            reset();
            setOpen(false);
            router.refresh();
        } catch (err: unknown) {
            toast.error(axios.isAxiosError(err) ? err.response?.data?.error : "Save failed");
        } finally {
            setSaving(false);
        }
    };

    const cell = "bg-transparent border-0 outline-none text-sm text-right w-full focus:bg-accent/40 rounded px-1 tabular-nums";

    return (
        <Dialog
            open={open}
            onOpenChange={(isOpen) => { if (!isOpen) { reset(); setOpen(false); } }}
        >
            <DialogContent
                className="h-[90vh] max-w-5xl gap-0 p-0 sm:max-w-5xl flex flex-col"
                // Don't dismiss on click-outside — voucher entry is too easy to
                // lose to a stray click. User must explicitly hit Cancel / Close.
                onPointerDownOutside={(e) => e.preventDefault()}
                onInteractOutside={(e) => e.preventDefault()}
            >
                <DialogHeader className="border-b border-border px-6 py-3 pr-12 shrink-0">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <DialogTitle className="text-lg">{copy.title}</DialogTitle>
                            {showNoStockBadge && (
                                <span className="rounded bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                                    No stock impact
                                </span>
                            )}
                            {/* Credit / Cash toggle — SALE only */}
                            {showCashCreditToggle && (
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
                            {showValidDays && (
                                <div className="flex items-center gap-2">
                                    <span>Valid</span>
                                    <Input
                                        type="text"
                                        inputMode="numeric"
                                        value={header.validDays}
                                        onChange={(e) => setHeader((h) => ({ ...h, validDays: e.target.value }))}
                                        className="h-7 w-16 text-xs text-right"
                                    />
                                    <span>days</span>
                                </div>
                            )}
                            <div className="flex items-center gap-2">
                                <span>Date</span>
                                <TallyDateInput
                                    value={header.date}
                                    onValueChange={(iso) => setHeader((h) => ({ ...h, date: iso }))}
                                    className="h-7 w-36 text-xs"
                                />
                            </div>
                        </div>
                    </div>
                </DialogHeader>

                {/* ── Party row ─────────────────────────────────────────────── */}
                {/* `items-start` so the search input and narration input start on the
                    same baseline; the "Include Sundry … too" checkbox can drop below
                    the search field without dragging the narration down with it. */}
                <div className="relative z-30 flex items-start gap-4 border-b border-border bg-card/60 px-6 py-3 shrink-0">
                    <div className="w-80">
                        <PartySearchAndCreate
                            ref={partyPickerRef}
                            onPicked={setParty}
                            locked={!!party}
                            placeholder={copy.partyPlaceholder}
                            // SALE / ESTIMATE → Sundry Debtors (customer).
                            // ESTIMATE — customer-only (Sundry Debtors); quotes
                            // go out to prospective buyers only.
                            partyGroup={ACCOUNT_GROUPS.SUNDRY_DEBTORS}
                            allowIncludeOther={!isEstimate}
                        />
                        {party?.phone && (
                            <span className="mt-1 inline-block pl-1 text-xs text-muted-foreground tabular-nums">{party.phone}</span>
                        )}
                    </div>
                    {party && (
                        <button
                            type="button"
                            onClick={() => { setParty(null); partyPickerRef.current?.clear(); }}
                            className="mt-2 text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline shrink-0"
                            title="Clear party"
                        >
                            Clear &times;
                        </button>
                    )}
                    <Input
                        value={header.description}
                        onChange={(e) => setHeader((h) => ({ ...h, description: e.target.value }))}
                        placeholder={party ? `Narration (default: ${copy.narrationFallback(party)})` : copy.narrationPlaceholderEmpty}
                        className="h-9 flex-1"
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
                                            type="text"
                                            inputMode="decimal"
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
                                            type="text"
                                            inputMode="decimal"
                                            value={line.rate}
                                            onChange={(e) => updateLine(line.id, { rate: e.target.value })}
                                            className={cell}
                                            placeholder="0.00"
                                        />
                                    </td>
                                    <td className="px-3 py-1.5">
                                        <input
                                            type="text"
                                            inputMode="decimal"
                                            value={line.discountPct}
                                            onChange={(e) => updateLine(line.id, { discountPct: e.target.value })}
                                            className={cell}
                                        />
                                    </td>
                                    <td className="px-3 py-1.5">
                                        <input
                                            type="text"
                                            inputMode="decimal"
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
                    <div className="flex items-end gap-4 text-sm">
                        <div className="space-y-1">
                            <label className="text-xs text-muted-foreground">Shipping (₹)</label>
                            <Input
                                type="text"
                                inputMode="decimal"
                                value={header.shippingAmt}
                                onChange={(e) => setHeader((h) => ({ ...h, shippingAmt: e.target.value }))}
                                className="h-7 w-24 text-xs text-right"
                                placeholder="0"
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs text-muted-foreground">Round Off</label>
                            <Input
                                type="text"
                                inputMode="decimal"
                                value={header.roundOff}
                                onChange={(e) => setHeader((h) => ({ ...h, roundOff: e.target.value }))}
                                className="h-7 w-20 text-xs text-right"
                                placeholder="0"
                            />
                        </div>
                    </div>

                    {/* Centre: received + balance — SALE only.
                        Same `space-y-1 + h-7` shape as Shipping / Round Off so
                        all four columns line up exactly. Balance is a read-only
                        box (not an Input) but matches the Input's height + border. */}
                    {showReceivedBalance && (
                        <div className="flex items-end gap-6 text-sm">
                            <div className="space-y-1">
                                <label className="text-xs text-muted-foreground">Received (₹)</label>
                                <Input
                                    type="text"
                                    inputMode="decimal"
                                    value={header.received}
                                    onChange={(e) => setHeader((h) => ({ ...h, received: e.target.value }))}
                                    className="h-7 w-28 text-xs text-right"
                                    placeholder="0"
                                />
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs text-muted-foreground">Balance (₹)</label>
                                <div className={`h-7 w-28 rounded-md border border-input bg-muted/40 px-2 py-1 text-right font-mono text-xs tabular-nums leading-5 ${balance > 0 ? "text-destructive" : "text-green-600 font-semibold"}`}>
                                    {fmt(balance)}
                                </div>
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
                            <Button variant="outline" onClick={() => { reset(); setOpen(false); }}>
                                Cancel
                            </Button>
                            {showSaveAndPost ? (
                                <>
                                    <Button variant="outline" onClick={() => submit(false)} disabled={saving}>
                                        {saving && <Loader2 size={13} className="animate-spin mr-1" />} Save Draft
                                    </Button>
                                    <Button onClick={() => submit(true)} disabled={saving}>
                                        {saving && <Loader2 size={13} className="animate-spin mr-1" />} Save &amp; Post
                                    </Button>
                                </>
                            ) : (
                                <Button onClick={() => submit(false)} disabled={saving}>
                                    {saving && <Loader2 size={13} className="animate-spin mr-1" />} Save Estimate
                                </Button>
                            )}
                        </div>
                    </div>
                </div>
            </div>
            </DialogContent>
        </Dialog>
    );
}

/** Thin wrappers for layout mounting + module sidebar actions. */
// SaleDialog removed — the full-page /sale route replaces it.
// PurchaseDialog removed — the full-page /purchase route replaces it.
export function EstimateDialog() { return <TradingVoucherForm kind="ESTIMATE" />; }
