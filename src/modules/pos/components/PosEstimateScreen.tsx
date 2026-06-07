"use client";

import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import Link from "next/link";
import { ArrowLeft, Search, Plus, Minus, Trash2, X, FileText, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    PartySearchAndCreate,
    type PickedParty,
} from "@/shared/components/PartySearchAndCreate";
import { formatRupeesFromPaise } from "@/shared/lib/format/moneyInr";
import { PosModeSwitch } from "@/modules/pos/components/PosModeSwitch";

// A product as returned by /api/inventory/products/lookup (list mode). We only
// read the fields the estimate needs — note we deliberately IGNORE the strategy
// (effective) price: an estimate prints the public barcode/tag price only, so
// the discounted price never leaves the cart (price privacy).
type LookupProduct = {
    id: number;
    sku: string;
    name: string;
    mrpPaise: number | null;
    pricePaise: number | null;          // effective/strategy — NOT shown
    barcodePricePaise: number | null;   // tag/cap price — what we quote
};

type EstimateLine = {
    productId: number;
    name: string;
    sku: string;
    qty: number;
    tagPaise: number;     // unit tag price (paise) — the quoted price
    mrpPaise: number | null;
};

/** The public tag price to quote; falls back to MRP, then effective, then 0. */
function tagOf(p: LookupProduct): number {
    return p.barcodePricePaise ?? p.mrpPaise ?? p.pricePaise ?? 0;
}

