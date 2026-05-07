"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import Link from "next/link";
import {
    Search, X, User, Phone, Mail, Award, TrendingUp, Clock,
    ShoppingCart, Plus, Minus, Trash2, Receipt, ArrowLeft, ExternalLink,
    Banknote, Wallet, CreditCard, Smartphone, Building2, FileText, UserPlus,
    ChevronDown,
} from "lucide-react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

// ── Types ────────────────────────────────────────────────────────────────────

type PartyKind = "customer" | "company";

// Mixed-type lookup row from /api/people?lookup=...
type PartyHit = {
    id: number;
    name: string;
    phone: string | null;
    type: PartyKind;
    accountId: number | null;
    linkedCompanies?: { id: number; name: string; accountId: number | null }[];
};

type Snapshot = {
    party: { kind: "person" | "company"; id: number; name: string; phone: string | null; email: string | null; gstin: string | null };
    account: { id: number; balance: number; openingBalance: number | null } | null;
    turnover: { lifetime: number; last12Months: number; invoiceCount: number };
    discountPct: number;
    loyaltyPoints: number;
    lastVisitAt: string | null;
    recentTickets: Array<{ id: number; createdAt: string; statusLabel: string; statusColor: string }>;
    warrantiesEnding: Array<{ productName: string; endsAt: string }>;
};

type ProductOption = { id: number; sku: string; name: string; pricePaise?: number | null; unit?: { code: string } };
type CartLine = { productId: number; sku: string; name: string; qty: number; unitPrice: number };

type PaymentMethod = "CASH" | "UPI" | "CARD" | "CHEQUE" | "BANK_TRANSFER" | "WALLET" | "CREDIT";
type PaymentSplit = { id: string; method: PaymentMethod; amount: number; reference: string };

