"use client";

/**
 * EXPLORATORY — parallel "full-screen for laptop" variant of TradingVoucherForm.
 *
 * Goals vs the live dialog:
 *   - Wider canvas (max-w-[95vw], h-[95vh]) so the item table can breathe on a
 *     1366–1920 px laptop screen instead of cramping into 5xl.
 *   - Totals + action buttons live in a sticky right rail so they stay visible
 *     while the user scrolls down a long item table.
 *   - The header is a 3-column grid (title/badges | date / valid days |
 *     party + narration) instead of stacked rows.
 *
 * Indian-SMB feature parity additions (vs live dialog):
 *   - Invoice-number preview at the top of the dialog.
 *   - Per-line description (toggled via "+ note") + free qty + MRP hint.
 *   - Discount / tax ₹ amount displayed under each % input.
 *   - Overall voucher discount (% ↔ ₹ mutually convertible).
 *   - Payment Terms + Due Date (CREDIT only).
 *   - Show Profit overlay — live computed from product.salePrice − costPrice.
 *   - Save & Print — POST + post + open /receipt/invoice/[id]?autoprint=1.
 *
 * Wired to its own dedicated store (useSaleFullScreenDialogStore) so you can
 * open it side-by-side with the live Sale dialog to compare. Delete this file
 * + the store + route stub once the layout direction is chosen.
 */

