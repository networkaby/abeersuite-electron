"use client";

// ── PosReturnDialog ───────────────────────────────────────────────────────────
// Two-mode return flow:
//   Tab 1 — By invoice #  : cashier types INV-xxx → picks invoice → line-picker
//   Tab 2 — By customer   : PartySearchAndCreate picks debtor → list their PAID
//                           invoices → pick one → same line-picker

import { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import {
    Search, Loader2, RotateCcw, Banknote, CreditCard, Check, Minus, Plus, User, Gift,
} from "lucide-react";
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
    PartySearchAndCreate,
    type PickedParty,
} from "@/shared/components/PartySearchAndCreate";
import { fmt } from "@/shared/lib/format/moneyInr";
import { extractApiError } from "@/shared/lib/api";
import { openCashDrawer, printVoucherThermal } from "@/shared/lib/print/silentThermalPrint";
import { SavePrintButtons, savePrintKey } from "@/modules/pos/components/SavePrintButtons";

// ── Types ─────────────────────────────────────────────────────────────────────

type ReturnLine = {
    id:          number;
    productId:   number | null;
    description: string;
    quantity:    string;
    returnedQty: string;
    unitPrice:   string;
    taxRate:     string;
    taxAmount:   string;
    amount:      string;
    product:     { id: number; name: string; sku: string } | null;
};

type FoundInvoice = {
    id:          number;
    number:      string;
    issueDate:   string;
    totalAmount: string;
    account:     { id: number; name: string } | null;
    /// Present only when this sale still has gift-card value that can go back on
    /// the card; `refundable` is the most the return may put back (₹, 2dp).
    giftCard:    { id: number; code: string; refundable: string } | null;
    lines:       ReturnLine[];
    returns:     { id: number; number: string; totalAmount: string }[];
};

type ReturnMode = "CASH" | "CREDIT" | "GIFT_CARD";
type Selection = Record<number, number>;   // invoiceLineId → return qty
type Tab = "invoice" | "customer";

// ── Sub-components ────────────────────────────────────────────────────────────

function InvoiceResultList({
    results, onPick,
}: {
    results: FoundInvoice[];
    onPick:  (inv: FoundInvoice) => void;
}) {
    return (
        <div className="space-y-1.5">
            {results.map((inv) => (
                <button
                    key={inv.id}
                    type="button"
                    onClick={() => onPick(inv)}
                    className="w-full rounded-md border border-border hover:border-primary hover:bg-muted/40 px-3 py-2.5 text-left text-sm transition-colors"
                >
                    <div className="flex items-center justify-between">
                        <span className="font-mono font-medium">{inv.number}</span>
                        <span className="font-semibold">₹{fmt(Number(inv.totalAmount))}</span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                        {inv.account?.name ?? "—"} · {new Date(inv.issueDate).toLocaleDateString("en-IN")}
                        {inv.returns.length > 0 && (
                            <span className="ml-2 text-amber-600">
                                · {inv.returns.length} return(s) already issued
                            </span>
                        )}
                    </div>
                </button>
            ))}
        </div>
    );
}

