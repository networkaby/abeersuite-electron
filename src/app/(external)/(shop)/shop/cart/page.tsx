"use client";

import Link from "next/link";
import ShopRemoteImage from "@/modules/external/shop/ShopRemoteImage";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useShopCartStore } from "@/store/external/shopCartStore";
import { usePortalAccountStore } from "@/store/external/portalAccountStore";
import { formatRupeesFromPaise } from "@/shared/lib/format/moneyInr";
import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import type { ShopProductPublic } from "@/shared/lib/shop/productPublic";
import { productPath } from "@/shared/lib/shop/productPublic";
import { Input } from "@/components/ui/input";
import { Truck, Shield, CreditCard } from "lucide-react";

type TierPreview = {
    tierPct: number;
    tierLabel: string | null;
    discountPaise: number;
    // Best AUTO offer (typed codes live on the checkout page, not the cart).
    coupon: { code: string; name: string; discountPaise: number; droppedTier: boolean } | null;
    // Best AUTO independent free-grant (Free item / Buy X get Y) — added to the
    // order as a zero-price line.
    freeGrant: { code: string; productName: string; freeQty: number } | null;
    // Rule 3 — a fully-free non-independent coupon that won the money slot: its
    // item rides the order as a zero-price line too.
    moneyGrant: { code: string; productName: string; freeQty: number } | null;
    // Rule 2 — an independent PARTIAL (<100%) FREE_ITEM / BOGO on top: a ₹
    // discount never guard-clamped.
    onTop: { code: string; name: string; discountPaise: number } | null;
};