export default function PosEstimateScreen() {
    const [party, setParty] = useState<PickedParty | null>(null);
    const [products, setProducts] = useState<LookupProduct[]>([]);
    const [query, setQuery] = useState("");
    const [cart, setCart] = useState<EstimateLine[]>([]);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        axios
            .get<LookupProduct[]>("/api/inventory/products/lookup")
            .then((r) => setProducts(r.data))
            .catch(() => toast.error("Failed to load products"));
    }, []);

    const results = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return [];
        return products
            .filter((p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q))
            .slice(0, 40);
    }, [products, query]);

    const total = useMemo(() => cart.reduce((s, l) => s + l.qty * l.tagPaise, 0), [cart]);

    function addProduct(p: LookupProduct) {
        setCart((prev) => {
            const i = prev.findIndex((l) => l.productId === p.id);
            if (i >= 0) {
                const next = [...prev];
                next[i] = { ...next[i], qty: next[i].qty + 1 };
                return next;
            }
            return [
                ...prev,
                { productId: p.id, name: p.name, sku: p.sku, qty: 1, tagPaise: tagOf(p), mrpPaise: p.mrpPaise },
            ];
        });
        setQuery("");
    }

    function setQty(productId: number, qty: number) {
        setCart((prev) =>
            prev.flatMap((l) =>
                l.productId === productId ? (qty <= 0 ? [] : [{ ...l, qty }]) : [l],
            ),
        );
    }

    async function saveAndPrint() {
        if (cart.length === 0) {
            toast.error("Add at least one item");
            return;
        }
        setSaving(true);
        try {
            const payload = {
                accountId: party?.accountId ?? null,
                partyType: party ? (party.kind === "company" ? "company" : "customer") : null,
                partyId: party?.id ?? null,
                partyName: party?.name ?? null,
                partyPhone: party?.phone ?? null,
                lines: cart.map((l) => ({
                    productId: l.productId,
                    description: l.name,
                    quantity: l.qty,
                    rate: l.tagPaise / 100, // tag price in rupees
                    mrpPaise: l.mrpPaise ?? undefined,
                    taxRate: 0,
                })),
            };
            const { data } = await axios.post<{ voucherId: number; reference: string; dealId: number | null }>(
                "/api/pos/estimate",
                payload,
            );
            toast.success(
                `Estimate ${data.reference} saved${data.dealId ? " · lead captured" : ""}`,
            );
            window.open(`/receipt/voucher/inv/${data.voucherId}`, "_blank", "noopener");
            setCart([]);
            setParty(null);
        } catch (e) {
            const msg = axios.isAxiosError(e) ? e.response?.data?.error : null;
            toast.error(msg || "Failed to save estimate");
        } finally {
            setSaving(false);
        }
    }

    return (
        <>
            {/* Header — mode switch + party picker (mirrors POS, but no sale logic) */}
            <header className="flex shrink-0 items-center gap-3 border-b border-border bg-card px-4 py-3">
                <Link href="/office" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" title="Back to office">
                    <ArrowLeft size={16} />
                </Link>
                <PosModeSwitch active="estimate" />
                <div className="flex-1 max-w-xl">
                    <PartySearchAndCreate
                        onPicked={setParty}
                        locked={!!party}
                        partyGroup="Sundry Debtors"
                    />
                </div>
                {party ? (
                    <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1 text-sm">
                        <span className="font-medium text-amber-900">{party.name}</span>
                        {party.phone && <span className="text-xs text-amber-700">{party.phone}</span>}
                        <button
                            onClick={() => setParty(null)}
                            className="text-amber-700 hover:text-amber-900"
                            title="Clear customer"
                        >
                            <X size={13} />
                        </button>
                    </div>
                ) : (
                    <span className="whitespace-nowrap text-xs text-muted-foreground">No party → quote only (no lead)</span>
                )}
            </header>

            <div className="flex min-h-0 flex-1 overflow-hidden">
                {/* Left — product search */}
                <div className="flex w-1/2 flex-col border-r border-border">
                    <div className="border-b border-border p-3">
                        <div className="relative">
                            <Search size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                            <Input
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                placeholder="Search products by name or SKU…"
                                className="pl-8"
                                autoFocus
                            />
                        </div>
                    </div>
                    <div className="min-h-0 flex-1 overflow-auto">
                        {!query.trim() ? (
                            <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
                                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-amber-50">
                                    <Search size={26} className="text-amber-500" />
                                </div>
                                <div className="text-sm font-medium text-foreground">Search products to build the quote</div>
                                <div className="max-w-xs text-xs text-muted-foreground">
                                    Type a product name or SKU on the left. The estimate prints the{" "}
                                    <span className="font-medium text-amber-600">tag price</span> only — your discounts stay private.
                                </div>
                            </div>
                        ) : results.length === 0 ? (
                            <div className="p-4 text-sm text-muted-foreground">No products match “{query}”.</div>
                        ) : (
                            results.map((p) => (
                                <button
                                    key={p.id}
                                    onClick={() => addProduct(p)}
                                    className="flex w-full items-center justify-between border-b border-border px-3 py-2 text-left hover:bg-muted"
                                >
                                    <div className="min-w-0">
                                        <div className="truncate text-sm font-medium">{p.name}</div>
                                        <div className="text-xs text-muted-foreground">{p.sku}</div>
                                    </div>
                                    <div className="ml-3 shrink-0 text-right">
                                        <div className="text-sm font-semibold">{formatRupeesFromPaise(tagOf(p))}</div>
                                        <div className="text-[10px] text-muted-foreground">tag price</div>
                                    </div>
                                </button>
                            ))
                        )}
                    </div>
                </div>

                {/* Right — estimate cart */}
                <div className="flex w-1/2 flex-col">
                    <div className="flex items-center gap-2 border-b border-border px-4 py-3">
                        <FileText size={16} className="text-amber-600" />
                        <span className="text-sm font-semibold">Estimate</span>
                        <span className="ml-auto text-xs text-muted-foreground">Tag price · no discounts · verbal negotiation</span>
                    </div>
                    <div className="min-h-0 flex-1 overflow-auto">
                        {cart.length === 0 ? (
                            <div className="p-6 text-center text-sm text-muted-foreground">
                                Search and add products to build the quotation.
                            </div>
                        ) : (
                            <table className="w-full text-sm">
                                <thead className="sticky top-0 bg-card text-xs text-muted-foreground">
                                    <tr className="border-b border-border">
                                        <th className="px-3 py-2 text-left font-medium">Item</th>
                                        <th className="px-3 py-2 text-center font-medium">Qty</th>
                                        <th className="px-3 py-2 text-right font-medium">Tag</th>
                                        <th className="px-3 py-2 text-right font-medium">Amount</th>
                                        <th className="w-8" />
                                    </tr>
                                </thead>
                                <tbody>
                                    {cart.map((l) => (
                                        <tr key={l.productId} className="border-b border-border">
                                            <td className="px-3 py-2">
                                                <div className="font-medium">{l.name}</div>
                                                <div className="text-xs text-muted-foreground">
                                                    {l.sku}
                                                    {l.mrpPaise != null && l.mrpPaise > l.tagPaise && (
                                                        <span className="ml-2 line-through">MRP {formatRupeesFromPaise(l.mrpPaise)}</span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-3 py-2">
                                                <div className="flex items-center justify-center gap-1">
                                                    <Button variant="outline" size="icon" className="h-6 w-6" onClick={() => setQty(l.productId, l.qty - 1)}>
                                                        <Minus size={12} />
                                                    </Button>
                                                    <input
                                                        value={l.qty}
                                                        onChange={(e) => {
                                                            const digits = e.target.value.replace(/\D/g, "");
                                                            setQty(l.productId, digits === "" ? 1 : Math.min(9999, parseInt(digits, 10)));
                                                        }}
                                                        inputMode="numeric"
                                                        aria-label="Quantity"
                                                        className="h-6 w-10 rounded border border-border bg-background text-center text-sm"
                                                    />
                                                    <Button variant="outline" size="icon" className="h-6 w-6" onClick={() => setQty(l.productId, l.qty + 1)}>
                                                        <Plus size={12} />
                                                    </Button>
                                                </div>
                                            </td>
                                            <td className="px-3 py-2 text-right">{formatRupeesFromPaise(l.tagPaise)}</td>
                                            <td className="px-3 py-2 text-right font-medium">{formatRupeesFromPaise(l.qty * l.tagPaise)}</td>
                                            <td className="px-2 py-2">
                                                <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground" onClick={() => setQty(l.productId, 0)}>
                                                    <Trash2 size={12} />
                                                </Button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                    <div className="border-t border-border p-4">
                        <div className="mb-3 flex items-center justify-between">
                            <span className="text-sm text-muted-foreground">Total ({cart.length} item{cart.length === 1 ? "" : "s"})</span>
                            <span className="text-xl font-bold">{formatRupeesFromPaise(total)}</span>
                        </div>
                        <Button className="w-full" disabled={saving || cart.length === 0} onClick={saveAndPrint}>
                            <Printer size={16} /> {saving ? "Saving…" : "Save & Print Estimate"}
                        </Button>
                    </div>
                </div>
            </div>
        </>
    );
}