const PAYMENT_METHODS: { value: PaymentMethod; label: string; icon: React.ReactNode }[] = [
    { value: "CASH",          label: "Cash",          icon: <Banknote size={14} /> },
    { value: "UPI",           label: "UPI",           icon: <Smartphone size={14} /> },
    { value: "CARD",          label: "Card",          icon: <CreditCard size={14} /> },
    { value: "CHEQUE",        label: "Cheque",        icon: <FileText size={14} /> },
    { value: "BANK_TRANSFER", label: "Bank transfer", icon: <Building2 size={14} /> },
    { value: "WALLET",        label: "Wallet",        icon: <Wallet size={14} /> },
    { value: "CREDIT",        label: "On credit",     icon: <Clock size={14} /> },
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

// "9876543210" or "+91 98765 43210" → phone-like.
// "Ramesh", "Ramesh 9876" → name-like.
function isPhoneLike(q: string): boolean {
    const trimmed = q.trim();
    if (trimmed.length < 4) return false;
    const digits = trimmed.replace(/\D/g, "").length;
    const letters = trimmed.replace(/[^a-zA-Z]/g, "").length;
    return digits >= 4 && letters === 0;
}

// ── Component ────────────────────────────────────────────────────────────────

export default function PosScreen() {
    // ── Customer search omnibox ─────────────────────────────────────────────
    const [custQuery, setCustQuery] = useState("");
    const [custHits, setCustHits] = useState<PartyHit[]>([]);
    const [highlightedHit, setHighlightedHit] = useState(0);
    const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
    const [loadingSnapshot, setLoadingSnapshot] = useState(false);
    const custSearchRef = useRef<HTMLInputElement>(null);

    // ── Product search + cart ───────────────────────────────────────────────
    const [productQuery, setProductQuery] = useState("");
    const [allProducts, setAllProducts] = useState<ProductOption[]>([]);
    const [cart, setCart] = useState<CartLine[]>([]);

    // ── Checkout / payment splits ───────────────────────────────────────────
    const [checkoutOpen, setCheckoutOpen] = useState(false);
    const [splits, setSplits] = useState<PaymentSplit[]>([]);
    const [submitting, setSubmitting] = useState(false);

    // ── Smart create-party dialog ───────────────────────────────────────────
    const [newPartyOpen, setNewPartyOpen] = useState(false);
    const [newParty, setNewParty] = useState({
        name: "", phone: "", email: "", address: "",
        companyName: "", companyPhone: "", companyEmail: "", companyAddress: "", companyGstin: "",
    });
    // Captured at open time — drives form layout (phone-query swaps Phone/Email
    // row above Name so Tab forward from Name skips the pre-filled Phone).
    const [openedAsPhoneQuery, setOpenedAsPhoneQuery] = useState(false);
    // Track whether the user has manually edited the company address —
    // until they do, we mirror person.address into companyAddress.
    const [companyAddressTouched, setCompanyAddressTouched] = useState(false);
    const [creatingParty, setCreatingParty] = useState(false);

    const nameRef       = useRef<HTMLInputElement>(null);
    const phoneRef      = useRef<HTMLInputElement>(null);
    const addressRef    = useRef<HTMLTextAreaElement>(null);
    const companyNameRef    = useRef<HTMLInputElement>(null);
    const companyPhoneRef   = useRef<HTMLInputElement>(null);
    const companyAddressRef = useRef<HTMLTextAreaElement>(null);

    // ── Effects ─────────────────────────────────────────────────────────────

    // Search persons + companies (debounced) via the polymorphic /api/people endpoint
    useEffect(() => {
        if (custQuery.trim().length < 2) { setCustHits([]); return; }
        const t = setTimeout(() => {
            axios.get<PartyHit[]>(`/api/people?lookup=${encodeURIComponent(custQuery)}`)
                .then((r) => {
                    setCustHits(r.data);
                    setHighlightedHit(0);
                })
                .catch(() => setCustHits([]));
        }, 200);
        return () => clearTimeout(t);
    }, [custQuery]);

    // Load all products once for fast typing
    useEffect(() => {
        axios.get<ProductOption[]>("/api/inventory/products/lookup")
            .then((r) => setAllProducts(r.data))
            .catch(() => { /* page is still useful without it */ });
    }, []);

    // Auto-focus on dialog open: phone-like query → name field, otherwise phone field
    useEffect(() => {
        if (!newPartyOpen) return;
        const t = setTimeout(() => {
            (openedAsPhoneQuery ? nameRef.current : phoneRef.current)?.focus();
        }, 50);
        return () => clearTimeout(t);
    }, [newPartyOpen, openedAsPhoneQuery]);

    // Mirror person address → company address until user touches the company-address field
    useEffect(() => {
        if (companyAddressTouched) return;
        if (!newParty.companyName.trim()) return;
        if (newParty.companyAddress === newParty.address) return;
        setNewParty((s) => ({ ...s, companyAddress: s.address }));
    }, [newParty.address, newParty.companyName, newParty.companyAddress, companyAddressTouched]);

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

    const showCompanySection = newParty.companyName.trim().length > 0;
    // Allow submit when EITHER a person (name) OR a company (companyName) is given.
    // User can clear the auto-filled Name to create only a company.
    const canSubmitCreate = newParty.name.trim().length > 0 || newParty.companyName.trim().length > 0;

    // ── Actions ─────────────────────────────────────────────────────────────

    const pickByAccountId = async (accountId: number, displayName: string) => {
        setCustQuery(displayName);
        setCustHits([]);
        setLoadingSnapshot(true);
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

    const pickHit = async (hit: PartyHit) => {
        if (hit.accountId == null) {
            toast.error(`${hit.name} has no ledger account yet`);
            return;
        }
        await pickByAccountId(hit.accountId, hit.name);
    };

    const clearCustomer = () => { setSnapshot(null); setCustQuery(""); custSearchRef.current?.focus(); };

    const openNewParty = () => {
        const q = custQuery.trim();
        const phoneLike = isPhoneLike(q);
        setOpenedAsPhoneQuery(phoneLike);
        setNewParty({
            name:           phoneLike ? "" : q,
            phone:          phoneLike ? q  : "",
            email:          "",
            address:        "",
            companyName:    "",
            companyPhone:   "",
            companyEmail:   "",
            companyAddress: "",
            companyGstin:   "",
        });
        setCompanyAddressTouched(false);
        setCustHits([]);
        setNewPartyOpen(true);
    };

    // ── Search box keyboard handler ─────────────────────────────────────────
    const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "ArrowDown") {
            if (custHits.length === 0) return;
            e.preventDefault();
            setHighlightedHit((i) => Math.min(i + 1, custHits.length - 1));
        } else if (e.key === "ArrowUp") {
            if (custHits.length === 0) return;
            e.preventDefault();
            setHighlightedHit((i) => Math.max(i - 1, 0));
        } else if (e.key === "Enter") {
            if (custQuery.trim().length < 2) return;
            e.preventDefault();
            if (custHits.length === 0) {
                openNewParty();
            } else {
                const hit = custHits[highlightedHit] ?? custHits[0];
                if (hit) void pickHit(hit);
            }
        } else if (e.key === "Escape") {
            setCustHits([]);
        }
    };

    // ── Create dialog: Enter / Tab handlers ─────────────────────────────────
    const onAddressKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        // Enter (without shift) on address → submit. Tab → company name (default).
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (canSubmitCreate) void submitCreate();
        }
    };

    const onAnyEnterToSubmit = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (canSubmitCreate) void submitCreate();
        }
    };

    const submitCreate = async () => {
        const hasPerson  = newParty.name.trim().length > 0;
        const hasCompany = newParty.companyName.trim().length > 0;
        if (!hasPerson && !hasCompany) {
            toast.error("Need at least a name or a company");
            nameRef.current?.focus();
            return;
        }
        setCreatingParty(true);
        try {
            let personAccountId: number | null = null;
            if (hasPerson) {
                const personRes = await axios.post<{ id: number; name: string; account?: { id: number } | null }>(
                    "/api/people",
                    {
                        name:    newParty.name.trim(),
                        phones:  newParty.phone.trim()   ? [newParty.phone.trim()]   : [],
                        emails:  newParty.email.trim()   ? [newParty.email.trim()]   : [],
                        address: newParty.address.trim(),
                    },
                );
                personAccountId = personRes.data.account?.id ?? null;
            }

            let companyAccountId: number | null = null;
            let companyName = "";
            if (hasCompany) {
                const companyRes = await axios.post<{ id: number; name: string; account?: { id: number } | null }>(
                    "/api/companies",
                    {
                        name:    newParty.companyName.trim(),
                        phones:  newParty.companyPhone.trim() ? [newParty.companyPhone.trim()] : [],
                        emails:  newParty.companyEmail.trim() ? [newParty.companyEmail.trim()] : [],
                        address: newParty.companyAddress.trim(),
                        taxId:   newParty.companyGstin.trim(),
                    },
                );
                companyAccountId = companyRes.data.account?.id ?? null;
                companyName = companyRes.data.name;
            }

            // Bill to the company if one was created, else to the person
            const billingAccountId = companyAccountId ?? personAccountId;
            const billingName      = companyAccountId ? companyName : newParty.name.trim();

            if (!billingAccountId) {
                toast.error("Created, but no ledger account was returned — try again");
                return;
            }

            toast.success(
                hasPerson && hasCompany ? `Added · ${newParty.name.trim()} @ ${companyName} — billing to company`
                : hasCompany             ? `Added · ${companyName}`
                                         : `Added · ${newParty.name.trim()}`
            );
            setNewPartyOpen(false);
            await pickByAccountId(billingAccountId, billingName);
        } catch (e: unknown) {
            const msg = axios.isAxiosError(e) ? (e.response?.data as { error?: string })?.error : undefined;
            toast.error(msg ?? "Could not create");
        } finally {
            setCreatingParty(false);
        }
    };

    // ── Cart actions ────────────────────────────────────────────────────────
    const addToCart = (p: ProductOption) => {
        const defaultPrice = p.pricePaise ? p.pricePaise / 100 : 0;
        setCart((prev) => {
            const exist = prev.find((l) => l.productId === p.id);
            if (exist) return prev.map((l) => l.productId === p.id ? { ...l, qty: l.qty + 1 } : l);
            return [...prev, { productId: p.id, sku: p.sku, name: p.name, qty: 1, unitPrice: defaultPrice }];
        });
        setProductQuery("");
    };

    const setQty = (productId: number, qty: number) => {
        if (qty <= 0) { setCart((p) => p.filter((l) => l.productId !== productId)); return; }
        setCart((p) => p.map((l) => l.productId === productId ? { ...l, qty } : l));
    };

    const setPrice = (productId: number, unitPrice: number) =>
        setCart((p) => p.map((l) => l.productId === productId ? { ...l, unitPrice } : l));

    const openCheckout = () => {
        if (!snapshot?.account) { toast.error("Pick a customer first"); return; }
        if (cart.length === 0) { toast.error("Cart is empty"); return; }
        if (cart.some((l) => l.unitPrice <= 0)) { toast.error("All lines need a unit price"); return; }
        setSplits([{ id: crypto.randomUUID(), method: "CASH", amount: total, reference: "" }]);
        setCheckoutOpen(true);
    };

    const generateInvoice = async () => {
        if (!snapshot?.account) return;
        const allocated = splits.reduce((s, p) => s + p.amount, 0);
        if (Math.abs(allocated - total) > 0.01) {
            toast.error(`Allocate exactly ${fmtINR(total)} (${fmtINR(total - allocated)} remaining)`);
            return;
        }
        if (splits.some((p) => p.amount <= 0)) {
            toast.error("Each payment line needs an amount > 0");
            return;
        }
        setSubmitting(true);
        try {
            const today = new Date().toISOString().slice(0, 10);
            const due = new Date(); due.setDate(due.getDate() + 30);
            const splitSummary = splits
                .map((p) => `${PAYMENT_METHODS.find((m) => m.value === p.method)?.label ?? p.method} ${fmtINR(p.amount)}${p.reference ? ` (${p.reference})` : ""}`)
                .join(" + ");
            await axios.post("/api/finance/invoices", {
                accountId: snapshot.account.id,
                issueDate: today,
                dueDate: due.toISOString().slice(0, 10),
                notes: `POS sale (discount ${discountPct}%) | Payments: ${splitSummary}`,
                lines: cart.map((l) => ({
                    description: `${l.sku} — ${l.name}`,
                    quantity: l.qty,
                    unitPrice: l.unitPrice,
                    taxRate: 0,
                })),
                status: "SENT",
            });
            toast.success(`Invoice generated · ${fmtINR(total)}`);
            setCart([]);
            setSplits([]);
            setCheckoutOpen(false);
        } catch {
            toast.error("Failed to generate invoice");
        } finally {
            setSubmitting(false);
        }
    };

    const allocated = splits.reduce((s, p) => s + p.amount, 0);
    const remaining = total - allocated;

    // ── Render ──────────────────────────────────────────────────────────────

    return (
        <div className="flex h-full w-full flex-col">
            {/* Top bar — customer search */}
            <header className="flex shrink-0 items-center gap-3 border-b border-border bg-card px-4 py-3">
                <Link href="/office" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" title="Back to office">
                    <ArrowLeft size={16} />
                </Link>
                <div className="text-sm font-semibold">POS</div>
                <div className="relative flex-1 max-w-2xl">
                    <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
                    <Input
                        ref={custSearchRef}
                        value={custQuery}
                        onChange={(e) => { setCustQuery(e.target.value); if (snapshot) setSnapshot(null); }}
                        onKeyDown={onSearchKeyDown}
                        placeholder="Search person or company by name / phone / email · ↵ to pick · ↵ on no-result to create"
                        className="pl-9"
                    />
                    {(custHits.length > 0 || (custQuery.trim().length >= 2 && !snapshot)) && (
                        <ul className="absolute left-0 right-0 top-full z-10 mt-1 max-h-80 overflow-y-auto rounded-md border border-border bg-popover shadow-lg">
                            {custHits.map((c, i) => (
                                <li key={`${c.type}-${c.id}`}>
                                    <button
                                        type="button"
                                        onClick={() => pickHit(c)}
                                        onMouseEnter={() => setHighlightedHit(i)}
                                        className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm ${i === highlightedHit ? "bg-muted" : "hover:bg-muted"}`}
                                    >
                                        {c.type === "company" ? <Building2 size={14} className="shrink-0 text-muted-foreground" /> : <User size={14} className="shrink-0 text-muted-foreground" />}
                                        <span className="flex-1 truncate">{c.name}</span>
                                        <Badge variant="secondary" className="text-[10px]">
                                            {c.type === "company" ? "Company" : "Person"}
                                        </Badge>
                                        <span className="w-32 truncate text-right text-xs text-muted-foreground">{c.phone ?? ""}</span>
                                    </button>
                                </li>
                            ))}
                            {custQuery.trim().length >= 2 && (
                                <li className="border-t border-border">
                                    <button
                                        type="button"
                                        onClick={openNewParty}
                                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-primary hover:bg-muted"
                                    >
                                        <UserPlus size={14} />
                                        New customer{custHits.length === 0 ? `: "${custQuery.trim()}"` : ""}
                                        <span className="ml-auto text-[10px] text-muted-foreground">↵</span>
                                    </button>
                                </li>
                            )}
                        </ul>
                    )}
                </div>
                {snapshot && (
                    <Button variant="ghost" size="sm" onClick={clearCustomer} className="text-muted-foreground">
                        <X size={14} /> Clear
                    </Button>
                )}
                <Button variant="outline" size="sm" onClick={openNewParty} title="Walk-in customer not in the system yet — create on the fly">
                    <UserPlus size={14} /> New customer
                </Button>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => window.open("/pos", "_blank", "noopener")}
                    title="Open another POS in a new tab — start a parallel bill while this one waits"
                >
                    <ExternalLink size={14} /> New tab
                </Button>
            </header>

            {/* Main grid */}
            <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[1fr_360px]">
                {/* Left column — product picker + cart */}
                <main className="flex min-h-0 flex-col border-r border-border">
                    <div className="shrink-0 border-b border-border p-4">
                        <div className="relative">
                            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
                            <Input
                                value={productQuery}
                                onChange={(e) => setProductQuery(e.target.value)}
                                placeholder="Scan / type product name or SKU…"
                                className="pl-9"
                            />
                            {filteredProducts.length > 0 && (
                                <ul className="absolute left-0 right-0 top-full z-10 mt-1 max-h-72 overflow-y-auto rounded-md border border-border bg-popover shadow-lg">
                                    {filteredProducts.map((p) => (
                                        <li key={p.id}>
                                            <button
                                                type="button"
                                                onClick={() => addToCart(p)}
                                                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted"
                                            >
                                                <span className="font-mono text-xs text-muted-foreground">{p.sku}</span>
                                                <span className="flex-1 px-3 truncate">{p.name}</span>
                                                <Plus size={14} className="text-muted-foreground" />
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
                                    {cart.map((l) => (
                                        <li key={l.productId} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 px-4 py-3">
                                            <div className="min-w-0">
                                                <div className="truncate text-sm font-medium">{l.name}</div>
                                                <div className="font-mono text-xs text-muted-foreground">{l.sku}</div>
                                            </div>
                                            <div className="flex items-center gap-1">
                                                <Button variant="ghost" size="icon-sm" onClick={() => setQty(l.productId, l.qty - 1)}><Minus size={12} /></Button>
                                                <Input
                                                    value={l.qty}
                                                    onChange={(e) => setQty(l.productId, Number(e.target.value) || 0)}
                                                    className="w-14 text-center"
                                                    inputMode="decimal"
                                                />
                                                <Button variant="ghost" size="icon-sm" onClick={() => setQty(l.productId, l.qty + 1)}><Plus size={12} /></Button>
                                            </div>
                                            <Input
                                                value={l.unitPrice || ""}
                                                onChange={(e) => setPrice(l.productId, Number(e.target.value) || 0)}
                                                placeholder="₹ price"
                                                className="w-28 text-right"
                                                inputMode="decimal"
                                            />
                                            <Button variant="ghost" size="icon-sm" onClick={() => setQty(l.productId, 0)} title="Remove">
                                                <Trash2 size={12} className="text-destructive" />
                                            </Button>
                                        </li>
                                    ))}
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
                                <Receipt size={16} /> Checkout
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

            {/* ── Checkout dialog — split payments by mode ────────────────────────── */}
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
                                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Allocated</div>
                                <div className="font-semibold">{fmtINR(allocated)}</div>
                            </div>
                            <div>
                                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Remaining</div>
                                <div className={`font-semibold ${Math.abs(remaining) < 0.01 ? "text-emerald-600" : remaining > 0 ? "text-amber-600" : "text-destructive"}`}>
                                    {fmtINR(remaining)}
                                </div>
                            </div>
                        </div>

                        <ul className="space-y-2">
                            {splits.map((p, i) => (
                                <li key={p.id} className="grid grid-cols-[160px_1fr_1fr_auto] items-center gap-2">
                                    <Select
                                        value={p.method}
                                        onValueChange={(v) =>
                                            setSplits((prev) => prev.map((x) => x.id === p.id ? { ...x, method: v as PaymentMethod } : x))
                                        }
                                    >
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {PAYMENT_METHODS.map((m) => (
                                                <SelectItem key={m.value} value={m.value}>
                                                    <span className="flex items-center gap-2">{m.icon} {m.label}</span>
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <Input
                                        value={p.amount || ""}
                                        onChange={(e) =>
                                            setSplits((prev) => prev.map((x) => x.id === p.id ? { ...x, amount: Number(e.target.value) || 0 } : x))
                                        }
                                        placeholder="₹ amount"
                                        className="text-right"
                                        inputMode="decimal"
                                    />
                                    <Input
                                        value={p.reference}
                                        onChange={(e) =>
                                            setSplits((prev) => prev.map((x) => x.id === p.id ? { ...x, reference: e.target.value } : x))
                                        }
                                        placeholder={p.method === "CASH" ? "—" : "Ref / last-4 / UPI ID"}
                                        disabled={p.method === "CASH"}
                                    />
                                    <Button
                                        variant="ghost"
                                        size="icon-sm"
                                        onClick={() => setSplits((prev) => prev.filter((x) => x.id !== p.id))}
                                        disabled={splits.length === 1}
                                        title={splits.length === 1 ? "Need at least one payment line" : "Remove"}
                                    >
                                        <Trash2 size={12} className="text-destructive" />
                                    </Button>
                                    {i === splits.length - 1 && Math.abs(remaining) > 0.01 && (
                                        <button
                                            type="button"
                                            className="col-span-4 text-left text-xs text-primary hover:underline"
                                            onClick={() =>
                                                setSplits((prev) => prev.map((x) => x.id === p.id ? { ...x, amount: x.amount + remaining } : x))
                                            }
                                        >
                                            Auto-fill remaining ({fmtINR(remaining)}) on this line
                                        </button>
                                    )}
                                </li>
                            ))}
                        </ul>

                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                                setSplits((prev) => [...prev, { id: crypto.randomUUID(), method: "UPI", amount: Math.max(remaining, 0), reference: "" }])
                            }
                        >
                            <Plus size={14} /> Add payment line
                        </Button>
                    </div>

                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setCheckoutOpen(false)} disabled={submitting}>
                            Cancel
                        </Button>
                        <Button onClick={generateInvoice} disabled={submitting || Math.abs(remaining) > 0.01}>
                            <Receipt size={16} /> {submitting ? "Generating…" : `Confirm · ${fmtINR(total)}`}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* ── New person/company dialog (smart focus + progressive company section) ── */}
            <Dialog open={newPartyOpen} onOpenChange={setNewPartyOpen}>
                <DialogContent className={showCompanySection ? "sm:max-w-2xl" : "sm:max-w-md"}>
                    <DialogHeader>
                        <DialogTitle>New customer · ↵ to save</DialogTitle>
                    </DialogHeader>

                    <div className={`grid gap-4 ${showCompanySection ? "sm:grid-cols-2" : ""}`}>
                        {/* Person section */}
                        <div className="space-y-3">
                            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                Person {newParty.name.trim() === "" && newParty.companyName.trim() !== "" && <span className="ml-1 text-[10px] normal-case">· skipped</span>}
                            </div>

                            {/* When the search query was a phone, show Phone+Email row FIRST so
                                Tab forward from the focused Name skips the pre-filled Phone. */}
                            {openedAsPhoneQuery && (
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-1.5">
                                        <Label>Phone</Label>
                                        <Input
                                            ref={phoneRef}
                                            value={newParty.phone}
                                            onChange={(e) => setNewParty((s) => ({ ...s, phone: e.target.value }))}
                                            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); nameRef.current?.focus(); } }}
                                            placeholder="10-digit"
                                            inputMode="tel"
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label>Email</Label>
                                        <Input
                                            value={newParty.email}
                                            onChange={(e) => setNewParty((s) => ({ ...s, email: e.target.value }))}
                                            onKeyDown={onAnyEnterToSubmit}
                                            placeholder="optional"
                                            inputMode="email"
                                        />
                                    </div>
                                </div>
                            )}

                            <div className="space-y-1.5">
                                <Label>Name {showCompanySection ? <span className="text-[10px] text-muted-foreground">— blank for company-only</span> : "*"}</Label>
                                <Input
                                    ref={nameRef}
                                    value={newParty.name}
                                    onChange={(e) => setNewParty((s) => ({ ...s, name: e.target.value }))}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter" && !e.shiftKey) {
                                            e.preventDefault();
                                            if (!openedAsPhoneQuery && !newParty.phone.trim()) phoneRef.current?.focus();
                                            else addressRef.current?.focus();
                                        }
                                    }}
                                    placeholder="Customer name"
                                />
                            </div>

                            {/* Default layout: Phone+Email AFTER Name. */}
                            {!openedAsPhoneQuery && (
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-1.5">
                                        <Label>Phone</Label>
                                        <Input
                                            ref={phoneRef}
                                            value={newParty.phone}
                                            onChange={(e) => setNewParty((s) => ({ ...s, phone: e.target.value }))}
                                            onKeyDown={(e) => {
                                                if (e.key === "Enter" && !e.shiftKey) {
                                                    e.preventDefault();
                                                    if (!newParty.name.trim()) nameRef.current?.focus();
                                                    else addressRef.current?.focus();
                                                }
                                            }}
                                            placeholder="10-digit"
                                            inputMode="tel"
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label>Email</Label>
                                        <Input
                                            value={newParty.email}
                                            onChange={(e) => setNewParty((s) => ({ ...s, email: e.target.value }))}
                                            onKeyDown={onAnyEnterToSubmit}
                                            placeholder="optional"
                                            inputMode="email"
                                        />
                                    </div>
                                </div>
                            )}

                            <div className="space-y-1.5">
                                <Label>Address</Label>
                                <Textarea
                                    ref={addressRef}
                                    value={newParty.address}
                                    onChange={(e) => setNewParty((s) => ({ ...s, address: e.target.value }))}
                                    onKeyDown={onAddressKeyDown}
                                    placeholder="optional · ↵ to save · Tab → company"
                                    rows={2}
                                />
                            </div>

                            <div className="space-y-1.5 pt-1">
                                <Label className="flex items-center gap-1.5 text-muted-foreground">
                                    <ChevronDown size={12} className={showCompanySection ? "rotate-180" : ""} />
                                    Company (optional)
                                </Label>
                                <Input
                                    ref={companyNameRef}
                                    value={newParty.companyName}
                                    onChange={(e) => setNewParty((s) => ({ ...s, companyName: e.target.value }))}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter" && !e.shiftKey) {
                                            e.preventDefault();
                                            if (newParty.companyName.trim()) companyPhoneRef.current?.focus();
                                            else if (canSubmitCreate) void submitCreate();
                                        }
                                    }}
                                    placeholder="Company name (leave empty to bill the person)"
                                />
                            </div>
                        </div>

                        {/* Company section — only visible when companyName is non-empty */}
                        {showCompanySection && (
                            <div className="space-y-3 sm:border-l sm:border-border sm:pl-4">
                                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                    Company · billing here
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-1.5">
                                        <Label>Company phone</Label>
                                        <Input
                                            ref={companyPhoneRef}
                                            value={newParty.companyPhone}
                                            onChange={(e) => setNewParty((s) => ({ ...s, companyPhone: e.target.value }))}
                                            onKeyDown={onAnyEnterToSubmit}
                                            placeholder="own number — no duplicates"
                                            inputMode="tel"
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label>Company email</Label>
                                        <Input
                                            value={newParty.companyEmail}
                                            onChange={(e) => setNewParty((s) => ({ ...s, companyEmail: e.target.value }))}
                                            onKeyDown={onAnyEnterToSubmit}
                                            placeholder="optional"
                                            inputMode="email"
                                        />
                                    </div>
                                </div>
                                <div className="space-y-1.5">
                                    <Label>Company address</Label>
                                    <Textarea
                                        ref={companyAddressRef}
                                        value={newParty.companyAddress}
                                        onChange={(e) => {
                                            setCompanyAddressTouched(true);
                                            setNewParty((s) => ({ ...s, companyAddress: e.target.value }));
                                        }}
                                        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (canSubmitCreate) void submitCreate(); } }}
                                        placeholder={`autofilled from person address${companyAddressTouched ? " (edited)" : ""}`}
                                        rows={2}
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <Label>Company GSTIN</Label>
                                    <Input
                                        value={newParty.companyGstin}
                                        onChange={(e) => setNewParty((s) => ({ ...s, companyGstin: e.target.value.toUpperCase() }))}
                                        onKeyDown={onAnyEnterToSubmit}
                                        placeholder="optional · 15 chars"
                                        className="font-mono"
                                    />
                                </div>
                                <div className="rounded-md border border-border bg-muted/30 p-2 text-xs text-muted-foreground">
                                    The bill goes to the company&apos;s ledger. The person stays as a contact.
                                </div>
                            </div>
                        )}
                    </div>

                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setNewPartyOpen(false)} disabled={creatingParty}>
                            Cancel
                        </Button>
                        <Button onClick={submitCreate} disabled={creatingParty || !canSubmitCreate}>
                            <UserPlus size={16} /> {creatingParty
                                ? "Creating…"
                                : newParty.name.trim() && showCompanySection ? "Create person + company & bill"
                                : showCompanySection                          ? "Create company & bill"
                                                                              : "Create & bill"}
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
    return (
        <div className="space-y-4">
            <div>
                <div className="flex items-center gap-2">
                    {c.kind === "company" ? <Building2 size={16} className="shrink-0 text-muted-foreground" /> : <User size={16} className="shrink-0 text-muted-foreground" />}
                    <h2 className="truncate text-lg font-semibold">{c.name}</h2>
                </div>
                <div className="space-y-0.5 text-xs text-muted-foreground">
                    {c.phone && <div className="flex items-center gap-1.5"><Phone size={11} /> {c.phone}</div>}
                    {c.email && <div className="flex items-center gap-1.5"><Mail size={11} /> {c.email}</div>}
                    {c.gstin && <div className="font-mono">GSTIN {c.gstin}</div>}
                </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
                <Stat icon={<TrendingUp size={14} />} label="Lifetime turnover" value={fmtINR(snapshot.turnover.lifetime)} sub={`${snapshot.turnover.invoiceCount} invoices`} />
                <Stat icon={<TrendingUp size={14} />} label="Last 12 mo" value={fmtINR(snapshot.turnover.last12Months)} />
                <Stat icon={<Award size={14} />} label="Loyalty points" value={String(snapshot.loyaltyPoints)} sub={snapshot.discountPct > 0 ? `${snapshot.discountPct}% discount tier` : "No tier yet"} />
                <Stat icon={<Clock size={14} />} label="Last visit" value={since(snapshot.lastVisitAt)} />
            </div>

            {snapshot.account && (
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