import { Fragment, useState, useCallback, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, Trash2, Plus, StickyNote, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
    DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
    DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import { InvProductCombobox, type SelectedProduct } from "@/modules/inventory/components/InvProductCombobox";
import {
    PartySearchAndCreate,
    type PartySearchAndCreateHandle,
    type PickedParty,
} from "@/shared/components/PartySearchAndCreate";
import { ACCOUNT_GROUPS } from "@/shared/lib/constants/accounting";
import { fmt } from "@/utils/constants";
import { useSaleFullScreenDialogStore } from "@/store/saleFullScreenDialogStore";

// Experiment only supports SALE for now. Easy to extend if we like the layout.
type Kind = "SALE";

type LineState = {
    id: number;
    product: SelectedProduct | null;
    quantity: string;
    freeQty: string;             // complimentary qty — flows out of stock, ₹0 revenue
    rate: string;
    // Discount can be entered as a percentage OR an absolute amount; the two
    // are kept in sync as the user edits either. discountAmt is the canonical
    // value used in calcLine; discountPct is recomputed from qty × rate.
    discountPct: string;
    discountAmt: string;
    // Tax mirrors the same pattern — edit %, ₹ back-fills (and vice versa).
    taxRate: string;
    taxAmount: string;
    description: string;         // optional per-line note (toggled via "+ note" button)
    showDescription: boolean;    // UI flag — keeps the input row collapsed until needed
};

let lineSeq = 0;
const newLine = (): LineState => ({
    id: ++lineSeq,
    product: null,
    quantity: "1",
    freeQty: "0",
    rate: "",
    discountPct: "0",
    discountAmt: "0",
    taxRate: "0",
    taxAmount: "0",
    description: "",
    showDescription: false,
});

// Optional toggles that suppress hidden values — if the user has hidden the
// DISC / TAX columns, the stored numbers must not silently apply to totals.
type CalcOpts = { applyDiscount?: boolean; applyTax?: boolean };
function calcLine(l: LineState, opts: CalcOpts = {}) {
    const { applyDiscount = true, applyTax = true } = opts;
    const qty = parseFloat(l.quantity) || 0;
    const rate = parseFloat(l.rate) || 0;
    const gross = qty * rate;
    // Use the absolute amounts (kept in sync with the % inputs) as the source
    // of truth — they survive across qty/rate edits without the % field
    // silently shifting the ₹ value.
    const discAmt = applyDiscount ? (parseFloat(l.discountAmt) || 0) : 0;
    const taxable = gross - discAmt;
    const taxAmt = applyTax ? (parseFloat(l.taxAmount) || 0) : 0;
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
};

// Payment-term presets. "Custom" leaves the due-date field free-form.
const PAYMENT_TERMS: { label: string; days: number | null }[] = [
    { label: "Due on Receipt", days: 0 },
    { label: "Net 15",         days: 15 },
    { label: "Net 30",         days: 30 },
    { label: "Net 45",         days: 45 },
    { label: "Net 60",         days: 60 },
    { label: "Custom",         days: null },
];

function addDays(isoDate: string, days: number): string {
    const d = new Date(isoDate);
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
}

export function TradingVoucherFullScreenForm({ kind }: { kind: Kind }) {
    const router = useRouter();
    const copy = PER_KIND[kind];
    const { open, setOpen } = useSaleFullScreenDialogStore();
    // Sale-flavour feature flags (mirrors the live dialog for parity).
    const isEstimate = false;
    const showCashCreditToggle = kind === "SALE";
    const showReceivedBalance = kind === "SALE";
    const showSaveAndPost = !isEstimate;
    const showValidDays = isEstimate;
    const showNoStockBadge = isEstimate;

    const [saving, setSaving] = useState(false);
    const [lines, setLines] = useState<LineState[]>([newLine()]);
    // CASH / CREDIT toggle — SALE only. PURCHASE infers from supplier presence.
    const [payMode, setPayMode] = useState<"CREDIT" | "CASH">("CASH");
    const today = new Date().toISOString().slice(0, 10);
    const [party, setParty] = useState<PickedParty | null>(null);
    const partyPickerRef = useRef<PartySearchAndCreateHandle>(null);
    const [header, setHeader] = useState({
        date: today,
        description: "",
        shippingAmt: "",
        roundOff: "",
        received: "",          // SALE only
        validDays: "15",       // ESTIMATE only
        // Voucher-level discount — pct ↔ amt are kept in sync as the user edits.
        discountPct: "0",
        discountAmt: "0",
        // CREDIT-only — payment terms label + computed due date.
        paymentTerms: "Net 30",
        dueDate: addDays(today, 30),
    });

    // Pre-generated invoice number — shown read-only in the header so the user
    // knows the reference that will be assigned at save time.
    const [nextRef, setNextRef] = useState("");
    useEffect(() => {
        if (!open) return;
        axios.get<{ reference: string }>(`/api/inventory/vouchers/next-ref?type=${kind}`)
            .then((r) => setNextRef(r.data.reference))
            .catch(() => setNextRef(""));
    }, [open, kind]);

    // Live profit overlay toggle.
    const [showProfit, setShowProfit] = useState(false);

    // ── Column / feature visibility ────────────────────────────────────────
    // Persisted to localStorage so the user's column preferences survive page
    // reloads. Mirrors the "+" settings menu in Vyapar-style invoices: each
    // toggle controls one column or one footer field. Defaults aim at the
    // smallest useful layout — extras (Free Qty, MRP hint, overall discount)
    // stay off until the user opts in.
    type ColumnPrefs = {
        freeQty: boolean;
        mrpHint: boolean;
        lineDiscount: boolean;
        lineTax: boolean;
        lineDescription: boolean;
        overallDiscount: boolean;
    };
    const DEFAULT_PREFS: ColumnPrefs = {
        freeQty: false,
        mrpHint: true,
        lineDiscount: true,
        lineTax: true,
        lineDescription: true,
        overallDiscount: false,
    };
    const PREFS_KEY = "tradingVoucherFullScreen.columnPrefs.v1";
    const [prefs, setPrefs] = useState<ColumnPrefs>(DEFAULT_PREFS);
    useEffect(() => {
        // Hydrate from localStorage on mount — guarded for SSR safety.
        if (typeof window === "undefined") return;
        try {
            const raw = window.localStorage.getItem(PREFS_KEY);
            if (raw) setPrefs({ ...DEFAULT_PREFS, ...JSON.parse(raw) });
        } catch { /* ignore — fall back to defaults */ }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    const togglePref = (k: keyof ColumnPrefs) => {
        setPrefs((p) => {
            const next = { ...p, [k]: !p[k] };
            try { window.localStorage.setItem(PREFS_KEY, JSON.stringify(next)); }
            catch { /* localStorage unavailable — ignore */ }
            return next;
        });
    };

    const reset = () => {
        setLines([newLine()]);
        setPayMode("CASH");
        setParty(null);
        partyPickerRef.current?.clear();
        const t = new Date().toISOString().slice(0, 10);
        setHeader({
            date: t,
            description: "",
            shippingAmt: "",
            roundOff: "",
            received: "",
            validDays: "15",
            discountPct: "0",
            discountAmt: "0",
            paymentTerms: "Net 30",
            dueDate: addDays(t, 30),
        });
        setShowProfit(false);
    };

    const updateLine = (id: number, patch: Partial<LineState>) =>
        setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
    const removeLine = (id: number) => setLines((ls) => ls.filter((l) => l.id !== id));
    const addLine = () => setLines((ls) => [...ls, newLine()]);

    // Helper: re-derive the tax ₹ from the current tax % against the
    // post-discount taxable. Called whenever discount changes (since tax is
    // computed on top of taxable = gross − discount).
    const withTaxFromRate = (l: LineState): LineState => {
        const gross = (parseFloat(l.quantity) || 0) * (parseFloat(l.rate) || 0);
        const discAmt = parseFloat(l.discountAmt) || 0;
        const taxable = gross - discAmt;
        const tRate = parseFloat(l.taxRate) || 0;
        const newTaxAmt = taxable * (tRate / 100);
        return { ...l, taxAmount: newTaxAmt > 0 ? newTaxAmt.toFixed(2) : "0" };
    };

    // Paired (% ↔ ₹) editors. Editing the percentage recomputes the absolute
    // amount from gross (= qty × rate); editing the amount recomputes the
    // percentage. Tax is applied to the post-discount taxable value, so any
    // discount change also re-derives the tax ₹ from the standing tax %.
    const setLineDiscountPct = (id: number, pct: string) => {
        setLines((ls) => ls.map((l) => {
            if (l.id !== id) return l;
            const gross = (parseFloat(l.quantity) || 0) * (parseFloat(l.rate) || 0);
            const p = parseFloat(pct) || 0;
            const amt = gross * (p / 100);
            return withTaxFromRate({ ...l, discountPct: pct, discountAmt: amt > 0 ? amt.toFixed(2) : "0" });
        }));
    };
    const setLineDiscountAmt = (id: number, amt: string) => {
        setLines((ls) => ls.map((l) => {
            if (l.id !== id) return l;
            const gross = (parseFloat(l.quantity) || 0) * (parseFloat(l.rate) || 0);
            const a = parseFloat(amt) || 0;
            const pct = gross > 0 ? (a / gross) * 100 : 0;
            return withTaxFromRate({ ...l, discountAmt: amt, discountPct: pct > 0 ? pct.toFixed(2) : "0" });
        }));
    };
    const setLineTaxRate = (id: number, rate: string) => {
        setLines((ls) => ls.map((l) => {
            if (l.id !== id) return l;
            return withTaxFromRate({ ...l, taxRate: rate });
        }));
    };
    const setLineTaxAmount = (id: number, amt: string) => {
        setLines((ls) => ls.map((l) => {
            if (l.id !== id) return l;
            const gross = (parseFloat(l.quantity) || 0) * (parseFloat(l.rate) || 0);
            const discAmt = parseFloat(l.discountAmt) || 0;
            const taxable = gross - discAmt;
            const a = parseFloat(amt) || 0;
            const r = taxable > 0 ? (a / taxable) * 100 : 0;
            return { ...l, taxAmount: amt, taxRate: r > 0 ? r.toFixed(2) : "0" };
        }));
    };

    // When qty or rate change, the underlying gross shifts — recompute the ₹
    // amounts from the current %s so the user's intent ("5% discount") sticks.
    const setLineQtyOrRate = (id: number, patch: { quantity?: string; rate?: string }) => {
        setLines((ls) => ls.map((l) => {
            if (l.id !== id) return l;
            const next = { ...l, ...patch };
            const gross = (parseFloat(next.quantity) || 0) * (parseFloat(next.rate) || 0);
            const dPct = parseFloat(next.discountPct) || 0;
            const newDiscAmt = gross * (dPct / 100);
            return withTaxFromRate({
                ...next,
                discountAmt: newDiscAmt > 0 ? newDiscAmt.toFixed(2) : "0",
            });
        }));
    };

    const handleProductSelect = useCallback((lineId_: number, product: SelectedProduct | null) => {
        setLines((ls) => ls.map((l) => {
            if (l.id !== lineId_) return l;
            const fillRate = product ? copy.rateFromProduct(product) : null;
            const nextRate = fillRate != null ? String(fillRate) : l.rate;
            // Recompute disc + tax ₹ from current %s against the new gross.
            const gross = (parseFloat(l.quantity) || 0) * (parseFloat(nextRate) || 0);
            const dPct = parseFloat(l.discountPct) || 0;
            const newDiscAmt = gross * (dPct / 100);
            const taxable = gross - newDiscAmt;
            const tRate = parseFloat(l.taxRate) || 0;
            const newTaxAmt = taxable * (tRate / 100);
            return {
                ...l,
                product,
                rate: nextRate,
                discountAmt: newDiscAmt > 0 ? newDiscAmt.toFixed(2) : "0",
                taxAmount:   newTaxAmt > 0 ? newTaxAmt.toFixed(2) : "0",
            };
        }));
    }, [copy]);

    // Totals — hidden columns (toggled off in the settings menu) are excluded
    // so the visible UI is the single source of truth for the invoice.
    const computed = lines.map((l) => calcLine(l, {
        applyDiscount: prefs.lineDiscount,
        applyTax:      prefs.lineTax,
    }));
    const lineSubtotal = computed.reduce((s, c) => s + c.amount, 0);
    const totalTax = computed.reduce((s, c) => s + c.taxAmt, 0);
    const shipping = parseFloat(header.shippingAmt) || 0;
    const roundOff = parseFloat(header.roundOff) || 0;
    const overallDiscount = prefs.overallDiscount ? (parseFloat(header.discountAmt) || 0) : 0;
    const subtotalAfterDiscount = lineSubtotal - overallDiscount;
    const grandTotal = subtotalAfterDiscount + shipping + roundOff;
    const received = parseFloat(header.received) || 0;
    const balance = grandTotal - received;

    // Helpers for the mutually-convertible overall discount inputs.
    const handleDiscountPctChange = (pct: string) => {
        const p = parseFloat(pct) || 0;
        const amt = (lineSubtotal * p) / 100;
        setHeader((h) => ({
            ...h,
            discountPct: pct,
            discountAmt: amt > 0 ? amt.toFixed(2) : "0",
        }));
    };
    const handleDiscountAmtChange = (amt: string) => {
        const a = parseFloat(amt) || 0;
        const pct = lineSubtotal > 0 ? (a / lineSubtotal) * 100 : 0;
        setHeader((h) => ({
            ...h,
            discountAmt: amt,
            discountPct: pct > 0 ? pct.toFixed(2) : "0",
        }));
    };

    // Payment-terms ↔ due-date sync. Picking a preset overwrites the date;
    // editing the date manually leaves the label alone (acts as "Custom").
    const handlePaymentTermsChange = (term: string) => {
        const preset = PAYMENT_TERMS.find((t) => t.label === term);
        setHeader((h) => ({
            ...h,
            paymentTerms: term,
            dueDate: preset && preset.days != null ? addDays(h.date, preset.days) : h.dueDate,
        }));
    };

    // Live profit calc — sale - cost per line, then net of overall discount.
    const lineProfits = lines.map((l) => {
        const qty = parseFloat(l.quantity) || 0;
        const rate = parseFloat(l.rate) || 0;
        const cost = l.product?.costPrice ?? 0;
        const disc = parseFloat(l.discountPct) || 0;
        const gross = qty * rate;
        const discAmt = gross * (disc / 100);
        const revenue = gross - discAmt;
        const costTotal = qty * cost;
        const profit = revenue - costTotal;
        return { id: l.id, name: l.product?.name ?? "—", qty, rate, cost, revenue, profit };
    });
    const totalLineProfit = lineProfits.reduce((s, p) => s + p.profit, 0);
    const estimatedProfit = totalLineProfit - overallDiscount;
    const margin = grandTotal > 0 ? (estimatedProfit / grandTotal) * 100 : 0;

    const submit = async (andPost = false, andPrint = false) => {
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
                partyType: party?.kind,
                partyId: party?.id,
                paymentMode: inferredPayMode,
                ...(inferredPayMode === "CREDIT" ? {
                    paymentTerms: header.paymentTerms || undefined,
                    dueDate: header.dueDate || undefined,
                } : {}),
                shippingAmt: shipping,
                roundOff,
                // Overall discount only applied when the footer toggle is on.
                discountPct: prefs.overallDiscount ? (parseFloat(header.discountPct) || 0) : 0,
                discountAmt: overallDiscount,
                ...(kind === "SALE" ? { amountReceived: received } : {}),
                ...(isEstimate ? { validDays: parseInt(header.validDays, 10) || 15 } : {}),
                lines: validLines.map((l) => ({
                    productId: l.product!.id,
                    description: prefs.lineDescription ? (l.description.trim() || undefined) : undefined,
                    quantity: parseFloat(l.quantity) || 1,
                    // Hidden columns => zero (UI is single source of truth).
                    freeQty: prefs.freeQty ? (parseFloat(l.freeQty) || 0) : 0,
                    rate: parseFloat(l.rate) || 0,
                    // Send both pct and absolute amt — server's calcLineTotals
                    // prefers the explicit amount when > 0 so user-typed ₹
                    // values are persisted exactly without round-trip drift.
                    discountPct: prefs.lineDiscount ? (parseFloat(l.discountPct) || 0) : 0,
                    discountAmt: prefs.lineDiscount ? (parseFloat(l.discountAmt) || 0) : 0,
                    taxRate: prefs.lineTax ? (parseFloat(l.taxRate) || 0) : 0,
                })),
            });

            if (andPost) {
                await axios.post(`/api/inventory/vouchers/${res.data.id}/post`);
                toast.success(copy.successPostedMsg);
            } else {
                toast.success(copy.successDraftMsg);
            }
            // Open print receipt in a new tab when "Save & Print" was used.
            if (andPrint) {
                window.open(`/receipt/invoice/${res.data.id}?autoprint=1`, "_blank", "noopener");
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
                className="h-[95vh] w-[95vw] max-w-[1600px] gap-0 p-0 sm:max-w-[1600px] flex flex-col"
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
                            {/* Invoice-number preview — read-only, race-safe to ±1. */}
                            <span className="font-mono text-xs tabular-nums" title="Reference assigned at save (may shift ±1 on concurrent saves)">
                                {nextRef || "Generating…"}
                            </span>
                            {showValidDays && (
                                <div className="flex items-center gap-2">
                                    <span>Valid</span>
                                    <Input
                                        type="number"
                                        min="1"
                                        value={header.validDays}
                                        onChange={(e) => setHeader((h) => ({ ...h, validDays: e.target.value }))}
                                        className="h-7 w-16 text-xs text-right"
                                    />
                                    <span>days</span>
                                </div>
                            )}
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
                </DialogHeader>

                {/* ── Party row ─────────────────────────────────────────────── */}
                <div className="relative z-30 flex items-start gap-4 border-b border-border bg-card/60 px-6 py-3 shrink-0">
                    <div className="w-80">
                        <PartySearchAndCreate
                            ref={partyPickerRef}
                            onPicked={setParty}
                            locked={!!party}
                            placeholder={copy.partyPlaceholder}
                            partyGroup={ACCOUNT_GROUPS.SUNDRY_DEBTORS}
                            allowIncludeOther
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
                    {/* Payment terms + due date — CREDIT only */}
                    {payMode === "CREDIT" && (
                        <div className="flex items-center gap-2 shrink-0">
                            <Select value={header.paymentTerms} onValueChange={handlePaymentTermsChange}>
                                <SelectTrigger className="h-9 w-36 text-xs">
                                    <SelectValue placeholder="Payment Terms" />
                                </SelectTrigger>
                                <SelectContent>
                                    {PAYMENT_TERMS.map((t) => (
                                        <SelectItem key={t.label} value={t.label} className="text-xs">
                                            {t.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <Input
                                type="date"
                                value={header.dueDate}
                                onChange={(e) => setHeader((h) => ({ ...h, dueDate: e.target.value }))}
                                className="h-9 w-36 text-xs"
                                title="Due Date"
                            />
                        </div>
                    )}
                </div>

                {/* ── Item table ───────────────────────────────────────────────── */}
                <div className="flex-1 overflow-auto">
                <table className="w-full text-sm border-collapse">
                    <thead className="sticky top-0 z-10 bg-muted border-b border-border text-xs text-muted-foreground">
                        <tr>
                            <th rowSpan={2} className="w-6 px-2 py-2 text-center font-medium align-bottom">#</th>
                            <th rowSpan={2} className="px-3 py-2 text-left font-medium min-w-[220px] align-bottom">ITEM</th>
                            <th rowSpan={2} className="px-3 py-2 text-right font-medium w-24 align-bottom">QTY</th>
                            {prefs.freeQty && (
                                <th rowSpan={2} className="px-3 py-2 text-right font-medium w-20 align-bottom" title="Free / complimentary quantity">FREE</th>
                            )}
                            <th rowSpan={2} className="px-3 py-2 text-right font-medium w-10 text-muted-foreground/60 align-bottom">UNIT</th>
                            <th rowSpan={2} className="px-3 py-2 text-right font-medium w-28 align-bottom">PRICE/UNIT (₹)</th>
                            {prefs.lineDiscount && (
                                <th colSpan={2} className="px-3 pt-2 pb-0 text-center font-medium border-b-0">DISCOUNT</th>
                            )}
                            {prefs.lineTax && (
                                <th colSpan={2} className="px-3 pt-2 pb-0 text-center font-medium border-b-0">TAX</th>
                            )}
                            <th rowSpan={2} className="px-3 py-2 text-right font-medium w-32 align-bottom">AMOUNT (₹)</th>
                            <th rowSpan={2} className="w-16 px-1 py-2 text-right align-bottom">
                                {/* Column / feature visibility — Vyapar-style "+" menu */}
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button
                                            variant="ghost"
                                            size="icon-xs"
                                            className="text-muted-foreground hover:text-foreground"
                                            title="Column settings"
                                        >
                                            <Settings2 size={13} />
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end" className="w-56">
                                        <DropdownMenuLabel className="text-xs">Show columns</DropdownMenuLabel>
                                        <DropdownMenuCheckboxItem checked={prefs.freeQty} onCheckedChange={() => togglePref("freeQty")}>
                                            Free Qty
                                        </DropdownMenuCheckboxItem>
                                        <DropdownMenuCheckboxItem checked={prefs.lineDiscount} onCheckedChange={() => togglePref("lineDiscount")}>
                                            Discount %
                                        </DropdownMenuCheckboxItem>
                                        <DropdownMenuCheckboxItem checked={prefs.lineTax} onCheckedChange={() => togglePref("lineTax")}>
                                            Tax %
                                        </DropdownMenuCheckboxItem>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuLabel className="text-xs">Per-line extras</DropdownMenuLabel>
                                        <DropdownMenuCheckboxItem checked={prefs.mrpHint} onCheckedChange={() => togglePref("mrpHint")}>
                                            MRP hint
                                        </DropdownMenuCheckboxItem>
                                        <DropdownMenuCheckboxItem checked={prefs.lineDescription} onCheckedChange={() => togglePref("lineDescription")}>
                                            Description (note)
                                        </DropdownMenuCheckboxItem>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuLabel className="text-xs">Footer fields</DropdownMenuLabel>
                                        <DropdownMenuCheckboxItem checked={prefs.overallDiscount} onCheckedChange={() => togglePref("overallDiscount")}>
                                            Overall Discount
                                        </DropdownMenuCheckboxItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            </th>
                        </tr>
                        {(prefs.lineDiscount || prefs.lineTax) && (
                            <tr className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                                {prefs.lineDiscount && (
                                    <>
                                        <th className="px-1 pb-1 text-right font-medium w-16">%</th>
                                        <th className="px-1 pb-1 text-right font-medium w-20">₹</th>
                                    </>
                                )}
                                {prefs.lineTax && (
                                    <>
                                        <th className="px-1 pb-1 text-right font-medium w-16">%</th>
                                        <th className="px-1 pb-1 text-right font-medium w-20">₹</th>
                                    </>
                                )}
                            </tr>
                        )}
                    </thead>
                    <tbody>
                        {lines.map((line, i) => {
                            const c = computed[i];
                            const mrp = line.product?.mrp;
                            return (
                                <Fragment key={line.id}>
                                <tr className="border-b border-border/50 hover:bg-muted/20 group">
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
                                            onChange={(e) => setLineQtyOrRate(line.id, { quantity: e.target.value })}
                                            className={cell}
                                        />
                                    </td>
                                    {prefs.freeQty && (
                                        <td className="px-3 py-1.5">
                                            <input
                                                type="number"
                                                min="0"
                                                step="0.001"
                                                value={line.freeQty}
                                                onChange={(e) => updateLine(line.id, { freeQty: e.target.value })}
                                                className={cell}
                                                placeholder="0"
                                            />
                                        </td>
                                    )}
                                    <td className="px-1 py-1.5 text-center text-xs text-muted-foreground">
                                        {line.product?.unitCode ?? "—"}
                                    </td>
                                    <td className="px-3 py-1.5">
                                        <input
                                            type="number"
                                            min="0"
                                            step="0.01"
                                            value={line.rate}
                                            onChange={(e) => setLineQtyOrRate(line.id, { rate: e.target.value })}
                                            className={cell}
                                            placeholder="0.00"
                                        />
                                        {prefs.mrpHint && mrp != null && mrp > 0 && (
                                            <div className="text-[10px] text-muted-foreground text-right tabular-nums leading-tight pr-1">
                                                MRP ₹{fmt(mrp)}
                                            </div>
                                        )}
                                    </td>
                                    {prefs.lineDiscount && (
                                        <>
                                            <td className="px-1 py-1.5 border-l border-border/40">
                                                <input
                                                    type="number"
                                                    min="0"
                                                    max="100"
                                                    step="0.01"
                                                    value={line.discountPct}
                                                    onChange={(e) => setLineDiscountPct(line.id, e.target.value)}
                                                    className={cell}
                                                    placeholder="%"
                                                />
                                            </td>
                                            <td className="px-1 py-1.5">
                                                <input
                                                    type="number"
                                                    min="0"
                                                    step="0.01"
                                                    value={line.discountAmt}
                                                    onChange={(e) => setLineDiscountAmt(line.id, e.target.value)}
                                                    className={cell}
                                                    placeholder="0.00"
                                                />
                                            </td>
                                        </>
                                    )}
                                    {prefs.lineTax && (
                                        <>
                                            <td className="px-1 py-1.5 border-l border-border/40">
                                                <input
                                                    type="number"
                                                    min="0"
                                                    max="100"
                                                    step="0.01"
                                                    value={line.taxRate}
                                                    onChange={(e) => setLineTaxRate(line.id, e.target.value)}
                                                    className={cell}
                                                    placeholder="%"
                                                />
                                            </td>
                                            <td className="px-1 py-1.5">
                                                <input
                                                    type="number"
                                                    min="0"
                                                    step="0.01"
                                                    value={line.taxAmount}
                                                    onChange={(e) => setLineTaxAmount(line.id, e.target.value)}
                                                    className={cell}
                                                    placeholder="0.00"
                                                />
                                            </td>
                                        </>
                                    )}
                                    <td className="px-3 py-1.5 text-right font-mono font-medium">
                                        {c.amount > 0 ? fmt(c.amount) : ""}
                                    </td>
                                    <td className="px-1 py-1.5 text-center">
                                        <div className="flex items-center justify-end gap-1">
                                            {prefs.lineDescription && (
                                                <Button
                                                    variant="ghost"
                                                    size="icon-xs"
                                                    className={`${line.showDescription ? "text-primary" : "text-muted-foreground/60 hover:text-foreground opacity-0 group-hover:opacity-100"} transition-opacity`}
                                                    onClick={() => updateLine(line.id, { showDescription: !line.showDescription })}
                                                    title="Toggle note"
                                                >
                                                    <StickyNote size={12} />
                                                </Button>
                                            )}
                                            {lines.length > 1 && (
                                                <Button
                                                    variant="ghost"
                                                    size="icon-xs"
                                                    className="text-destructive/60 hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                                                    onClick={() => removeLine(line.id)}
                                                >
                                                    <Trash2 size={12} />
                                                </Button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                                {prefs.lineDescription && line.showDescription && (
                                    <tr className="border-b border-border/50 bg-muted/10">
                                        <td />
                                        {/* colSpan covers all remaining visible columns regardless of toggles */}
                                        <td colSpan={12} className="px-3 py-1.5">
                                            <Input
                                                value={line.description}
                                                onChange={(e) => updateLine(line.id, { description: e.target.value })}
                                                placeholder="Note / description for this line (printed on invoice)"
                                                className="h-7 text-xs"
                                            />
                                        </td>
                                    </tr>
                                )}
                                </Fragment>
                            );
                        })}
                        <tr>
                            <td colSpan={12} className="px-5 py-2">
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
            <div className="relative border-t border-border bg-card shrink-0">
                {/* Show-Profit overlay — covers the totals while open. */}
                {showProfit && (
                    <div className="absolute inset-0 z-20 bg-card/95 backdrop-blur-sm border-t border-border px-6 py-3 overflow-auto">
                        <div className="flex items-center justify-between mb-2">
                            <h3 className="text-sm font-semibold">Estimated Profit (live)</h3>
                            <button
                                type="button"
                                onClick={() => setShowProfit(false)}
                                className="text-xs text-muted-foreground hover:text-foreground"
                            >
                                Close &times;
                            </button>
                        </div>
                        <table className="w-full text-xs">
                            <thead className="text-muted-foreground border-b border-border">
                                <tr>
                                    <th className="text-left py-1 font-medium">Item</th>
                                    <th className="text-right py-1 font-medium">Qty</th>
                                    <th className="text-right py-1 font-medium">Cost ₹</th>
                                    <th className="text-right py-1 font-medium">Sale (net) ₹</th>
                                    <th className="text-right py-1 font-medium">Profit ₹</th>
                                </tr>
                            </thead>
                            <tbody className="font-mono tabular-nums">
                                {lineProfits.map((lp) => (
                                    <tr key={lp.id} className="border-b border-border/50">
                                        <td className="py-1 font-sans">{lp.name}</td>
                                        <td className="text-right py-1">{lp.qty}</td>
                                        <td className="text-right py-1">{fmt(lp.cost * lp.qty)}</td>
                                        <td className="text-right py-1">{fmt(lp.revenue)}</td>
                                        <td className={`text-right py-1 font-semibold ${lp.profit < 0 ? "text-destructive" : ""}`}>
                                            {fmt(lp.profit)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot>
                                <tr className="border-t border-border">
                                    <td colSpan={4} className="py-1 text-right text-muted-foreground">Σ Line Profit</td>
                                    <td className="py-1 text-right font-mono font-semibold tabular-nums">{fmt(totalLineProfit)}</td>
                                </tr>
                                {overallDiscount > 0 && (
                                    <tr>
                                        <td colSpan={4} className="py-1 text-right text-muted-foreground">Less: Overall Discount</td>
                                        <td className="py-1 text-right font-mono tabular-nums">−{fmt(overallDiscount)}</td>
                                    </tr>
                                )}
                                <tr className="border-t border-border">
                                    <td colSpan={4} className="py-1.5 text-right text-sm font-semibold">Estimated Profit</td>
                                    <td className={`py-1.5 text-right font-mono font-bold tabular-nums text-sm ${estimatedProfit < 0 ? "text-destructive" : "text-green-600"}`}>
                                        ₹ {fmt(estimatedProfit)}
                                        <span className="ml-2 text-[10px] text-muted-foreground">({margin.toFixed(1)}%)</span>
                                    </td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                )}

                <div className="flex items-end justify-between px-6 py-4 gap-8">
                    {/* Left: shipping + round off + overall discount */}
                    <div className="flex items-end gap-4 text-sm">
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
                        {prefs.overallDiscount && (
                            <>
                                <div className="space-y-1">
                                    <label className="text-xs text-muted-foreground">Discount %</label>
                                    <Input
                                        type="number"
                                        min="0"
                                        max="100"
                                        step="0.01"
                                        value={header.discountPct}
                                        onChange={(e) => handleDiscountPctChange(e.target.value)}
                                        className="h-7 w-20 text-xs text-right"
                                        placeholder="0"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs text-muted-foreground">Discount ₹</label>
                                    <Input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        value={header.discountAmt}
                                        onChange={(e) => handleDiscountAmtChange(e.target.value)}
                                        className="h-7 w-24 text-xs text-right"
                                        placeholder="0"
                                    />
                                </div>
                            </>
                        )}
                    </div>

                    {/* Centre: received + balance — SALE only */}
                    {showReceivedBalance && (
                        <div className="flex items-end gap-6 text-sm">
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
                                <span>Subtotal</span><span className="font-mono">₹ {fmt(lineSubtotal)}</span>
                            </div>
                            {overallDiscount > 0 && (
                                <div className="flex justify-between gap-8 text-muted-foreground">
                                    <span>Discount</span><span className="font-mono">− ₹ {fmt(overallDiscount)}</span>
                                </div>
                            )}
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

                        <div className="flex flex-wrap gap-2 justify-end shrink-0 max-w-[420px]">
                            <Button variant="outline" onClick={() => { reset(); setOpen(false); }}>
                                Cancel
                            </Button>
                            <Button
                                variant="outline"
                                onClick={() => setShowProfit((s) => !s)}
                                title="Show estimated profit (live)"
                            >
                                {showProfit ? "Hide" : "Show"} Profit
                            </Button>
                            {showSaveAndPost ? (
                                <>
                                    <Button variant="outline" onClick={() => submit(false)} disabled={saving}>
                                        {saving && <Loader2 size={13} className="animate-spin mr-1" />} Save Draft
                                    </Button>
                                    <Button variant="outline" onClick={() => submit(true, true)} disabled={saving}>
                                        {saving && <Loader2 size={13} className="animate-spin mr-1" />} Save &amp; Print
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
export function SaleFullScreenDialog() { return <TradingVoucherFullScreenForm kind="SALE" />; }