function RefundModeToggle({
    mode, onMode, giftCard, returnTotal,
}: {
    mode:        ReturnMode;
    onMode:      (m: ReturnMode) => void;
    /// The card this sale drew, when anything is still refundable to it.
    giftCard:    { code: string; refundable: string } | null;
    returnTotal: number;
}) {
    // Offered only when a card actually paid, and only for as much as it paid —
    // a mixed-tender return still goes back as cash or credit.
    const cardCap  = giftCard ? Number(giftCard.refundable) : 0;
    const overCap  = returnTotal > cardCap + 0.005;
    const cardOff  = !giftCard || overCap;
    const btn = (active: boolean) =>
        `flex-1 flex items-center justify-center gap-1.5 py-2 transition-colors ${
            active ? "bg-primary text-primary-foreground" : "hover:bg-muted"
        }`;

    return (
        <div className="space-y-1.5">
            <Label className="text-xs">Refund method</Label>
            <div className="flex rounded-lg border border-border overflow-hidden text-sm">
                <button type="button" onClick={() => onMode("CASH")} className={btn(mode === "CASH")}>
                    <Banknote size={13} /> Cash back
                </button>
                <button
                    type="button"
                    onClick={() => onMode("CREDIT")}
                    className={`${btn(mode === "CREDIT")} border-l border-border`}
                >
                    <CreditCard size={13} /> Credit note
                </button>
                {giftCard && (
                    <button
                        type="button"
                        disabled={cardOff}
                        onClick={() => onMode("GIFT_CARD")}
                        title={overCap ? `Only ₹${giftCard.refundable} of this sale was paid by gift card` : undefined}
                        className={`${btn(mode === "GIFT_CARD")} border-l border-border disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent`}
                    >
                        <Gift size={13} /> Back to card
                    </button>
                )}
            </div>
            <p className="text-xs text-muted-foreground">
                {mode === "CASH"
                    ? "Cash is paid out from the counter till. Requires an open shift."
                    : mode === "GIFT_CARD"
                    ? `Value goes back on gift card ${giftCard?.code ?? ""}. No cash leaves the till.`
                    : "A credit balance is added to the customer's account for future purchases."}
                {giftCard && overCap && (
                    <> Only ₹{giftCard.refundable} of this sale was paid by gift card, so it cannot cover this return.</>
                )}
            </p>
        </div>
    );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function PosReturnDialog({
    open, onOpenChange, onDone,
}: {
    open:          boolean;
    onOpenChange:  (open: boolean) => void;
    onDone:        () => void;
}) {
    const [tab, setTab] = useState<Tab>("invoice");

    // ── Tab 1 & 2 — shared state ──────────────────────────────────────────────
    const [query, setQuery]           = useState("");
    const [searching, setSearching]   = useState(false);
    const [results, setResults]       = useState<FoundInvoice[]>([]);
    const [selected, setSelected]     = useState<FoundInvoice | null>(null);
    const [selection, setSelection]   = useState<Selection>({});
    const [mode, setMode]             = useState<ReturnMode>("CASH");
    const [notes, setNotes]           = useState("");
    const [submitting, setSubmitting] = useState(false);

    // ── Tab 2 — customer picker ───────────────────────────────────────────────
    const [pickedCustomer, setPickedCustomer] = useState<PickedParty | null>(null);

    // ── Helpers ───────────────────────────────────────────────────────────────

    const reset = () => {
        setQuery(""); setResults([]); setSelected(null);
        setSelection({}); setMode("CASH"); setNotes("");
        setPickedCustomer(null);
    };

    // ── Tab 1: invoice number search ──────────────────────────────────────────

    const searchByNumber = async () => {
        if (query.trim().length < 2) { toast.error("Enter at least 2 characters"); return; }
        setSearching(true);
        try {
            const { data } = await axios.get<FoundInvoice[]>(`/api/pos/return/search?q=${encodeURIComponent(query.trim())}`);
            setResults(data);
            if (data.length === 0) toast.error("No paid invoices found matching that number");
        } catch {
            toast.error("Search failed");
        } finally {
            setSearching(false);
        }
    };

    // ── Tab 2: customer picked → load their invoices ──────────────────────────

    const onCustomerPicked = async (party: PickedParty) => {
        if (!party.accountId) {
            toast.error("This customer has no billing account linked.");
            return;
        }
        setPickedCustomer(party);
        setSearching(true);
        try {
            const { data } = await axios.get<FoundInvoice[]>(`/api/pos/return/search?customerId=${party.accountId}`);
            setResults(data);
            if (data.length === 0) toast.error("No paid invoices found for this customer");
        } catch {
            toast.error("Failed to load customer invoices");
        } finally {
            setSearching(false);
        }
    };

    // ── Shared: pick invoice + pre-fill full-qty selection ───────────────────

    const remainingQty = (l: ReturnLine) => Math.max(0, Number(l.quantity) - Number(l.returnedQty));

    const pickInvoice = (inv: FoundInvoice) => {
        setSelected(inv);
        const sel: Selection = {};
        for (const l of inv.lines) sel[l.id] = remainingQty(l);
        setSelection(sel);
        setResults([]);
    };

    const setQty = (lineId: number, qty: number, max: number) => {
        setSelection((s) => ({ ...s, [lineId]: Math.max(0, Math.min(qty, max)) }));
    };

    const selectedLines = selected?.lines.filter((l) => (selection[l.id] ?? 0) > 0) ?? [];
    const returnTotal = selectedLines.reduce((sum, l) => {
        const qty       = selection[l.id] ?? 0;
        const unitPrice = Number(l.unitPrice);
        const taxRate   = Number(l.taxRate);
        return sum + qty * unitPrice * (1 + taxRate / 100);
    }, 0);

    // ── Tab 1 & 2: submit normal return ──────────────────────────────────────

    const handleSubmit = async (print: boolean) => {
        if (!selected) return;
        if (selectedLines.length === 0) { toast.error("Select at least one item to return"); return; }
        // The cashier can pick "Back to card" and then add more lines. The server
        // refuses that too, but say it here rather than after a round trip.
        if (mode === "GIFT_CARD" && returnTotal > Number(selected.giftCard?.refundable ?? 0) + 0.005) {
            toast.error(`Only ₹${selected.giftCard?.refundable ?? "0.00"} of this sale was paid by gift card. Refund by cash or credit.`);
            return;
        }
        setSubmitting(true);
        try {
            const { data } = await axios.post<{
                returnVoucherId: number;
                returnNumber:    string;
                returnTotal:     number;
            }>("/api/pos/return", {
                originalInvoiceId: selected.id,
                lines: selectedLines.map((l) => ({ invoiceLineId: l.id, qty: selection[l.id] })),
                refundMode: mode,
                notes:      notes.trim() || undefined,
            });
            toast.success(
                `Return ${data.returnNumber} · ₹${fmt(data.returnTotal)} — ` +
                (mode === "CASH" ? "cash refunded from till"
                 : mode === "GIFT_CARD" ? "put back on the gift card"
                 : "credit note issued")
            );
            // A cash refund comes out of the drawer; credit note / gift card does not.
            if (print) void printVoucherThermal("inv", data.returnVoucherId, "SALE_RETURN", { openDrawer: mode === "CASH" });
            else if (mode === "CASH") void openCashDrawer();
            onDone();
            onOpenChange(false);
            reset();
        } catch (e: unknown) {
            toast.error(extractApiError(e, "Failed to process return"));
        } finally {
            setSubmitting(false);
        }
    };

    // ── Tab switch ────────────────────────────────────────────────────────────

    const switchTab = (t: Tab) => {
        setTab(t);
        setQuery(""); setResults([]); setSelected(null); setSelection({}); setNotes("");
        setPickedCustomer(null);
    };

    // ── Render ────────────────────────────────────────────────────────────────

    const busy = submitting;
    const returnBlocked = selectedLines.length === 0 || returnTotal <= 0;

    return (
        <Dialog
            open={open}
            onOpenChange={(v) => {
                if (!busy) { onOpenChange(v); if (!v) reset(); }
            }}
        >
            <DialogContent
                className="sm:max-w-lg flex flex-col max-h-[90vh]"
                // Ctrl+Enter → Return + Print once the lines are picked. Plain Enter
                // stays with the +/- steppers and the reason box, so it never posts.
                onKeyDown={(e) => { if (selected) savePrintKey(e, (p) => void handleSubmit(p), { enterSaves: false, disabled: returnBlocked || submitting }); }}
            >
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <RotateCcw size={16} className="text-primary" /> Sale Return
                    </DialogTitle>
                    <DialogDescription>
                        Find the original invoice, select items to return, and choose the refund method.
                    </DialogDescription>
                </DialogHeader>

                {/* ── Tab bar ── */}
                <div className="flex rounded-lg border border-border text-xs font-medium overflow-hidden shrink-0">
                    <button
                        type="button"
                        onClick={() => switchTab("invoice")}
                        className={`flex-1 flex items-center justify-center gap-1.5 py-2 transition-colors ${
                            tab === "invoice" ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                        }`}
                    >
                        <Search size={12} /> By invoice #
                    </button>
                    <button
                        type="button"
                        onClick={() => switchTab("customer")}
                        className={`flex-1 flex items-center justify-center gap-1.5 py-2 border-l border-border transition-colors ${
                            tab === "customer" ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                        }`}
                    >
                        <User size={12} /> By customer
                    </button>
                </div>

                {/* ── Body ── */}
                <div className="flex-1 overflow-y-auto space-y-4 pr-1">

                    {/* ════ Tab 1: by invoice number ════ */}
                    {tab === "invoice" && !selected && (
                        <div className="space-y-3">
                            <div className="flex gap-2">
                                <Input
                                    value={query}
                                    onChange={(e) => setQuery(e.target.value)}
                                    onKeyDown={(e) => e.key === "Enter" && void searchByNumber()}
                                    placeholder="Invoice number — INV-001"
                                    autoFocus
                                />
                                <Button onClick={searchByNumber} disabled={searching} variant="outline">
                                    {searching
                                        ? <Loader2 size={14} className="animate-spin" />
                                        : <Search size={14} />}
                                </Button>
                            </div>
                            {results.length > 0 && (
                                <InvoiceResultList results={results} onPick={pickInvoice} />
                            )}
                        </div>
                    )}

                    {/* ════ Tab 2: by customer ════ */}
                    {tab === "customer" && !selected && (
                        <div className="space-y-3">
                            {!pickedCustomer ? (
                                <PartySearchAndCreate
                                    onPicked={onCustomerPicked}
                                    partyGroup="Sundry Debtors"
                                    autoFocus
                                    placeholder="Search customer by name / phone…"
                                />
                            ) : (
                                <div className="flex items-center justify-between rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
                                    <span className="font-medium">{pickedCustomer.name}</span>
                                    <button
                                        type="button"
                                        onClick={() => { setPickedCustomer(null); setResults([]); }}
                                        className="text-xs text-muted-foreground hover:text-foreground underline"
                                    >
                                        change
                                    </button>
                                </div>
                            )}
                            {searching && (
                                <div className="flex justify-center py-4">
                                    <Loader2 size={20} className="animate-spin text-muted-foreground" />
                                </div>
                            )}
                            {!searching && results.length > 0 && (
                                <InvoiceResultList results={results} onPick={pickInvoice} />
                            )}
                            {!searching && pickedCustomer && results.length === 0 && (
                                <p className="text-center text-sm text-muted-foreground py-4">
                                    No paid invoices found for this customer.
                                </p>
                            )}
                        </div>
                    )}

                    {/* ════ Shared step 2: line-picker (Tab 1 + Tab 2) ════ */}
                    {selected && (
                        <div className="space-y-3">
                            {/* Invoice header */}
                            <div className="flex items-center justify-between rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
                                <div>
                                    <span className="font-mono font-medium">{selected.number}</span>
                                    <span className="ml-2 text-muted-foreground text-xs">
                                        {selected.account?.name} · {new Date(selected.issueDate).toLocaleDateString("en-IN")}
                                    </span>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => { setSelected(null); setSelection({}); }}
                                    className="text-xs text-muted-foreground hover:text-foreground underline"
                                >
                                    change
                                </button>
                            </div>

                            {/* Line items */}
                            <div className="space-y-1.5">
                                <p className="text-xs font-medium text-muted-foreground">Items to return</p>
                                {selected.lines.map((l) => {
                                    const origQty   = Number(l.quantity);
                                    const returned  = Number(l.returnedQty);
                                    const max       = remainingQty(l);
                                    const qty       = selection[l.id] ?? 0;
                                    return (
                                        <div
                                            key={l.id}
                                            className={`flex items-center gap-3 rounded-md border px-3 py-2 text-sm transition-colors ${
                                                max === 0
                                                    ? "border-border opacity-40"
                                                    : qty > 0
                                                        ? "border-primary bg-primary/5"
                                                        : "border-border opacity-50"
                                            }`}
                                        >
                                            <div className="flex-1 min-w-0">
                                                <p className="truncate font-medium text-xs">{l.description}</p>
                                                <p className="text-[10px] text-muted-foreground">
                                                    ₹{fmt(Number(l.unitPrice))} × {origQty} = ₹{fmt(Number(l.amount))}
                                                    {returned > 0 && (
                                                        <span className="text-amber-600"> · {returned} already returned</span>
                                                    )}
                                                </p>
                                            </div>
                                            <div className="flex items-center gap-1 shrink-0">
                                                <Button
                                                    variant="outline"
                                                    size="icon-sm"
                                                    onClick={() => setQty(l.id, qty - 1, max)}
                                                    disabled={qty <= 0}
                                                >
                                                    <Minus size={11} />
                                                </Button>
                                                <span className="w-6 text-center text-sm font-mono">{qty}</span>
                                                <Button
                                                    variant="outline"
                                                    size="icon-sm"
                                                    onClick={() => setQty(l.id, qty + 1, max)}
                                                    disabled={qty >= max}
                                                >
                                                    <Plus size={11} />
                                                </Button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            {returnTotal > 0 && (
                                <div className="flex justify-between rounded-md bg-muted/40 border border-border px-3 py-2 text-sm font-semibold">
                                    <span>Return total</span>
                                    <span className="font-mono text-red-700 dark:text-red-400">
                                        − ₹{fmt(returnTotal)}
                                    </span>
                                </div>
                            )}

                            <RefundModeToggle mode={mode} onMode={setMode} giftCard={selected?.giftCard ?? null} returnTotal={returnTotal} />

                            <div className="space-y-1.5">
                                <Label htmlFor="return-notes" className="text-xs">
                                    Reason <span className="text-muted-foreground">(optional)</span>
                                </Label>
                                <Textarea
                                    id="return-notes"
                                    rows={2}
                                    value={notes}
                                    onChange={(e) => setNotes(e.target.value)}
                                    placeholder="e.g. Defective unit, wrong model"
                                />
                            </div>
                        </div>
                    )}
                </div>

                {/* ── Footer ── */}
                <DialogFooter className="pt-2 border-t border-border gap-2">
                    <Button
                        variant="outline"
                        onClick={() => { onOpenChange(false); reset(); }}
                        disabled={busy}
                    >
                        Cancel
                    </Button>

                    {selected && (
                        <SavePrintButtons
                            icon={<Check size={14} />}
                            label={`Return · ₹${fmt(returnTotal)}`}
                            printLabel="Return + Print"
                            onSave={(p) => void handleSubmit(p)}
                            disabled={returnBlocked}
                            submitting={submitting}
                            enterSaves={false}
                            printClassName="bg-red-600 hover:bg-red-700 text-white"
                        />
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
