"use client";

import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import Link from "next/link";
import {
    Search, X, User, Phone, Mail, Award, TrendingUp, Clock,
    ShoppingCart, Plus, Minus, Trash2, Receipt, ArrowLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

// ── Types ────────────────────────────────────────────────────────────────────

type CustomerHit = { id: number; name: string; phone: string | null; email: string | null };

type Snapshot = {
    customer: { id: number; name: string; phone: string | null; email: string | null; gstin: string | null };
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
    // Customer state
    const [custQuery, setCustQuery] = useState("");
    const [custHits, setCustHits] = useState<CustomerHit[]>([]);
    const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
    const [loadingSnapshot, setLoadingSnapshot] = useState(false);

    // Product state
    const [productQuery, setProductQuery] = useState("");
    const [allProducts, setAllProducts] = useState<ProductOption[]>([]);
    const [cart, setCart] = useState<CartLine[]>([]);

    // Submitting
    const [submitting, setSubmitting] = useState(false);

    // ── Effects ─────────────────────────────────────────────────────────────

    // Search customers (debounced)
    useEffect(() => {
        if (custQuery.trim().length < 2) { setCustHits([]); return; }
        const t = setTimeout(() => {
            axios.get<CustomerHit[]>(`/api/pos/customers/search?q=${encodeURIComponent(custQuery)}`)
                .then((r) => setCustHits(r.data))
                .catch(() => setCustHits([]));
        }, 250);
        return () => clearTimeout(t);
    }, [custQuery]);

    // Load all products once for fast typing
    useEffect(() => {
        axios.get<ProductOption[]>("/api/inventory/products/lookup")
            .then((r) => setAllProducts(r.data))
            .catch(() => { /* page is still useful without it */ });
    }, []);

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

    const pickCustomer = async (c: CustomerHit) => {
        setCustQuery(c.name);
        setCustHits([]);
        setLoadingSnapshot(true);
        try {
            const { data } = await axios.get<Snapshot>(`/api/pos/customer-snapshot/${c.id}`);
            setSnapshot(data);
        } catch {
            toast.error("Could not load customer details");
            setSnapshot(null);
        } finally {
            setLoadingSnapshot(false);
        }
    };

    const clearCustomer = () => { setSnapshot(null); setCustQuery(""); };

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

    const generateInvoice = async () => {
        if (!snapshot?.account) { toast.error("Pick a customer first"); return; }
        if (cart.length === 0) { toast.error("Cart is empty"); return; }
        if (cart.some((l) => l.unitPrice <= 0)) { toast.error("All lines need a unit price"); return; }
        setSubmitting(true);
        try {
            const today = new Date().toISOString().slice(0, 10);
            const due = new Date(); due.setDate(due.getDate() + 30);
            await axios.post("/api/finance/invoices", {
                accountId: snapshot.account.id,
                issueDate: today,
                dueDate: due.toISOString().slice(0, 10),
                notes: `POS sale (discount ${discountPct}%)`,
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
        } catch {
            toast.error("Failed to generate invoice");
        } finally {
            setSubmitting(false);
        }
    };

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
                        value={custQuery}
                        onChange={(e) => { setCustQuery(e.target.value); if (snapshot) setSnapshot(null); }}
                        placeholder="Search customer by name, phone, or email…"
                        className="pl-9"
                    />
                    {custHits.length > 0 && (
                        <ul className="absolute left-0 right-0 top-full z-10 mt-1 max-h-72 overflow-y-auto rounded-md border border-border bg-popover shadow-lg">
                            {custHits.map((c) => (
                                <li key={c.id}>
                                    <button
                                        type="button"
                                        onClick={() => pickCustomer(c)}
                                        className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted"
                                    >
                                        <span>{c.name}</span>
                                        <span className="text-xs text-muted-foreground">{c.phone ?? c.email ?? ""}</span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
                {snapshot && (
                    <Button variant="ghost" size="sm" onClick={clearCustomer} className="text-muted-foreground">
                        <X size={14} /> Clear
                    </Button>
                )}
            </header>

            {/* Main grid: products+cart on left, customer panel on right */}
            <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[1fr_360px]">
                {/* Left column — product picker + cart */}
                <main className="flex min-h-0 flex-col border-r border-border">
                    {/* Product search */}
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
                            <Button onClick={generateInvoice} disabled={submitting || cart.length === 0 || !snapshot?.account} className="w-full" size="lg">
                                <Receipt size={16} /> {submitting ? "Generating…" : "Generate invoice"}
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
    const c = snapshot.customer;
    return (
        <div className="space-y-4">
            <div>
                <h2 className="truncate text-lg font-semibold">{c.name}</h2>
                <div className="space-y-0.5 text-xs text-muted-foreground">
                    {c.phone && <div className="flex items-center gap-1.5"><Phone size={11} /> {c.phone}</div>}
                    {c.email && <div className="flex items-center gap-1.5"><Mail size={11} /> {c.email}</div>}
                    {c.gstin && <div className="font-mono">GSTIN {c.gstin}</div>}
                </div>
            </div>

            {/* Stats grid */}
            <div className="grid grid-cols-2 gap-2">
                <Stat
                    icon={<TrendingUp size={14} />}
                    label="Lifetime turnover"
                    value={fmtINR(snapshot.turnover.lifetime)}
                    sub={`${snapshot.turnover.invoiceCount} invoices`}
                />
                <Stat
                    icon={<TrendingUp size={14} />}
                    label="Last 12 mo"
                    value={fmtINR(snapshot.turnover.last12Months)}
                />
                <Stat
                    icon={<Award size={14} />}
                    label="Loyalty points"
                    value={String(snapshot.loyaltyPoints)}
                    sub={snapshot.discountPct > 0 ? `${snapshot.discountPct}% discount tier` : "No tier yet"}
                />
                <Stat
                    icon={<Clock size={14} />}
                    label="Last visit"
                    value={since(snapshot.lastVisitAt)}
                />
            </div>

            {/* Ledger */}
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

            {/* Recent tickets */}
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

            {/* Warranties expiring — placeholder zone for now */}
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
