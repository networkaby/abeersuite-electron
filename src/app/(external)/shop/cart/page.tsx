"use client";

import Link from "next/link";
import ShopRemoteImage from "@/modules/external/shop/ShopRemoteImage";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useShopCartStore } from "@/store/external/shopCartStore";
import { formatRupeesFromPaise } from "@/shared/lib/format/moneyInr";
import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import type { ShopProductPublic } from "@/shared/lib/shop/productPublic";
import { productPath } from "@/shared/lib/shop/productPublic";
import { Input } from "@/components/ui/input";
import { Truck, Shield, CreditCard } from "lucide-react";

export default function ShopCartPage() {
    const { lines, setQty, remove, clear } = useShopCartStore();
    const [products, setProducts] = useState<ShopProductPublic[]>([]);

    useEffect(() => {
        axios
            .get<ShopProductPublic[]>("/api/shop/products")
            .then((r) => setProducts(r.data))
            .catch(() => setProducts([]));
    }, []);

    const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

    let subtotal = 0;
    for (const l of lines) {
        const p = byId.get(l.productId);
        if (p) subtotal += p.pricePaise * l.quantity;
    }

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
                                                    <ShopRemoteImage src={img} alt="" fill className="object-cover" sizes="112px" />
                                                ) : null}
                                            </Link>
                                            <div className="min-w-0 flex-1 flex flex-col gap-3">
                                                <div>
                                                    <Link
                                                        href={p ? productPath(p) : "/shop"}
                                                        className="font-semibold leading-snug hover:text-primary line-clamp-2"
                                                    >
                                                        {p?.name ?? `Product #${l.productId}`}
                                                    </Link>
                                                    {p?.subheading ? (
                                                        <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
                                                            {p.subheading}
                                                        </p>
                                                    ) : null}
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
                                <span className="tabular-nums font-bold">{formatRupeesFromPaise(subtotal)}</span>
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