export default function ShopCartPage() {
    const { lines, setQty, remove, clear } = useShopCartStore();
    const [products, setProducts] = useState<ShopProductPublic[]>([]);
    // Level (spend-tier) discount preview — logged-in customers only. The
    // server owns the number (/api/shop/tier-preview, same helper the order
    // route freezes at checkout); guests silently see plain prices.
    const storeAccountId = usePortalAccountStore((s) => s.activeAccountId);
    const [fetchedAccountId, setFetchedAccountId] = useState<number | null>(null);
    // Store wins when another surface (checkout / portal) already hydrated it;
    // else the one-shot fetch below fills the fallback.
    const accountId = storeAccountId ?? fetchedAccountId;
    const [tierPreview, setTierPreview] = useState<TierPreview | null>(null);

    useEffect(() => {
        axios
            .get<ShopProductPublic[]>("/api/shop/products")
            .then((r) => setProducts(r.data))
            .catch(() => setProducts([]));
    }, []);

    // Resolve the active portal account when the store hasn't been hydrated
    // yet — ask once; a 401/403 (guest) just leaves the fallback null.
    useEffect(() => {
        if (storeAccountId) return;
        let cancelled = false;
        axios
            .get<{ active: { accountId: number } }>("/api/portal/account-context")
            .then((r) => { if (!cancelled) setFetchedAccountId(r.data.active.accountId); })
            .catch(() => { /* guest — no preview */ });
        return () => { cancelled = true; };
    }, [storeAccountId]);

    // Live preview — debounced so qty typing doesn't spam the endpoint. No
    // sync setState here (react-hooks/set-state-in-effect): a guest / empty
    // cart simply never fetches, and the render gate below hides stale rows.
    useEffect(() => {
        if (!accountId || lines.length === 0) return;
        let cancelled = false;
        const timer = setTimeout(() => {
            axios
                .post<TierPreview>("/api/shop/tier-preview", {
                    accountId,
                    lines: lines.map((l) => ({ productId: l.productId, quantity: l.quantity })),
                })
                .then((r) => { if (!cancelled) setTierPreview(r.data); })
                .catch(() => { if (!cancelled) setTierPreview(null); });
        }, 300);
        return () => { cancelled = true; clearTimeout(timer); };
    }, [accountId, lines]);

    const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

    let subtotal = 0;
    for (const l of lines) {
        const p = byId.get(l.productId);
        if (p) subtotal += p.pricePaise * l.quantity;
    }
    const tierDiscountPaise = accountId && lines.length > 0 ? (tierPreview?.discountPaise ?? 0) : 0;
    const couponPaise = accountId && lines.length > 0 ? (tierPreview?.coupon?.discountPaise ?? 0) : 0;
    const onTopPaise = accountId && lines.length > 0 ? (tierPreview?.onTop?.discountPaise ?? 0) : 0;
    const netTotal = Math.max(0, subtotal - tierDiscountPaise - couponPaise - onTopPaise);

    // Shipping isn't priced here — the customer's address (pincode / neighbourhood)
    // decides the courier and rate, so we quote it on the checkout page.
    return (
        <main className="mx-auto max-w-6xl px-4 py-10 lg:py-14">
            <h1 className="text-3xl font-bold tracking-tight">Shopping cart</h1>
            <p className="text-muted-foreground mt-1 text-sm">Review items before secure checkout in ₹</p>

            {lines.length === 0 ? (
                <Card className="mt-10 border-dashed">
                    <CardContent className="py-16 text-center text-muted-foreground">
                        Your cart is empty.
                        <Button className="mt-6 rounded-full" asChild>
                            <Link href="/shop#catalog">Browse catalog</Link>
                        </Button>
                    </CardContent>
                </Card>
            ) : (
                <div className="mt-10 grid gap-8 lg:grid-cols-[1fr_380px] lg:items-start">
                    <div className="space-y-4">
                        {lines.map((l) => {
                            const p = byId.get(l.productId);
                            const img = p?.galleryUrls[0] ?? p?.imageUrl;
                            return (
                                <Card key={l.productId} className="overflow-hidden border-border/80 shadow-sm">
                                    <CardContent className="p-4 sm:p-5">
                                        <div className="flex gap-4 sm:gap-6">
                                            <Link
                                                href={p ? productPath(p) : "/shop"}
                                                className="relative size-24 shrink-0 overflow-hidden rounded-xl border border-border bg-muted sm:size-28"
                                            >
                                                {img ? (
                                                    <ShopRemoteImage src={img} alt="" fill frame="square" className="object-cover" sizes="112px" />
                                                ) : null}
                                            </Link>
                                            <div className="min-w-0 flex-1 flex flex-col gap-3">
                                                <div>
                                                    <Link
                                                        href={p ? productPath(p) : "/shop"}
                                                        className="font-semibold leading-snug hover:text-primary line-clamp-2"
                                                    >
                                                        {p?.displayName ?? `Product #${l.productId}`}
                                                    </Link>
                                                </div>
                                                <div className="flex flex-wrap items-center justify-between gap-3">
                                                    <p className="text-lg font-semibold tabular-nums">
                                                        {p ? formatRupeesFromPaise(p.pricePaise) : ""}
                                                        <span className="text-sm font-normal text-muted-foreground">
                                                            {" "}
                                                            each
                                                        </span>
                                                    </p>
                                                    <div className="flex items-center gap-2">
                                                        <label className="sr-only" htmlFor={`qty-${l.productId}`}>
                                                            Quantity
                                                        </label>
                                                        <Input
                                                            id={`qty-${l.productId}`}
                                                            type="text"
                                                            inputMode="numeric"
                                                            className="h-9 w-16 text-center tabular-nums"
                                                            value={l.quantity}
                                                            onChange={(e) =>
                                                                setQty(l.productId, parseInt(e.target.value, 10) || 1)
                                                            }
                                                        />
                                                        <Button
                                                            type="button"
                                                            variant="ghost"
                                                            size="sm"
                                                            className="text-destructive"
                                                            onClick={() => remove(l.productId)}
                                                        >
                                                            Remove
                                                        </Button>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                            );
                        })}
                        <Button type="button" variant="outline" onClick={() => clear()}>
                            Clear cart
                        </Button>
                    </div>

                    <Card className="lg:sticky lg:top-24 border-border/80 shadow-md">
                        <CardHeader>
                            <CardTitle className="text-lg">Order summary</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3 text-sm">
                            <div className="flex justify-between gap-4">
                                <span className="text-muted-foreground">Subtotal</span>
                                <span className="tabular-nums font-medium">{formatRupeesFromPaise(subtotal)}</span>
                            </div>
                            {tierDiscountPaise > 0 && (
                                <div className="flex justify-between gap-4 text-emerald-600 dark:text-emerald-400">
                                    <span>
                                        Level discount{tierPreview?.tierLabel ? ` (${tierPreview.tierLabel})` : ""}
                                    </span>
                                    <span className="tabular-nums font-medium">
                                        −{formatRupeesFromPaise(tierDiscountPaise)}
                                    </span>
                                </div>
                            )}
                            {couponPaise > 0 && tierPreview?.coupon && (
                                <div className="flex justify-between gap-4 text-emerald-600 dark:text-emerald-400">
                                    <span>Offer applied ({tierPreview.coupon.name})</span>
                                    <span className="tabular-nums font-medium">
                                        −{formatRupeesFromPaise(couponPaise)}
                                    </span>
                                </div>
                            )}
                            {(tierPreview?.freeGrant || tierPreview?.moneyGrant) && (
                                <div className="flex justify-between gap-4 text-emerald-600 dark:text-emerald-400">
                                    <span>
                                        {tierPreview.freeGrant?.productName ?? tierPreview.moneyGrant?.productName}
                                        {(tierPreview.freeGrant?.freeQty ?? tierPreview.moneyGrant?.freeQty ?? 0) > 1
                                            ? ` × ${tierPreview.freeGrant?.freeQty ?? tierPreview.moneyGrant?.freeQty}`
                                            : ""}{" "}
                                        FREE
                                    </span>
                                    <span className="tabular-nums font-medium">FREE</span>
                                </div>
                            )}
                            {tierPreview?.onTop && (
                                <div className="flex justify-between gap-4 text-emerald-600 dark:text-emerald-400">
                                    <span>On top ({tierPreview.onTop.name})</span>
                                    <span className="tabular-nums font-medium">
                                        −{formatRupeesFromPaise(tierPreview.onTop.discountPaise)}
                                    </span>
                                </div>
                            )}
                            <div className="flex justify-between gap-4">
                                <span className="text-muted-foreground">Shipping</span>
                                <span className="tabular-nums font-medium text-muted-foreground">Shown at checkout</span>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Shipping is calculated at checkout once you enter your delivery address.
                            </p>
                            <div className="h-px bg-border" role="separator" />
                            <div className="flex justify-between gap-4 text-base">
                                <span className="font-semibold">Total</span>
                                <span className="tabular-nums font-bold">{formatRupeesFromPaise(netTotal)}</span>
                            </div>
                            <p className="text-[11px] text-muted-foreground">Plus shipping, added at checkout.</p>
                        </CardContent>
                        <CardFooter className="flex flex-col gap-3">
                            <Button size="lg" className="w-full rounded-full shadow-md" asChild>
                                <Link href="/shop/checkout">Proceed to checkout</Link>
                            </Button>
                            <ul className="flex flex-col gap-2 text-xs text-muted-foreground w-full">
                                <li className="flex items-center gap-2">
                                    <Truck className="size-4 shrink-0 text-primary" />
                                    Dispatch timelines shown at payment step
                                </li>
                                <li className="flex items-center gap-2">
                                    <Shield className="size-4 shrink-0 text-primary" />
                                    SSL session & Razorpay-ready
                                </li>
                                <li className="flex items-center gap-2">
                                    <CreditCard className="size-4 shrink-0 text-primary" />
                                    UPI, cards, netbanking where enabled
                                </li>
                            </ul>
                        </CardFooter>
                    </Card>
                </div>
            )}
        </main>
    );
}
