"use client";

// ── PosReturnDialog ───────────────────────────────────────────────────────────
// Three-mode return flow:
//   Tab 1 — By invoice #  : cashier types INV-xxx → picks invoice → line-picker
//   Tab 2 — By customer   : PartySearchAndCreate picks debtor → list their PAID
//                           invoices → pick one → same line-picker
//   Tab 3 — Lost invoice  : manager-only (pos:shift:manage).  PartySearchAndCreate
//                           picks debtor → free-form product + qty + price → reason
//                           required → POST /api/pos/return/lost

import { useState, useMemo } from "react";
import { useSession } from "next-auth/react";
import axios from "axios";
import { toast } from "sonner";
import {
    Search, Loader2, RotateCcw, Banknote, CreditCard, Check, Minus, Plus,
    User, Package, X, AlertTriangle,
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
import { fmt } from "@/utils/constants";

// ── Types ─────────────────────────────────────────────────────────────────────

type ReturnLine = {
    id:          number;
    productId:   number | null;
    description: string;
    quantity:    string;
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
    lines:       ReturnLine[];
    returns:     { id: number; number: string; totalAmount: string }[];
};

type ReturnMode = "CASH" | "CREDIT";
type Selection = Record<number, number>;   // invoiceLineId → return qty
type Tab = "invoice" | "customer" | "lost";

type ProductOption = {
    id: number; sku: string; name: string;
    pricePaise?: number | null;
};

type LostLine = {
    key:       string;   // unique React key
    productId: number;
    sku:       string;
    name:      string;
    qty:       number;
    unitPrice: number;
    taxRate:   number;
};

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
    mode, onMode,
}: {
    mode:   ReturnMode;
    onMode: (m: ReturnMode) => void;
}) {
    return (
        <div className="space-y-1.5">
            <Label className="text-xs">Refund method</Label>
            <div className="flex rounded-lg border border-border overflow-hidden text-sm">
                <button
                    type="button"
                    onClick={() => onMode("CASH")}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2 transition-colors ${
                        mode === "CASH" ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                    }`}
                >
                    <Banknote size={13} /> Cash back
                </button>
                <button
                    type="button"
                    onClick={() => onMode("CREDIT")}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2 transition-colors border-l border-border ${
                        mode === "CREDIT" ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                    }`}
                >
                    <CreditCard size={13} /> Credit note
                </button>
            </div>
            <p className="text-xs text-muted-foreground">
                {mode === "CASH"
                    ? "Cash is paid out from the counter till. Requires an open shift."
                    : "A credit balance is added to the customer's account for future purchases."}
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
    // ── Permission gate ───────────────────────────────────────────────────────
    const { data: session } = useSession();
    const perms = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    const isManager = perms.includes("pos:shift:manage");

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

    // ── Tab 3 — lost invoice ──────────────────────────────────────────────────
    const [lostCustomer, setLostCustomer]       = useState<PickedParty | null>(null);
    const [allProducts, setAllProducts]         = useState<ProductOption[]>([]);
    const [prodQuery, setProdQuery]             = useState("");
    const [lostLines, setLostLines]             = useState<LostLine[]>([]);
    const [reason, setReason]                   = useState("");
    const [lostMode, setLostMode]               = useState<ReturnMode>("CASH");
    const [lostSubmitting, setLostSubmitting]   = useState(false);

    // ── Helpers ───────────────────────────────────────────────────────────────

    const reset = () => {
        setQuery(""); setResults([]); setSelected(null);
        setSelection({}); setMode("CASH"); setNotes("");
        setPickedCustomer(null);
        setLostCustomer(null); setProdQuery(""); setLostLines([]);
        setReason(""); setLostMode("CASH");
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

    const pickInvoice = (inv: FoundInvoice) => {
        setSelected(inv);
        const sel: Selection = {};
        for (const l of inv.lines) sel[l.id] = Number(l.quantity);
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

    const handleSubmit = async () => {
        if (!selected) return;
        if (selectedLines.length === 0) { toast.error("Select at least one item to return"); return; }
        setSubmitting(true);
        try {
            const { data } = await axios.post<{
                returnNumber:    string;
                journalEntryRef: string;
                returnTotal:     number;
            }>("/api/pos/return", {
                originalInvoiceId: selected.id,
                lines: selectedLines.map((l) => ({ invoiceLineId: l.id, qty: selection[l.id] })),
                refundMode: mode,
                notes:      notes.trim() || undefined,
            });
            toast.success(
                `Return ${data.returnNumber} · ₹${fmt(data.returnTotal)} — ` +
                (mode === "CASH" ? "cash refunded from till" : "credit note issued") +
                ` · JE ${data.journalEntryRef}`
            );
            onDone();
            onOpenChange(false);
            reset();
        } catch (e: unknown) {
            const msg = axios.isAxiosError(e)
                ? (e.response?.data as { error?: string })?.error
                : undefined;
            toast.error(msg ?? "Failed to process return");
        } finally {
            setSubmitting(false);
        }
    };

    // ── Tab 3: product search ─────────────────────────────────────────────────

    const loadProducts = async () => {
        if (allProducts.length > 0) return;
        try {
            const { data } = await axios.get<ProductOption[]>("/api/inventory/products/lookup");
            setAllProducts(data);
        } catch {
            /* non-fatal */
        }
    };

    const filteredProds = useMemo(() => {
        const q = prodQuery.trim().toLowerCase();
        if (!q) return [] as ProductOption[];
        return allProducts
            .filter((p) => p.sku.toLowerCase().includes(q) || p.name.toLowerCase().includes(q))
            .slice(0, 6);
    }, [allProducts, prodQuery]);

    const addLostLine = (prod: ProductOption) => {
        const unitPrice = prod.pricePaise ? prod.pricePaise / 100 : 0;
        setLostLines((prev) => [
            ...prev,
            {
                key:       `${prod.id}-${Date.now()}`,
                productId: prod.id,
                sku:       prod.sku,
                name:      prod.name,
                qty:       1,
                unitPrice,
                taxRate:   0,
            },
        ]);
        setProdQuery("");
    };

    const updateLostLine = (key: string, field: "qty" | "unitPrice" | "taxRate", value: number) => {
        setLostLines((prev) =>
            prev.map((l) => l.key === key ? { ...l, [field]: value } : l)
        );
    };

    const removeLostLine = (key: string) => {
        setLostLines((prev) => prev.filter((l) => l.key !== key));
    };

    const lostTotal = lostLines.reduce(
        (s, l) => s + l.qty * l.unitPrice * (1 + l.taxRate / 100), 0
    );

    // ── Tab 3: submit lost-invoice return ─────────────────────────────────────

    const handleLostSubmit = async () => {
        if (!lostCustomer?.accountId) { toast.error("Pick a customer first"); return; }
        if (lostLines.length === 0)   { toast.error("Add at least one product"); return; }
        if (reason.trim().length < 5) { toast.error("Reason must be at least 5 characters"); return; }
        if (lostTotal <= 0)           { toast.error("Return total must be > 0"); return; }
        setLostSubmitting(true);
        try {
            const { data } = await axios.post<{
                returnNumber:    string;
                journalEntryRef: string;
                returnTotal:     number;
            }>("/api/pos/return/lost", {
                customerAccountId: lostCustomer.accountId,
                lines: lostLines.map((l) => ({
                    productId: l.productId,
                    qty:       l.qty,
                    unitPrice: l.unitPrice,
                    taxRate:   l.taxRate,
                })),
                refundMode: lostMode,
                reason:     reason.trim(),
            });
            toast.success(
                `Lost-invoice return ${data.returnNumber} · ₹${fmt(data.returnTotal)} — ` +
                (lostMode === "CASH" ? "cash refunded from till" : "credit note issued") +
                ` · JE ${data.journalEntryRef}`
            );
            onDone();
            onOpenChange(false);
            reset();
        } catch (e: unknown) {
            const msg = axios.isAxiosError(e)
                ? (e.response?.data as { error?: string })?.error
                : undefined;
            toast.error(msg ?? "Failed to process lost-invoice return");
        } finally {
            setLostSubmitting(false);
        }
    };

    // ── Tab switch ────────────────────────────────────────────────────────────

    const switchTab = (t: Tab) => {
        setTab(t);
        setQuery(""); setResults([]); setSelected(null); setSelection({}); setNotes("");
        setPickedCustomer(null);
        if (t === "lost") void loadProducts();
    };

    // ── Render ────────────────────────────────────────────────────────────────

    const busy = submitting || lostSubmitting;

    return (
        <Dialog
            open={open}
            onOpenChange={(v) => {
                if (!busy) { onOpenChange(v); if (!v) reset(); }
            }}
        >
            <DialogContent className="sm:max-w-lg flex flex-col max-h-[90vh]">
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
                    {isManager && (
                        <button
                            type="button"
                            onClick={() => switchTab("lost")}
                            className={`flex-1 flex items-center justify-center gap-1.5 py-2 border-l border-border transition-colors ${
                                tab === "lost"
                                    ? "bg-amber-600 text-white"
                                    : "hover:bg-muted text-amber-700 dark:text-amber-400"
                            }`}
                        >
                            <AlertTriangle size={12} /> Lost invoice
                        </button>
                    )}
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
                    {(tab === "invoice" || tab === "customer") && selected && (
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
                                    const max = Number(l.quantity);
                                    const qty = selection[l.id] ?? 0;
                                    return (
                                        <div
                                            key={l.id}
                                            className={`flex items-center gap-3 rounded-md border px-3 py-2 text-sm transition-colors ${
                                                qty > 0
                                                    ? "border-primary bg-primary/5"
                                                    : "border-border opacity-50"
                                            }`}
                                        >
                                            <div className="flex-1 min-w-0">
                                                <p className="truncate font-medium text-xs">{l.description}</p>
                                                <p className="text-[10px] text-muted-foreground">
                                                    ₹{fmt(Number(l.unitPrice))} × {max} = ₹{fmt(Number(l.amount))}
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

                            <RefundModeToggle mode={mode} onMode={setMode} />

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

                    {/* ════ Tab 3: lost invoice (manager only) ════ */}
                    {tab === "lost" && (
                        <div className="space-y-3">
                            <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700/50 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                                <AlertTriangle size={13} className="shrink-0" />
                                Manager mode — no original invoice. Customer must be registered. Reason is required.
                            </div>

                            {/* Customer */}
                            {!lostCustomer ? (
                                <div className="space-y-1">
                                    <Label className="text-xs">Customer</Label>
                                    <PartySearchAndCreate
                                        onPicked={(p) => {
                                            if (!p.accountId) {
                                                toast.error("Customer has no billing account linked.");
                                                return;
                                            }
                                            setLostCustomer(p);
                                        }}
                                        partyGroup="Sundry Debtors"
                                        placeholder="Search customer…"
                                    />
                                </div>
                            ) : (
                                <div className="flex items-center justify-between rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
                                    <span className="font-medium">{lostCustomer.name}</span>
                                    <button
                                        type="button"
                                        onClick={() => { setLostCustomer(null); setLostLines([]); }}
                                        className="text-xs text-muted-foreground hover:text-foreground underline"
                                    >
                                        change
                                    </button>
                                </div>
                            )}

                            {lostCustomer && (
                                <>
                                    {/* Product picker */}
                                    <div className="space-y-1.5">
                                        <Label className="text-xs">Products being returned</Label>
                                        <div className="relative">
                                            <Package
                                                size={13}
                                                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                                            />
                                            <Input
                                                className="pl-8 text-sm"
                                                placeholder="Type SKU or name to add a product…"
                                                value={prodQuery}
                                                onChange={(e) => setProdQuery(e.target.value)}
                                            />
                                            {filteredProds.length > 0 && (
                                                <ul className="absolute left-0 right-0 top-full z-20 mt-1 max-h-44 overflow-y-auto rounded-md border border-border bg-popover shadow-lg">
                                                    {filteredProds.map((p) => (
                                                        <li key={p.id}>
                                                            <button
                                                                type="button"
                                                                onClick={() => addLostLine(p)}
                                                                className="flex w-full items-center justify-between px-3 py-1.5 text-left text-sm hover:bg-muted"
                                                            >
                                                                <span className="font-mono text-xs text-muted-foreground shrink-0">
                                                                    {p.sku}
                                                                </span>
                                                                <span className="flex-1 px-3 truncate">{p.name}</span>
                                                                <span className="text-xs text-muted-foreground shrink-0">
                                                                    {p.pricePaise
                                                                        ? `₹${(p.pricePaise / 100).toLocaleString("en-IN")}`
                                                                        : "—"}
                                                                </span>
                                                                <Plus size={13} className="ml-2 text-muted-foreground shrink-0" />
                                                            </button>
                                                        </li>
                                                    ))}
                                                </ul>
                                            )}
                                        </div>

                                        {/* Lost lines table */}
                                        {lostLines.length > 0 && (
                                            <div className="space-y-1.5 mt-1">
                                                {lostLines.map((l) => (
                                                    <div
                                                        key={l.key}
                                                        className="grid grid-cols-[1fr_60px_80px_56px_auto] items-end gap-1.5 rounded-md border border-border px-2 py-1.5"
                                                    >
                                                        <div className="min-w-0">
                                                            <p className="text-[10px] text-muted-foreground font-mono">{l.sku}</p>
                                                            <p className="text-xs truncate">{l.name}</p>
                                                        </div>
                                                        <div>
                                                            <Label className="text-[10px] text-muted-foreground">Qty</Label>
                                                            <Input
                                                                type="text"
                                                                inputMode="decimal"
                                                                className="h-7 text-xs px-1.5"
                                                                value={l.qty}
                                                                onChange={(e) =>
                                                                    updateLostLine(l.key, "qty", Math.max(0.01, Number(e.target.value)))
                                                                }
                                                            />
                                                        </div>
                                                        <div>
                                                            <Label className="text-[10px] text-muted-foreground">Unit ₹</Label>
                                                            <Input
                                                                type="text"
                                                                inputMode="decimal"
                                                                className="h-7 text-xs px-1.5"
                                                                value={l.unitPrice}
                                                                onChange={(e) =>
                                                                    updateLostLine(l.key, "unitPrice", Math.max(0, Number(e.target.value)))
                                                                }
                                                            />
                                                        </div>
                                                        <div>
                                                            <Label className="text-[10px] text-muted-foreground">Tax %</Label>
                                                            <Input
                                                                type="text"
                                                                inputMode="decimal"
                                                                className="h-7 text-xs px-1.5"
                                                                value={l.taxRate}
                                                                onChange={(e) =>
                                                                    updateLostLine(l.key, "taxRate", Math.max(0, Number(e.target.value)))
                                                                }
                                                            />
                                                        </div>
                                                        <button
                                                            type="button"
                                                            onClick={() => removeLostLine(l.key)}
                                                            className="mb-0.5 text-muted-foreground hover:text-destructive transition-colors"
                                                        >
                                                            <X size={13} />
                                                        </button>
                                                    </div>
                                                ))}

                                                {lostTotal > 0 && (
                                                    <div className="flex justify-between rounded-md bg-muted/40 border border-border px-3 py-1.5 text-sm font-semibold">
                                                        <span>Return total</span>
                                                        <span className="font-mono text-red-700 dark:text-red-400">
                                                            − ₹{fmt(lostTotal)}
                                                        </span>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>

                                    <RefundModeToggle mode={lostMode} onMode={setLostMode} />

                                    {/* Reason (required) */}
                                    <div className="space-y-1.5">
                                        <Label htmlFor="lost-reason" className="text-xs">
                                            Reason <span className="text-destructive">*</span>
                                        </Label>
                                        <Textarea
                                            id="lost-reason"
                                            rows={2}
                                            value={reason}
                                            onChange={(e) => setReason(e.target.value)}
                                            placeholder="e.g. Lost bill — item defective, returned after 30 days"
                                        />
                                        {reason.trim().length > 0 && reason.trim().length < 5 && (
                                            <p className="text-xs text-destructive">At least 5 characters required.</p>
                                        )}
                                    </div>
                                </>
                            )}
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

                    {/* Normal return (Tab 1 + Tab 2) */}
                    {(tab === "invoice" || tab === "customer") && selected && (
                        <Button
                            onClick={handleSubmit}
                            disabled={submitting || selectedLines.length === 0 || returnTotal <= 0}
                            className="bg-red-600 hover:bg-red-700 text-white"
                        >
                            {submitting
                                ? <Loader2 size={14} className="animate-spin" />
                                : <Check size={14} />}
                            Confirm return · ₹{fmt(returnTotal)}
                        </Button>
                    )}

                    {/* Lost-invoice return (Tab 3) */}
                    {tab === "lost" && (
                        <Button
                            onClick={handleLostSubmit}
                            disabled={
                                lostSubmitting ||
                                !lostCustomer?.accountId ||
                                lostLines.length === 0 ||
                                lostTotal <= 0 ||
                                reason.trim().length < 5
                            }
                            className="bg-amber-600 hover:bg-amber-700 text-white"
                        >
                            {lostSubmitting
                                ? <Loader2 size={14} className="animate-spin" />
                                : <Check size={14} />}
                            Confirm lost return · ₹{fmt(lostTotal)}
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
