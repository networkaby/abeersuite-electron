"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import axios from "axios";
import { toast } from "sonner";
import Link from "next/link";
import {
    Search, X, User, Phone, Mail, Award, TrendingUp, Clock,
    ShoppingCart, Plus, Minus, Trash2, ArrowLeft, ExternalLink,
    Banknote, Wallet, CreditCard, Smartphone, Building2, FileText, UserPlus,
    MapPin, Star, Sparkles, AlertCircle, TrendingDown, Tag,
    ReceiptIndianRupee, Check, RotateCcw,
} from "lucide-react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
    PartySearchAndCreate,
    type PartySearchAndCreateHandle,
    type PickedParty,
} from "@/shared/components/PartySearchAndCreate";
import { ActiveShiftBar, type ActiveShift } from "@/modules/pos/components/ActiveShiftBar";
import { ShiftOpenDialog, type OpenedShift } from "@/modules/pos/components/ShiftOpenDialog";
import { HandoverAcceptDialog, type PendingHandover } from "@/modules/pos/components/HandoverAcceptDialog";
import { PosReturnDialog } from "@/modules/pos/components/PosReturnDialog";

// ── Types ────────────────────────────────────────────────────────────────────

type Snapshot = {
    party: { kind: "person" | "company"; id: number; name: string; phone: string | null; email: string | null; gstin: string | null; address: string | null };
    account: { id: number; balance: number; openingBalance: number | null } | null;
    turnover: { lifetime: number; last12Months: number; invoiceCount: number };
    discountPct: number;
    loyaltyPoints: number;
    customerLevel: "Bronze" | "Silver" | "Gold" | "Platinum";
    creditLimit: number | null;    // null = unlimited (no check performed)
    balanceDue: number;
    balanceOverdue: number;
    availableCredit: number | null; // null when creditLimit is null
    rating: number | null;
    favouriteCategory: string | null;
    personalizedOffers: Array<{ id: string; label: string; tag: string }>;
    lastVisitAt: string | null;
    recentTickets: Array<{ id: number; createdAt: string; statusLabel: string; statusColor: string }>;
    warrantiesEnding: Array<{ productName: string; endsAt: string }>;
};

type ProductOption = {
    id: number; sku: string; name: string;
    pricePaise?: number | null;
    mrpPaise?: number | null;
    unit?: { code: string };
    warrantyTerm?: { name: string; durationMonths: number | null } | null;
};
type CartLine = {
    productId: number; sku: string; name: string;
    qty: number; unitPrice: number; description: string;
    mrpPaise?: number | null;
    warrantyLabel?: string | null;
};

// Extras = Card / Cheque / Bank Transfer / Wallet (Cash / UPI / Credit are fixed rows)
type ExtraMethod = "CARD" | "CHEQUE" | "BANK_TRANSFER" | "WALLET";
type ExtraSplit = { id: string; method: ExtraMethod; amount: number; reference: string };

const EXTRA_METHODS: { value: ExtraMethod; label: string; icon: React.ReactNode }[] = [
    { value: "CARD", label: "Card", icon: <CreditCard size={14} /> },
    { value: "CHEQUE", label: "Cheque", icon: <FileText size={14} /> },
    { value: "BANK_TRANSFER", label: "Bank transfer", icon: <Building2 size={14} /> },
    { value: "WALLET", label: "Wallet", icon: <Wallet size={14} /> },
];


// ── Helpers ──────────────────────────────────────────────────────────────────

