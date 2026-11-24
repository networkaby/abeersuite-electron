"use client";

// ── PosReturnDialog ───────────────────────────────────────────────────────────
// Big voucher-style return. The customer picker and the sale voucher no. sit side
// by side; filling either lists the sale's items straight in the table, grouped
// by bill. A return is saved against one sale, so picking a quantity in one bill
// locks the others.

import { useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import {
    Search, Loader2, RotateCcw, Banknote, CreditCard, Check, Minus, Plus, Gift, X,
} from "lucide-react";
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
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
import { openCashDrawer, printSavedVoucherThermal } from "@/shared/lib/print/silentThermalPrint";
import { SavePrintButtons, savePrintKey } from "@/modules/pos/components/SavePrintButtons";
import { formatDate } from "@/shared/lib/format/formatDate";

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

// ── Sub-components ────────────────────────────────────────────────────────────

const remainingQty = (l: ReturnLine) => Math.max(0, Number(l.quantity) - Number(l.returnedQty));

/** What `qty` of a sold line gives back: its share of the line as billed — after
 *  discount, with GST — which is what the server reverses. */
const refundOf = (l: ReturnLine, qty: number) => {
    const sold = Number(l.quantity);
    return sold > 0 ? (Number(l.amount) * qty) / sold : 0;
};

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
    const [query, setQuery]           = useState("");
    const [customer, setCustomer]     = useState<string | null>(null);
    const [searching, setSearching]   = useState(false);
    /** null = nothing looked up yet (an empty list means nothing was found). */
    const [bills, setBills]           = useState<FoundInvoice[] | null>(null);
    const [selection, setSelection]   = useState<Selection>({});
    const [mode, setMode]             = useState<ReturnMode>("CASH");
    const [notes, setNotes]           = useState("");
    const [submitting, setSubmitting] = useState(false);
    // Only the latest lookup may fill the table.
    const lookupSeq = useRef(0);

    const reset = () => {
        lookupSeq.current++;
        setQuery(""); setCustomer(null); setBills(null); setSearching(false);
        setSelection({}); setMode("CASH"); setNotes("");
    };

    // ── Lookup — either box loads the table ───────────────────────────────────

    const lookup = async (params: { q: string } | { customerId: number }): Promise<FoundInvoice[] | null> => {
        const seq = ++lookupSeq.current;
        setSearching(true); setBills(null); setSelection({}); setMode("CASH");
        try {
            const { data } = await axios.get<FoundInvoice[]>("/api/pos/return/search", { params });
            if (seq !== lookupSeq.current) return null;
            setBills(data);
            return data;
        } catch (e: unknown) {
            if (seq === lookupSeq.current) toast.error(extractApiError(e, "Search failed"));
            return null;
        } finally {
            if (seq === lookupSeq.current) setSearching(false);
        }
    };

    const selectAll = (inv: FoundInvoice) =>
        setSelection(Object.fromEntries(inv.lines.map((l) => [l.id, remainingQty(l)])));

    const searchByNumber = async () => {
        const q = query.trim();
        if (q.length < 2) { toast.error("Enter at least 2 characters"); return; }
        setCustomer(null);
        const found = await lookup({ q });
        if (!found) return;
        const one = found.find((b) => b.number.toLowerCase() === q.toLowerCase()) ?? (found.length === 1 ? found[0] : null);
        if (!one) return;
        // One sale found: show only it, in full, with its customer.
        setBills([one]); setQuery(one.number); setCustomer(one.account?.name ?? null);
        selectAll(one);
    };

    const onCustomerPicked = (party: PickedParty) => {
        if (!party.accountId) { toast.error("This customer has no billing account linked."); return; }
        setQuery(""); setCustomer(party.name);
        void lookup({ customerId: party.accountId });
    };

    // ── Selection ─────────────────────────────────────────────────────────────

    const setQty = (lineId: number, qty: number, max: number) => {
        if (!selected) setMode("CASH");   // a new bill may carry no gift card
        setSelection((s) => ({ ...s, [lineId]: Math.max(0, Math.min(qty, max)) }));
    };

    const selected      = bills?.find((b) => b.lines.some((l) => (selection[l.id] ?? 0) > 0)) ?? null;
    const selectedLines = selected?.lines.filter((l) => (selection[l.id] ?? 0) > 0) ?? [];
    const returnTotal   = selectedLines.reduce((sum, l) => sum + refundOf(l, selection[l.id]), 0);

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
                returnPrint?:    object | null;
            }>("/api/pos/return", {
                originalInvoiceId: selected.id,
                lines: selectedLines.map((l) => ({ invoiceLineId: l.id, qty: selection[l.id] })),
                refundMode: mode,
                notes:      notes.trim() || undefined,
                print,
            });
            toast.success(
                `Return ${data.returnNumber} · ₹${fmt(data.returnTotal)} — ` +
                (mode === "CASH" ? "cash refunded from till"
                 : mode === "GIFT_CARD" ? "put back on the gift card"
                 : "credit note issued")
            );
            // A cash refund comes out of the drawer; credit note / gift card does not.
            if (print) void printSavedVoucherThermal("inv", data.returnVoucherId, "SALE_RETURN", data.returnPrint, { openDrawer: mode === "CASH" });
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

    // ── Render ────────────────────────────────────────────────────────────────

    const returnBlocked = selectedLines.length === 0 || returnTotal <= 0;

    return (
        <Dialog
            open={open}
            onOpenChange={(v) => {
                if (!submitting) { onOpenChange(v); if (!v) reset(); }
            }}
        >
            <DialogContent
                className="flex h-[92vh] w-[95vw] max-w-[95vw] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(1400px,95vw)]"
                // Ctrl+Enter → Return + Print once the lines are picked. Plain Enter
                // stays with the +/- steppers and the reason box, so it never posts.
                onKeyDown={(e) => savePrintKey(e, (p) => void handleSubmit(p), { enterSaves: false, disabled: returnBlocked || submitting })}
            >
                <DialogHeader className="shrink-0 border-b border-border bg-red-50 px-5 py-3 dark:bg-red-950/30">
                    <DialogTitle className="flex items-center gap-2">
                        <RotateCcw size={16} className="text-red-600" /> Sale Return
                    </DialogTitle>
                    <DialogDescription className="sr-only">
                        Pick the customer or the sale voucher, choose the items to return and the refund method.
                    </DialogDescription>
                </DialogHeader>

                <div className="grid shrink-0 gap-3 border-b border-border px-5 py-3 md:grid-cols-[1fr_340px]">
                    <div className="min-w-0 space-y-1.5">
                        <Label className="text-xs">Customer</Label>
                        {customer ? (
                            <div className="flex h-8 items-center justify-between gap-2 rounded-md border border-border px-3 text-sm">
                                <span className="truncate font-medium">{customer}</span>
                                <Button variant="ghost" size="sm" className="h-6 shrink-0 text-muted-foreground" onClick={reset} disabled={submitting}>
                                    <X size={13} /> Change
                                </Button>
                            </div>
                        ) : (
                            <PartySearchAndCreate
                                exactPhoneOnly
                                onPicked={onCustomerPicked}
                                partyGroup="Sundry Debtors"
                                placeholder="Search customer by name / phone…"
                            />
                        )}
                    </div>
                    <div className="space-y-1.5">
                        <Label htmlFor="return-voucher-no" className="text-xs">Sale voucher no.</Label>
                        <div className="flex gap-2">
                            <Input
                                id="return-voucher-no"
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) { e.preventDefault(); void searchByNumber(); }
                                }}
                                placeholder="Type or scan, then Enter"
                                className="font-mono"
                                disabled={submitting}
                                autoFocus
                            />
                            <Button onClick={() => void searchByNumber()} disabled={searching || submitting} variant="outline" size="icon" aria-label="Find sale voucher">
                                {searching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                            </Button>
                        </div>
                    </div>
                </div>

                <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:grid md:grid-cols-[1fr_340px] md:overflow-hidden">
                    <div className="min-w-0 overflow-x-auto px-5 py-3 md:overflow-y-auto">
                        {!bills || bills.length === 0 ? (
                            <p className="py-16 text-center text-sm text-muted-foreground">
                                {searching ? "Loading items…"
                                 : bills ? "No sale found."
                                 : "Pick a customer or enter a sale voucher no. to load the items."}
                            </p>
                        ) : (
                            <table className="w-full min-w-[560px] text-sm">
                                <thead>
                                    <tr className="border-b border-border text-right text-xs text-muted-foreground [&>th]:px-2 [&>th]:py-2 [&>th]:font-medium">
                                        <th className="text-left">Item</th>
                                        <th>Sold</th>
                                        <th>Returned</th>
                                        <th>Price</th>
                                        <th>Return qty</th>
                                        <th>Amount</th>
                                    </tr>
                                </thead>
                                {bills.map((b) => {
                                    const locked = selected != null && selected.id !== b.id;
                                    return (
                                        <tbody key={b.id} className={locked ? "opacity-40" : undefined}>
                                            <tr className="bg-muted/60">
                                                <td colSpan={6} className="px-2 py-1.5">
                                                    <div className="flex flex-wrap items-center gap-x-3 text-xs">
                                                        <span className="font-mono font-semibold">{b.number}</span>
                                                        <span className="text-muted-foreground">
                                                            {customer ? "" : `${b.account?.name ?? "—"} · `}{formatDate(b.issueDate)} · ₹{fmt(Number(b.totalAmount))}
                                                        </span>
                                                        {locked ? (
                                                            <span className="ml-auto">One bill per return</span>
                                                        ) : !b.lines.some((l) => remainingQty(l) > 0) ? (
                                                            <span className="ml-auto text-muted-foreground">Nothing left to return</span>
                                                        ) : (
                                                            <button
                                                                type="button"
                                                                disabled={submitting}
                                                                onClick={() => {
                                                                    if (selected) setSelection({});
                                                                    else { setMode("CASH"); selectAll(b); }
                                                                }}
                                                                className="ml-auto text-primary underline"
                                                            >
                                                                {selected ? "Clear" : "Return all"}
                                                            </button>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                            {b.lines.filter((l) => Number(l.quantity) > 0).map((l) => {
                                                const max = remainingQty(l);
                                                const qty = selection[l.id] ?? 0;
                                                return (
                                                    <tr
                                                        key={l.id}
                                                        className={`border-b border-border/60 text-right tabular-nums [&>td]:px-2 [&>td]:py-1.5 ${qty > 0 ? "bg-red-50 dark:bg-red-950/30" : ""} ${max === 0 && !locked ? "opacity-40" : ""}`}
                                                    >
                                                        <td className="text-left">
                                                            <p className="font-medium">{l.product?.name ?? l.description}</p>
                                                            {l.product && <p className="text-xs text-muted-foreground">SKU {l.product.sku}</p>}
                                                        </td>
                                                        <td>{Number(l.quantity)}</td>
                                                        <td className={Number(l.returnedQty) > 0 ? "text-amber-600" : ""}>{Number(l.returnedQty)}</td>
                                                        <td>{fmt(refundOf(l, 1))}</td>
                                                        <td>
                                                            <div className="flex items-center justify-end gap-1">
                                                                <Button variant="outline" size="icon-sm" aria-label="Less" onClick={() => setQty(l.id, qty - 1, max)} disabled={locked || submitting || qty <= 0}>
                                                                    <Minus size={11} />
                                                                </Button>
                                                                <span className="w-8 text-center font-mono">{qty}</span>
                                                                <Button variant="outline" size="icon-sm" aria-label="More" onClick={() => setQty(l.id, qty + 1, max)} disabled={locked || submitting || qty >= max}>
                                                                    <Plus size={11} />
                                                                </Button>
                                                            </div>
                                                        </td>
                                                        <td className="font-semibold">{qty > 0 ? fmt(refundOf(l, qty)) : "–"}</td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    );
                                })}
                            </table>
                        )}
                    </div>

                    <div className="flex shrink-0 flex-col gap-4 border-t border-border bg-muted/30 px-5 py-4 md:overflow-y-auto md:border-t-0 md:border-l">
                        <RefundModeToggle mode={mode} onMode={setMode} giftCard={selected?.giftCard ?? null} returnTotal={returnTotal} />
                        <div className="space-y-1.5">
                            <Label htmlFor="return-notes" className="text-xs">
                                Reason <span className="text-muted-foreground">(optional)</span>
                            </Label>
                            <Textarea
                                id="return-notes"
                                rows={3}
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                                placeholder="e.g. Defective unit, wrong model"
                            />
                        </div>
                        <div className="mt-auto flex items-baseline justify-between font-semibold">
                            <span className="text-sm">Return total</span>
                            <span className="font-mono text-2xl text-red-700 dark:text-red-400">− ₹{fmt(returnTotal)}</span>
                        </div>
                        <SavePrintButtons
                            icon={<Check size={14} />}
                            label={`Return · ₹${fmt(returnTotal)}`}
                            printLabel="Return + Print"
                            onSave={(p) => void handleSubmit(p)}
                            disabled={returnBlocked}
                            submitting={submitting}
                            enterSaves={false}
                            className="flex flex-col-reverse"
                            printClassName="bg-red-600 hover:bg-red-700 text-white"
                        />
                        <Button variant="outline" onClick={() => { onOpenChange(false); reset(); }} disabled={submitting}>
                            Cancel
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