const fmtINR = (n: number) =>
    `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const since = (iso: string | null) => {
    if (!iso) return "never";
    const d = new Date(iso);
    const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
    if (days < 1) return "today";
    if (days === 1) return "yesterday";
    if (days < 30) return `${days} days ago`;
    if (days < 365) return `${Math.floor(days / 30)} mo ago`;
    return `${Math.floor(days / 365)} yr ago`;
};

// ── Component ────────────────────────────────────────────────────────────────

export default function PosScreen() {
    // ── Customer search omnibox (delegated to shared component) ─────────────
    const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
    const [loadingSnapshot, setLoadingSnapshot] = useState(false);
    const [createDialogOpen, setCreateDialogOpen] = useState(false);
    const partySearchRef = useRef<PartySearchAndCreateHandle>(null);

    // ── Product search + cart ───────────────────────────────────────────────
    const productSearchRef = useRef<HTMLInputElement>(null);
    const [productQuery, setProductQuery] = useState("");
    const [productHighlight, setProductHighlight] = useState(0);
    const [allProducts, setAllProducts] = useState<ProductOption[]>([]);
    const [cart, setCart] = useState<CartLine[]>([]);

    // ── Checkout / payment splits ───────────────────────────────────────────
    // Fixed three-row checkout: Cash (with a separate "return" sub-input),
    // UPI, and Credit (auto-balanced). No method dropdown, no UPI ref.
    const [checkoutOpen, setCheckoutOpen] = useState(false);
    const [pay, setPay] = useState({ cashTendered: 0, cashReturn: 0, upi: 0 });
    const [extras, setExtras] = useState<ExtraSplit[]>([]);
    const [submitting, setSubmitting] = useState(false);
    const cashTenderedRef = useRef<HTMLInputElement>(null);
    const upiAmountRef = useRef<HTMLInputElement>(null);

    // ── Active POS shift ────────────────────────────────────────────────────
    // Mount order:
    //   1. GET /api/pos/shifts/current
    //      → OPEN            : show ActiveShiftBar (billing enabled)
    //      → AWAITING_HANDOVER: show ActiveShiftBar in amber mode (billing blocked)
    //      → null            : check for pending handover ↓
    //   2. GET /api/pos/shifts/pending-handover
    //      → found           : show HandoverAcceptDialog (B accepts A's handover)
    //      → null            : show ShiftOpenDialog (fresh start)
    const [activeShift, setActiveShift]           = useState<ActiveShift | null>(null);
    const [pendingHandover, setPendingHandover]   = useState<PendingHandover | null>(null);
    const [shiftLoaded, setShiftLoaded]           = useState(false);
    const [shiftOpenDialogOpen, setShiftOpenDialogOpen] = useState(false);
    const [returnDialogOpen, setReturnDialogOpen]       = useState(false);

    const refreshActiveShift = useCallback(() => {
        axios.get<ActiveShift | null>("/api/pos/shifts/current")
            .then(async (r) => {
                if (r.data) {
                    setActiveShift(r.data);
                    setPendingHandover(null);
                } else {
                    setActiveShift(null);
                    // Check if B has a handover waiting.
                    try {
                        const h = await axios.get<PendingHandover | null>("/api/pos/shifts/pending-handover");
                        setPendingHandover(h.data);
                    } catch {
                        setPendingHandover(null);
                    }
                }
            })
            .catch(() => { setActiveShift(null); setPendingHandover(null); })
            .finally(() => setShiftLoaded(true));
    }, []);

    useEffect(() => {
        refreshActiveShift();
    }, [refreshActiveShift]);

    // Lookup the first BANK account once — used as the default destination
    // for UPI / Card / Cheque / Bank Transfer payment lines until a per-row
    // account picker lands (plan TODO). CASH lines auto-route to till.
    const [defaultBankAccountId, setDefaultBankAccountId] = useState<number | null>(null);
    useEffect(() => {
        axios.get<{ id: number; name: string; group?: { name: string } | null }[]>("/api/accountancy/accounts?group=Bank+Accounts")
            .then((r) => { if (r.data[0]) setDefaultBankAccountId(r.data[0].id); })
            .catch(() => { /* non-blocking — submit will 422 if user tries non-CASH */ });
    }, []);

    // ── Effects ─────────────────────────────────────────────────────────────

    // Load all products once for fast typing
    useEffect(() => {
        axios.get<ProductOption[]>("/api/inventory/products/lookup")
            .then((r) => setAllProducts(r.data))
            .catch(() => { /* page is still useful without it */ });
    }, []);

    // Ctrl/Cmd+Enter from anywhere → open checkout dialog (skip when modals are already open)
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key !== "Enter") return;
            if (!(e.ctrlKey || e.metaKey)) return;
            if (createDialogOpen || checkoutOpen) return;
            if (cart.length === 0 || !snapshot?.account) return;
            e.preventDefault();
            openCheckout();
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
        // openCheckout closes over current state; safe to depend on the listed values
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cart.length, snapshot?.account, createDialogOpen, checkoutOpen]);

    // ── Computed ────────────────────────────────────────────────────────────

    const filteredProducts = useMemo(() => {
        const q = productQuery.trim().toLowerCase();
        if (!q) return [] as ProductOption[];
        return allProducts
            .filter((p) => p.sku.toLowerCase().includes(q) || p.name.toLowerCase().includes(q))
            .slice(0, 8);
    }, [productQuery, allProducts]);

    const subtotal = cart.reduce((s, l) => s + l.qty * l.unitPrice, 0);
    const discountPct = snapshot?.discountPct ?? 0;
    const discountAmount = (subtotal * discountPct) / 100;
    const tax = 0; // placeholder — wire to GST engine later
    const total = subtotal - discountAmount + tax;

    // ── Actions ─────────────────────────────────────────────────────────────

    const fetchSnapshot = async (accountId: number) => {
        setLoadingSnapshot(true);
        // Once a party is picked the search is locked; shift focus to the product
        // search so the cashier can scan/type immediately.
        setTimeout(() => productSearchRef.current?.focus(), 50);
        try {
            const { data } = await axios.get<Snapshot>(`/api/pos/account-snapshot/${accountId}`);
            setSnapshot(data);
        } catch {
            toast.error("Could not load customer details");
            setSnapshot(null);
        } finally {
            setLoadingSnapshot(false);
        }
    };

    const onPartyPicked = (p: PickedParty) => {
        if (p.accountId == null) {
            toast.error(`${p.name} has no ledger account yet`);
            return;
        }
        void fetchSnapshot(p.accountId);
    };

    const clearCustomer = () => {
        setSnapshot(null);
        partySearchRef.current?.clear();
        partySearchRef.current?.focus();
    };

    // ── Cart actions ────────────────────────────────────────────────────────
    const addToCart = (p: ProductOption) => {
        const defaultPrice = p.pricePaise ? p.pricePaise / 100 : 0;
        const warrantyLabel = p.warrantyTerm
            ? (p.warrantyTerm.durationMonths
                ? (p.warrantyTerm.durationMonths >= 12
                    ? `${Math.floor(p.warrantyTerm.durationMonths / 12)}y${p.warrantyTerm.durationMonths % 12 ? ` ${p.warrantyTerm.durationMonths % 12}m` : ""}`
                    : `${p.warrantyTerm.durationMonths}m`)
                : p.warrantyTerm.name)
            : null;
        setCart((prev) => {
            const exist = prev.find((l) => l.productId === p.id);
            if (exist) return prev.map((l) => l.productId === p.id ? { ...l, qty: l.qty + 1 } : l);
            return [...prev, {
                productId: p.id, sku: p.sku, name: p.name,
                qty: 1, unitPrice: defaultPrice, description: "",
                mrpPaise: p.mrpPaise ?? null,
                warrantyLabel,
            }];
        });
        setProductQuery("");
        // Clear highlight + return focus to the search box so cashier can scan next item
        setProductHighlight(0);
        setTimeout(() => productSearchRef.current?.focus(), 0);
    };

    const setQty = (productId: number, qty: number) => {
        if (qty <= 0) { setCart((p) => p.filter((l) => l.productId !== productId)); return; }
        setCart((p) => p.map((l) => l.productId === productId ? { ...l, qty } : l));
    };

    const setPrice = (productId: number, unitPrice: number) =>
        setCart((p) => p.map((l) => l.productId === productId ? { ...l, unitPrice } : l));

    const setLineDescription = (productId: number, description: string) =>
        setCart((p) => p.map((l) => l.productId === productId ? { ...l, description } : l));

    // ── Product dropdown keyboard nav ──────────────────────────────────────
    const onProductKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (filteredProducts.length === 0) return;
        if (e.key === "ArrowDown") {
            e.preventDefault();
            setProductHighlight((i) => Math.min(i + 1, filteredProducts.length - 1));
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setProductHighlight((i) => Math.max(i - 1, 0));
        } else if (e.key === "Enter") {
            e.preventDefault();
            const pick = filteredProducts[productHighlight] ?? filteredProducts[0];
            if (pick) addToCart(pick);
        } else if (e.key === "Escape") {
            setProductQuery("");
        }
    };

    const openCheckout = () => {
        if (!snapshot?.account) { toast.error("Pick a customer first"); return; }
        if (cart.length === 0) { toast.error("Cart is empty"); return; }
        if (cart.some((l) => l.unitPrice <= 0)) { toast.error("All lines need a unit price"); return; }
        setPay({ cashTendered: 0, cashReturn: 0, upi: 0 });
        setExtras([]);
        setCheckoutOpen(true);
        setTimeout(() => cashTenderedRef.current?.focus(), 50);
    };

    const generateInvoice = async (printAfter = false) => {
        if (!snapshot?.account) return;
        if (creditLimitBreached) return;   // guard against keyboard shortcut bypass
        // Build the summary from the named pay fields. Cash net = tendered − return.
        const summaryParts: string[] = [];
        if (cashNet > 0) {
            const tenderedNote = pay.cashReturn > 0 ? ` (₹${pay.cashTendered} − ₹${pay.cashReturn} return)` : "";
            summaryParts.push(`Cash ${fmtINR(cashNet)}${tenderedNote}`);
        }
        if (pay.upi > 0) summaryParts.push(`UPI ${fmtINR(pay.upi)}`);
        for (const e of extras) {
            if (e.amount <= 0) continue;
            const label = EXTRA_METHODS.find((m) => m.value === e.method)?.label ?? e.method;
            summaryParts.push(`${label} ${fmtINR(e.amount)}${e.reference ? ` (${e.reference})` : ""}`);
        }
        if (onCredit > 0) summaryParts.push(`On credit ${fmtINR(onCredit)}`);
        if (summaryParts.length === 0) {
            toast.error("Enter Cash or UPI — or it'll all go on credit (which is fine, just say so)");
            return;
        }
        if (!activeShift) {
            toast.error("Open a shift before billing");
            setShiftOpenDialogOpen(true);
            return;
        }
        setSubmitting(true);
        try {
            const today = new Date().toISOString().slice(0, 10);
            const due = new Date(); due.setDate(due.getDate() + 30);
            const splitSummary = summaryParts.join(" + ");
            const tail =
                advanceTaken > 0 ? ` | Advance ${fmtINR(advanceTaken)}` :
                    arrearPaid > 0 ? ` | Cleared arrear ${fmtINR(arrearPaid)}` :
                        "";

            // Build structured payments array. CASH auto-routes to till on the
            // server (omit accountId). Non-cash methods need an accountId —
            // until the per-row account picker lands, we use the first BANK
            // account as a sensible default. WALLET (legacy UI value) maps to
            // schema's OTHER enum.
            type PayLine = { method: "CASH" | "MOBILE_PAYMENT" | "BANK_TRANSFER" | "CARD" | "CHEQUE" | "OTHER"; amount: number; accountId?: number; reference?: string };
            const paymentsList: PayLine[] = [];
            if (cashNet > 0)  paymentsList.push({ method: "CASH",           amount: cashNet });
            if (pay.upi > 0)  {
                if (!defaultBankAccountId) { toast.error("No bank account configured. Add one under Chart of Accounts → Bank Accounts."); setSubmitting(false); return; }
                paymentsList.push({ method: "MOBILE_PAYMENT", amount: pay.upi, accountId: defaultBankAccountId });
            }
            for (const e of extras) {
                if (e.amount <= 0) continue;
                if (!defaultBankAccountId) { toast.error("No bank account configured. Add one under Chart of Accounts → Bank Accounts."); setSubmitting(false); return; }
                const method = e.method === "WALLET" ? "OTHER" : e.method;
                paymentsList.push({ method, amount: e.amount, reference: e.reference || undefined, accountId: defaultBankAccountId });
            }
            // On-credit (unpaid) portion stays as AR — the user pays later. We
            // only send the COLLECTED portion as payments; if the entire bill
            // is on credit, no payments line is sent and the server's zod
            // min(1) catches it. The legacy UI permits "all credit" though;
            // accommodate by requiring AT LEAST 1 — see toast above on no
            // cash/upi. If everything is on credit the route is technically
            // not a POS sale yet; surface a clear error.
            if (paymentsList.length === 0) {
                toast.error("POS sale needs at least one paid line (cash, UPI, or other). Use 'Save as credit invoice' for fully-on-credit sales.");
                setSubmitting(false);
                return;
            }
            // POS sale route now requires payments to TOTAL = invoice total.
            // The on-credit portion (`onCredit`) breaks this invariant — for
            // now, only allow full-paid POS sales. Mixed-pay sales should go
            // through the SaleVoucherPage (credit-mode) instead.
            const collectedFromPayments = paymentsList.reduce((s, p) => s + p.amount, 0);
            if (Math.abs(collectedFromPayments - total) > 0.01) {
                toast.error("POS sale must be fully paid. Use 'Save & Print' on /sale for partial / credit sales.");
                setSubmitting(false);
                return;
            }

            const { data } = await axios.post<{ invoiceId: number; invoiceNumber: string }>("/api/pos/sale", {
                accountId: snapshot.account.id,
                issueDate: today,
                dueDate: due.toISOString().slice(0, 10),
                notes: `POS sale (discount ${discountPct}%) | Payments: ${splitSummary}${tail}`,
                lines: cart.map((l) => ({
                    productId: l.productId,
                    description: `${l.sku} — ${l.name}${l.description ? ` · ${l.description}` : ""}`,
                    quantity: l.qty,
                    unitPrice: l.unitPrice,
                    taxRate: 0,
                })),
                payments: paymentsList,
            });
            toast.success(`Invoice ${data.invoiceNumber} · ${fmtINR(total)}`);
            setCart([]);
            setPay({ cashTendered: 0, cashReturn: 0, upi: 0 });
            setExtras([]);
            setCheckoutOpen(false);
            if (printAfter) {
                const relayAvailable = await fetch("http://localhost:9191/health", { signal: AbortSignal.timeout(1000) })
                    .then((r) => r.ok).catch(() => false);
                if (relayAvailable) {
                    fetch("http://localhost:9191/print/pos", {
                        method:  "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            invoiceNumber:  data.invoiceNumber,
                            date:           today,
                            customerName:   snapshot?.party.name ?? "Walk-in",
                            lines: cart.map((l) => ({
                                name:      l.name,
                                qty:       l.qty,
                                unitPrice: l.unitPrice,
                                amount:    l.qty * l.unitPrice,
                            })),
                            subtotal,
                            discountPct,
                            discountAmount,
                            tax,
                            total,
                            cashPaid:   cashNet,
                            upiPaid:    pay.upi,
                            extrasPaid: extras.map((e) => ({ method: e.method, amount: e.amount, reference: e.reference })),
                        }),
                    }).catch(() => toast.error("Thermal print failed"));
                } else {
                    window.open(`/receipt/invoice/${data.invoiceId}?autoprint=1`, "_blank", "noopener");
                }
            }
        } catch (e: unknown) {
            const msg = axios.isAxiosError(e) ? (e.response?.data as { error?: string })?.error : undefined;
            toast.error(msg ?? "Failed to generate invoice");
        } finally {
            setSubmitting(false);
        }
    };

    // Money math derived from pay — Cash net = tendered − return.
    const cashNet = Math.max(0, pay.cashTendered - pay.cashReturn);
    const extrasSum = extras.reduce((s, e) => s + e.amount, 0);
    const collected = cashNet + pay.upi + extrasSum;
    const onCredit = Math.max(0, total - collected);
    const overpaid = Math.max(0, collected - total);
    const balanceDue = snapshot?.balanceDue ?? 0;
    const arrearPaid = Math.min(overpaid, balanceDue);
    const advanceTaken = Math.max(0, overpaid - balanceDue);

    // Credit-limit guard — true when the on-credit portion of this sale would
    // push the customer's outstanding balance past their credit limit.
    const creditLimitBreached: boolean = (() => {
        if (onCredit <= 0)                          return false; // fully paid, no AR impact
        const limit = snapshot?.creditLimit ?? null;
        if (limit === null)                         return false; // unlimited account
        if (limit === 0)                            return true;  // zero-credit account
        return (balanceDue + onCredit) > limit;
    })();

    // ── Render ──────────────────────────────────────────────────────────────

    return (
        <div className="flex h-full w-full flex-col">
            {/* Active shift bar */}
            {activeShift && (
                <ActiveShiftBar
                    shift={activeShift}
                    onClosed={() => { setActiveShift(null); refreshActiveShift(); }}
                    onHandoverCancelled={refreshActiveShift}
                />
            )}
            {/* No-shift warning — only when loaded + no active shift + no pending handover */}
            {shiftLoaded && !activeShift && !pendingHandover && (
                <div className="flex items-center gap-2 border-b border-amber-500/40 bg-amber-50 dark:bg-amber-950/30 px-4 py-2 text-xs">
                    <span className="font-semibold text-amber-700 dark:text-amber-300">⚠ No shift open</span>
                    <span className="text-muted-foreground">Open a shift before billing.</span>
                    <Button size="sm" className="ml-auto h-7 text-xs" onClick={() => setShiftOpenDialogOpen(true)}>
                        Open shift
                    </Button>
                </div>
            )}

            {/* ShiftOpenDialog — fresh start (no handover waiting) */}
            <ShiftOpenDialog
                open={shiftOpenDialogOpen}
                onOpenChange={setShiftOpenDialogOpen}
                onOpened={(s: OpenedShift) => {
                    setActiveShift({
                        id:                s.id,
                        status:            "OPEN",
                        openedAt:          new Date().toISOString(),
                        counter:           s.counter,
                        branch:            s.branch,
                        openingFloatPaise: s.openingFloatPaise,
                    });
                    setShiftOpenDialogOpen(false);
                }}
            />

            {/* HandoverAcceptDialog — shown when B has a pending handover */}
            {pendingHandover && (
                <HandoverAcceptDialog
                    open={true}
                    handover={pendingHandover}
                    onAccepted={(shiftId, openingFloat) => {
                        setPendingHandover(null);
                        refreshActiveShift();
                        void shiftId;
                        void openingFloat;
                    }}
                    onDismiss={() => {
                        // User chose to log out instead.
                        window.location.href = "/api/auth/signout";
                    }}
                />
            )}

            {/* Top bar — customer search */}
            <header className="flex shrink-0 items-center gap-3 border-b border-border bg-card px-4 py-3">
                <Link href="/office" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" title="Back to office">
                    <ArrowLeft size={16} />
                </Link>
                <div className="text-sm font-semibold">POS</div>
                <div className="flex-1 max-w-2xl">
                    <PartySearchAndCreate
                        ref={partySearchRef}
                        onPicked={onPartyPicked}
                        locked={!!snapshot}
                        onDialogOpenChange={setCreateDialogOpen}
                        // POS is strictly customer-facing. The walk-in fall-back
                        // ("Walk-in Cash Customer" ledger) handles the empty-party
                        // case at checkout; here we only show / create debtors.
                        partyGroup="Sundry Debtors"
                    />
                </div>
                {snapshot && (
                    <Button variant="ghost" size="sm" onClick={clearCustomer} className="text-muted-foreground">
                        <X size={14} /> Clear
                    </Button>
                )}
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => partySearchRef.current?.openNew()}
                    title="Walk-in customer not in the system yet — create on the fly"
                >
                    <UserPlus size={14} /> New customer
                </Button>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => window.open("/vouchers/pos", "_blank", "noopener")}
                    title="Open another POS in a new tab — start a parallel bill while this one waits"
                >
                    <ExternalLink size={14} /> New tab
                </Button>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setReturnDialogOpen(true)}
                    title="Process a sale return — by invoice number, customer, or lost invoice"
                >
                    <RotateCcw size={14} /> Return
                </Button>
            </header>

            {/* Sale Return dialog */}
            <PosReturnDialog
                open={returnDialogOpen}
                onOpenChange={setReturnDialogOpen}
                onDone={() => { /* no cart refresh needed — return is a standalone action */ }}
            />

            {/* Main grid */}
            <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[1fr_360px]">
                {/* Left column — product picker + cart */}
                <main className="flex min-h-0 flex-col border-r border-border">
                    <div className="shrink-0 border-b border-border p-4">
                        <div className="relative">
                            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
                            <Input
                                ref={productSearchRef}
                                value={productQuery}
                                onChange={(e) => { setProductQuery(e.target.value); setProductHighlight(0); }}
                                onKeyDown={onProductKeyDown}
                                placeholder="Scan / type · ↑↓ to highlight · ↵ to add"
                                className="pl-9"
                            />
                            {filteredProducts.length > 0 && (
                                <ul className="absolute left-0 right-0 top-full z-10 mt-1 max-h-72 overflow-y-auto rounded-md border border-border bg-popover shadow-lg">
                                    {filteredProducts.map((p, i) => (
                                        <li key={p.id}>
                                            <button
                                                type="button"
                                                onClick={() => addToCart(p)}
                                                onMouseEnter={() => setProductHighlight(i)}
                                                className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm ${i === productHighlight ? "bg-muted" : "hover:bg-muted"}`}
                                            >
                                                <span className="font-mono text-xs text-muted-foreground">{p.sku}</span>
                                                <span className="flex-1 px-3 truncate">{p.name}</span>
                                                <span className="text-xs text-muted-foreground">{p.pricePaise ? `₹${(p.pricePaise / 100).toLocaleString("en-IN")}` : "—"}</span>
                                                <Plus size={14} className="ml-2 text-muted-foreground" />
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    </div>

                    {/* Cart */}
                    <div className="flex min-h-0 flex-1 flex-col">
                        <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2 text-sm font-medium">
                            <ShoppingCart size={14} /> Cart ({cart.length})
                        </div>
                        <div className="flex-1 overflow-y-auto">
                            {cart.length === 0 ? (
                                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                                    No items yet — search above to add.
                                </div>
                            ) : (
                                <ul className="divide-y divide-border">
                                    {cart.map((l) => {
                                        // Enter on any cart-line input → refocus the product search so the
                                        // cashier can scan the next item without reaching for the mouse.
                                        const enterToNextProduct = (e: React.KeyboardEvent) => {
                                            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); productSearchRef.current?.focus(); }
                                        };
                                        const mrp = l.mrpPaise ? l.mrpPaise / 100 : null;
                                        return (
                                            <li key={l.productId} className="px-4 py-2.5">
                                                {/* Wide layout: name | warranty | note | mrp | qty | price | trash all on one line.
                                                    Narrow (<lg) stacks name above and the rest below. */}
                                                <div className="grid items-center gap-2 lg:grid-cols-[minmax(180px,1.4fr)_70px_minmax(160px,1fr)_90px_auto_110px_auto]">
                                                    <div className="min-w-0">
                                                        <div className="truncate text-sm font-medium">{l.name}</div>
                                                        <div className="font-mono text-[10px] text-muted-foreground">{l.sku}</div>
                                                    </div>
                                                    <div className="hidden lg:flex justify-center">
                                                        {l.warrantyLabel ? (
                                                            <Badge variant="secondary" className="text-[10px]">⛨ {l.warrantyLabel}</Badge>
                                                        ) : (
                                                            <span className="text-[10px] text-muted-foreground/60">—</span>
                                                        )}
                                                    </div>
                                                    <Input
                                                        value={l.description}
                                                        onChange={(e) => setLineDescription(l.productId, e.target.value)}
                                                        onKeyDown={enterToNextProduct}
                                                        placeholder="Note — colour, config…"
                                                        className="h-8 text-sm"
                                                    />
                                                    <div className="hidden lg:flex flex-col items-end text-[10px] leading-tight text-muted-foreground">
                                                        {mrp != null ? (
                                                            <>
                                                                <span className="uppercase tracking-wider">MRP</span>
                                                                <span className={mrp !== l.unitPrice ? "line-through" : ""}>{fmtINR(mrp)}</span>
                                                            </>
                                                        ) : <span>—</span>}
                                                    </div>
                                                    <div className="flex items-center gap-1">
                                                        <Button variant="ghost" size="icon-sm" onClick={() => setQty(l.productId, l.qty - 1)}><Minus size={12} /></Button>
                                                        <Input
                                                            value={l.qty}
                                                            onChange={(e) => setQty(l.productId, Number(e.target.value) || 0)}
                                                            onKeyDown={enterToNextProduct}
                                                            className="h-8 w-12 text-center"
                                                            inputMode="decimal"
                                                        />
                                                        <Button variant="ghost" size="icon-sm" onClick={() => setQty(l.productId, l.qty + 1)}><Plus size={12} /></Button>
                                                    </div>
                                                    <Input
                                                        value={l.unitPrice || ""}
                                                        onChange={(e) => setPrice(l.productId, Number(e.target.value) || 0)}
                                                        onKeyDown={enterToNextProduct}
                                                        placeholder="₹ price"
                                                        className="h-8 text-right"
                                                        inputMode="decimal"
                                                    />
                                                    <Button variant="ghost" size="icon-sm" onClick={() => setQty(l.productId, 0)} title="Remove">
                                                        <Trash2 size={12} className="text-destructive" />
                                                    </Button>
                                                </div>
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}
                        </div>

                        {/* Totals + checkout */}
                        <div className="shrink-0 space-y-2 border-t border-border p-4">
                            <Row label="Subtotal" value={fmtINR(subtotal)} />
                            {discountPct > 0 && <Row label={`Loyalty discount (${discountPct}%)`} value={`− ${fmtINR(discountAmount)}`} highlight />}
                            <Row label="Tax" value={fmtINR(tax)} muted />
                            <div className="flex items-center justify-between border-t border-border pt-2 text-lg font-semibold">
                                <span>Total</span>
                                <span>{fmtINR(total)}</span>
                            </div>
                            <Button onClick={openCheckout} disabled={cart.length === 0 || !snapshot?.account} className="w-full" size="lg">
                                <ReceiptIndianRupee size={16} /> Checkout
                                <span className="ml-2 rounded border border-primary-foreground/30 px-1.5 py-px text-[10px] opacity-80">Ctrl ↵</span>
                            </Button>
                        </div>
                    </div>
                </main>

                {/* Right column — customer "we know you" panel */}
                <aside className="flex min-h-0 flex-col overflow-y-auto bg-muted/30 p-4">
                    {!snapshot ? (
                        <div className="flex h-full flex-col items-center justify-center text-center text-sm text-muted-foreground">
                            <User size={32} className="mb-2 opacity-40" />
                            <p>Search and pick a customer to see their profile here.</p>
                        </div>
                    ) : loadingSnapshot ? (
                        <div className="text-sm text-muted-foreground">Loading…</div>
                    ) : (
                        <CustomerPanel snapshot={snapshot} />
                    )}
                </aside>
            </div>

            {/* ── Checkout dialog — fixed Cash / UPI / Credit rows ──────────────── */}
            <Dialog open={checkoutOpen} onOpenChange={setCheckoutOpen}>
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Checkout · {fmtINR(total)}</DialogTitle>
                    </DialogHeader>

                    <div className="space-y-3">
                        <div className="grid grid-cols-3 gap-2 rounded-md border border-border bg-muted/30 p-3 text-center text-sm">
                            <div>
                                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Total</div>
                                <div className="font-semibold">{fmtINR(total)}</div>
                            </div>
                            <div>
                                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Collected</div>
                                <div className="font-semibold">{fmtINR(collected)}</div>
                            </div>
                            <div>
                                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">On credit</div>
                                <div className={`font-semibold ${onCredit > 0 ? "text-amber-600" : "text-emerald-600"}`}>{fmtINR(onCredit)}</div>
                            </div>
                        </div>

                        {/* Credit limit warning — shown when on-credit portion would breach the limit */}
                        {creditLimitBreached && (
                            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                                <AlertCircle size={16} className="mt-0.5 shrink-0" />
                                <span>
                                    {snapshot?.creditLimit === 0
                                        ? "No credit facility — this account must be paid in full."
                                        : `Credit limit ₹${snapshot!.creditLimit!.toLocaleString("en-IN")} exceeded. ` +
                                          `Outstanding ₹${balanceDue.toLocaleString("en-IN")}, ` +
                                          `this sale adds ₹${onCredit.toLocaleString("en-IN")} on credit.`
                                    }
                                </span>
                            </div>
                        )}

                        {(() => {
                            // Enter on any amount field → confirm. Tab walks Cash → UPI → Confirm
                            // (Cash-return is tabIndex=-1 and skipped; clickable for chip-changing).
                            const enterToSubmit = (e: React.KeyboardEvent) => {
                                if (e.key === "Enter" && !e.shiftKey) {
                                    e.preventDefault();
                                    void generateInvoice(e.ctrlKey || e.metaKey);
                                }
                            };
                            return (
                                <div className="space-y-2">
                                    {/* Cash — tendered + return on the same row, hint with net cash */}
                                    <div className="grid grid-cols-[80px_1fr_auto_1fr] items-center gap-2">
                                        <Label className="flex items-center gap-1 text-xs">
                                            <Banknote size={12} /> Cash
                                            <button
                                                type="button"
                                                title="Fill remaining amount in cash"
                                                onClick={() => {
                                                    const remaining = Math.max(0, +(total - pay.upi - extrasSum).toFixed(2));
                                                    setPay((s) => ({ ...s, cashTendered: remaining, cashReturn: 0 }));
                                                    setTimeout(() => cashTenderedRef.current?.select(), 0);
                                                }}
                                                className="ml-0.5 rounded-full text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 p-0.5 transition-colors"
                                            >
                                                <Check size={11} strokeWidth={2.5} />
                                            </button>
                                        </Label>
                                        <Input
                                            ref={cashTenderedRef}
                                            value={pay.cashTendered || ""}
                                            onChange={(e) => setPay((s) => ({ ...s, cashTendered: Number(e.target.value) || 0 }))}
                                            onKeyDown={enterToSubmit}
                                            placeholder="₹ tendered"
                                            inputMode="decimal"
                                            className="text-right"
                                        />
                                        <Label className="flex items-center gap-1 text-[10px] text-muted-foreground">return</Label>
                                        <Input
                                            value={pay.cashReturn || ""}
                                            onChange={(e) => setPay((s) => ({ ...s, cashReturn: Number(e.target.value) || 0 }))}
                                            onKeyDown={enterToSubmit}
                                            placeholder="₹ change back"
                                            inputMode="decimal"
                                            className="text-right"
                                        />
                                    </div>
                                    {pay.cashReturn > 0 && (
                                        <div className="pl-[88px] text-[11px] text-muted-foreground">
                                            net cash {fmtINR(cashNet)} = ₹{pay.cashTendered} − ₹{pay.cashReturn} return
                                        </div>
                                    )}

                                    {/* UPI — single amount field, no reference */}
                                    <div className="grid grid-cols-[80px_1fr] items-center gap-2">
                                        <Label className="flex items-center gap-1 text-xs">
                                            <Smartphone size={12} /> UPI
                                            <button
                                                type="button"
                                                title="Fill remaining amount in UPI"
                                                onClick={() => {
                                                    const remaining = Math.max(0, +(total - cashNet - extrasSum).toFixed(2));
                                                    setPay((s) => ({ ...s, upi: remaining }));
                                                    setTimeout(() => upiAmountRef.current?.select(), 0);
                                                }}
                                                className="ml-0.5 rounded-full text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 p-0.5 transition-colors"
                                            >
                                                <Check size={11} strokeWidth={2.5} />
                                            </button>
                                        </Label>
                                        <Input
                                            ref={upiAmountRef}
                                            value={pay.upi || ""}
                                            onChange={(e) => setPay((s) => ({ ...s, upi: Number(e.target.value) || 0 }))}
                                            onKeyDown={enterToSubmit}
                                            placeholder="₹ amount"
                                            inputMode="decimal"
                                            className="text-right"
                                        />
                                    </div>

                                    {/* Extras — Card / Cheque / Bank Transfer / Wallet (added on demand) */}
                                    {extras.map((e) => (
                                        <div key={e.id} className="grid grid-cols-[160px_1fr_1fr_auto] items-center gap-2">
                                            <Select
                                                value={e.method}
                                                onValueChange={(v) => setExtras((prev) => prev.map((x) => x.id === e.id ? { ...x, method: v as ExtraMethod } : x))}
                                            >
                                                <SelectTrigger>
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {EXTRA_METHODS.map((m) => (
                                                        <SelectItem key={m.value} value={m.value}>
                                                            <span className="flex items-center gap-2">{m.icon} {m.label}</span>
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                            <Input
                                                value={e.amount || ""}
                                                onChange={(ev) => setExtras((prev) => prev.map((x) => x.id === e.id ? { ...x, amount: Number(ev.target.value) || 0 } : x))}
                                                onKeyDown={enterToSubmit}
                                                placeholder="₹ amount"
                                                className="text-right"
                                                inputMode="decimal"
                                            />
                                            <Input
                                                value={e.reference}
                                                onChange={(ev) => setExtras((prev) => prev.map((x) => x.id === e.id ? { ...x, reference: ev.target.value } : x))}
                                                onKeyDown={enterToSubmit}
                                                placeholder="Ref / last-4"
                                            />
                                            <Button
                                                variant="ghost"
                                                size="icon-sm"
                                                onClick={() => setExtras((prev) => prev.filter((x) => x.id !== e.id))}
                                                title="Remove"
                                            >
                                                <Trash2 size={12} className="text-destructive" />
                                            </Button>
                                        </div>
                                    ))}

                                    {/* Credit — readonly, auto-balanced */}
                                    <div className="grid grid-cols-[80px_1fr] items-center gap-2">
                                        <Label className="flex items-center gap-1.5 text-xs text-muted-foreground"><Clock size={12} /> Credit</Label>
                                        <Input
                                            value={onCredit ? onCredit.toFixed(2) : ""}
                                            readOnly
                                            tabIndex={-1}
                                            placeholder="auto"
                                            className="bg-muted/50 cursor-default text-right"
                                            title="Auto-balanced — fill Cash / UPI / Card etc. and the rest goes on credit"
                                        />
                                    </div>
                                    <div className="flex items-center justify-between gap-2">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => setExtras((prev) => [...prev, { id: crypto.randomUUID(), method: "CARD", amount: 0, reference: "" }])}
                                        >
                                            <Plus size={14} /> Add payment line
                                        </Button>

                                        <ReceiptIndianRupee size={16} /> {submitting
                                            ? "Saving…"
                                            : advanceTaken > 0 ? `Confirm · ${fmtINR(total)} + ${fmtINR(advanceTaken)} adv.`
                                                : arrearPaid > 0 ? `Confirm · ${fmtINR(total)} + ${fmtINR(arrearPaid)} arrear`
                                                    : onCredit > 0 ? `Confirm · ${fmtINR(collected)} + ${fmtINR(onCredit)} credit`
                                                        : `Confirm · ${fmtINR(total)}`}
                                        <span className="ml-2 rounded border border-primary-foreground/30 px-1.5 py-px text-[10px] opacity-80">↵</span>
                                    </div>
                                    {/* Arrear / advance breakdown — when collected > total or customer has dues */}
                                    {(overpaid > 0 || balanceDue > 0) && (
                                        <div className="space-y-1 rounded-md border border-border bg-muted/30 p-2.5 text-xs">
                                            {balanceDue > 0 && (
                                                <div className="flex items-center justify-between">
                                                    <span className="text-muted-foreground">Existing dues</span>
                                                    <span className="font-medium text-amber-600">{fmtINR(balanceDue)}</span>
                                                </div>
                                            )}
                                            {arrearPaid > 0 && (
                                                <div className="flex items-center justify-between">
                                                    <span className="text-muted-foreground">Arrear cleared this visit</span>
                                                    <span className="font-medium text-emerald-600">− {fmtINR(arrearPaid)}</span>
                                                </div>
                                            )}
                                            {advanceTaken > 0 && (
                                                <div className="flex items-center justify-between">
                                                    <span className="text-muted-foreground">Advance from customer</span>
                                                    <span className="font-medium text-emerald-700">+ {fmtINR(advanceTaken)}</span>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* Inline confirm CTAs — final amount + actions sit close to the payment-line entry */}
                                    <div className="grid grid-cols-2 gap-2 pt-1">
                                        <Button onClick={() => generateInvoice(false)} disabled={submitting || creditLimitBreached} size="lg" variant="outline">
                                            {/* <Receipt size={16} /> {submitting
                                                ? "Saving…"
                                                : advanceTaken > 0 ? `Confirm · ${fmtINR(total)} + ${fmtINR(advanceTaken)} adv.`
                                                    : arrearPaid > 0 ? `Confirm · ${fmtINR(total)} + ${fmtINR(arrearPaid)} arrear`
                                                        : onCredit > 0 ? `Confirm · ${fmtINR(collected)} + ${fmtINR(onCredit)} credit`
                                                            : `Confirm · ${fmtINR(total)}`}
                                            <span className="ml-2 rounded border border-primary-foreground/30 px-1.5 py-px text-[10px] opacity-80">↵</span> */}
                                            <ReceiptIndianRupee size={16} /> {submitting ? "Saving…" : "Confirm"}
                                            <span className="ml-2 rounded border border-primary-foreground/30 px-1.5 py-px text-[10px] opacity-80">↵</span>
                                        </Button>
                                        <Button onClick={() => generateInvoice(true)} disabled={submitting || creditLimitBreached} size="lg" >
                                            <ReceiptIndianRupee size={16} /> {submitting ? "Saving…" : "Confirm + Print"}
                                            <span className="ml-2 rounded border border-border px-1.5 py-px text-[10px] opacity-80">Ctrl ↵</span>
                                        </Button>
                                    </div>
                                </div>
                            );
                        })()}
                    </div>

                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setCheckoutOpen(false)} disabled={submitting}>
                            Cancel
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

        </div>
    );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function Row({ label, value, muted, highlight }: { label: string; value: string; muted?: boolean; highlight?: boolean }) {
    return (
        <div className={`flex items-center justify-between text-sm ${muted ? "text-muted-foreground" : ""} ${highlight ? "text-emerald-600 dark:text-emerald-400" : ""}`}>
            <span>{label}</span>
            <span className="font-medium">{value}</span>
        </div>
    );
}

function CustomerPanel({ snapshot }: { snapshot: Snapshot }) {
    const c = snapshot.party;
    const levelColor =
        snapshot.customerLevel === "Platinum" ? "bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300" :
            snapshot.customerLevel === "Gold" ? "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300" :
                snapshot.customerLevel === "Silver" ? "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300" :
                    "bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300";
    return (
        <div className="space-y-4">
            <div>
                <div className="flex items-center gap-2">
                    {c.kind === "company" ? <Building2 size={16} className="shrink-0 text-muted-foreground" /> : <User size={16} className="shrink-0 text-muted-foreground" />}
                    <h2 className="truncate text-lg font-semibold">{c.name}</h2>
                    <Badge className={`text-[10px] ${levelColor}`}>{snapshot.customerLevel}</Badge>
                </div>
                <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                    {c.phone && <div className="flex items-center gap-1.5"><Phone size={11} /> {c.phone}</div>}
                    {c.email && <div className="flex items-center gap-1.5"><Mail size={11} /> {c.email}</div>}
                    {c.address && <div className="flex items-start gap-1.5"><MapPin size={11} className="mt-0.5 shrink-0" /> <span className="whitespace-pre-line">{c.address}</span></div>}
                    {c.gstin && <div className="font-mono">GSTIN {c.gstin}</div>}
                </div>
            </div>

            {/* Money row — Available credit, Due, Overdue */}
            <div className="grid grid-cols-3 gap-2">
                <Stat
                    icon={<CreditCard size={14} />}
                    label="Avail. credit"
                    value={snapshot.availableCredit != null ? fmtINR(snapshot.availableCredit) : "Unlimited"}
                    sub={snapshot.creditLimit != null ? `limit ${fmtINR(snapshot.creditLimit)}` : "no limit set"}
                />
                <Stat
                    icon={<TrendingDown size={14} />}
                    label="Due"
                    value={fmtINR(snapshot.balanceDue)}
                    sub={snapshot.balanceDue > 0 ? "outstanding" : "clean"}
                />
                <Stat
                    icon={<AlertCircle size={14} />}
                    label="Overdue"
                    value={fmtINR(snapshot.balanceOverdue)}
                    sub={snapshot.balanceOverdue > 0 ? "past due" : "—"}
                />
            </div>

            {/* Lifetime + visits row */}
            <div className="grid grid-cols-2 gap-2">
                <Stat icon={<TrendingUp size={14} />} label="Lifetime turnover" value={fmtINR(snapshot.turnover.lifetime)} sub={`${snapshot.turnover.invoiceCount} invoices`} />
                <Stat icon={<TrendingUp size={14} />} label="Last 12 mo" value={fmtINR(snapshot.turnover.last12Months)} />
                <Stat icon={<Award size={14} />} label="Loyalty points" value={String(snapshot.loyaltyPoints)} sub={snapshot.discountPct > 0 ? `${snapshot.discountPct}% discount tier` : "No tier yet"} />
                <Stat icon={<Clock size={14} />} label="Last visit" value={since(snapshot.lastVisitAt)} />
            </div>

            {/* Performance row — rating + favourite category */}
            <div className="grid grid-cols-2 gap-2">
                <Stat
                    icon={<Star size={14} />}
                    label="Rating"
                    value={snapshot.rating != null ? `${snapshot.rating.toFixed(1)} / 5` : "—"}
                    sub={snapshot.rating == null ? "no rating yet" : undefined}
                />
                <Stat
                    icon={<Tag size={14} />}
                    label="Favourite category"
                    value={snapshot.favouriteCategory ?? "—"}
                    sub={snapshot.favouriteCategory == null ? "needs invoice→product link" : undefined}
                />
            </div>

            {/* Personalized offers / coupons */}
            {snapshot.personalizedOffers.length > 0 ? (
                <div>
                    <div className="mb-1.5 flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        <Sparkles size={11} /> Offers for {c.name}
                    </div>
                    <ul className="space-y-1.5">
                        {snapshot.personalizedOffers.map((o) => (
                            <li key={o.id} className="flex items-center justify-between rounded-md border border-emerald-300/40 bg-emerald-500/10 px-2.5 py-1.5 text-xs">
                                <span>{o.label}</span>
                                <Badge variant="secondary" className="text-[10px]">{o.tag}</Badge>
                            </li>
                        ))}
                    </ul>
                </div>
            ) : (
                <div className="rounded-md border border-dashed border-border p-2 text-[11px] text-muted-foreground">
                    <div className="mb-0.5 flex items-center gap-1 font-semibold uppercase tracking-wider"><Sparkles size={10} /> Personalized offers</div>
                    No offers linked yet — wire <code className="font-mono">/api/coupons</code> + segments to populate.
                </div>
            )}

            {snapshot.account && snapshot.account.balance !== 0 && (
                <div className="rounded-md border border-border bg-card p-3 text-sm">
                    <div className="text-xs text-muted-foreground">Ledger balance</div>
                    <div className={`text-lg font-semibold ${snapshot.account.balance > 0 ? "text-amber-600" : "text-emerald-600"}`}>
                        {fmtINR(snapshot.account.balance)}
                    </div>
                    {snapshot.account.balance > 0 && (
                        <div className="mt-1 text-xs text-amber-600">Outstanding — collect at this visit?</div>
                    )}
                </div>
            )}

            {snapshot.recentTickets.length > 0 && (
                <div>
                    <div className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Recent tickets</div>
                    <ul className="space-y-1.5">
                        {snapshot.recentTickets.map((t) => (
                            <li key={t.id} className="flex items-center justify-between rounded-md border border-border bg-card px-2.5 py-1.5 text-xs">
                                <span className="font-mono">#{t.id}</span>
                                <Badge variant="secondary" className="text-[10px]">{t.statusLabel}</Badge>
                                <span className="text-muted-foreground">{since(t.createdAt)}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {snapshot.warrantiesEnding.length > 0 && (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs">
                    <div className="mb-1 font-semibold text-amber-700">Warranties ending soon</div>
                    {snapshot.warrantiesEnding.map((w) => (
                        <div key={w.productName} className="flex items-center justify-between">
                            <span className="truncate">{w.productName}</span>
                            <span className="text-muted-foreground">{w.endsAt}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

function Stat({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
    return (
        <div className="rounded-md border border-border bg-card p-3">
            <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                {icon} {label}
            </div>
            <div className="mt-1 text-base font-semibold">{value}</div>
            {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
        </div>
    );
}
