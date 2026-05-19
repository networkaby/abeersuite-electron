"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import type { ShopProductPublic } from "@/shared/lib/shop/productPublic";
import { demoRating } from "@/shared/lib/shop/productPublic";
import { formatRupeesFromPaise } from "@/shared/lib/format/moneyInr";
import { useShopCartStore } from "@/store/external/shopCartStore";
import { useShopWishlistStore } from "@/store/external/shopWishlistStore";
import { useShopCompareStore, SHOP_COMPARE_MAX } from "@/store/external/shopCompareStore";
import { toast } from "sonner";
import { Heart, GitCompare, Minus, Plus, Share2, Star } from "lucide-react";
import { cn } from "@/shared/lib/format/utils";

export default function ProductPurchasePanel({ product }: { product: ShopProductPublic }) {
    const add = useShopCartStore((s) => s.add);
    const toggleWish = useShopWishlistStore((s) => s.toggle);
    const wishHas = useShopWishlistStore((s) => s.has(product.id));
    const addCompare = useShopCompareStore((s) => s.add);
    const [qty, setQty] = useState(1);

    const { stars, reviewCount } = demoRating(product.id);
    const discountPct =
        product.mrpPaise && product.mrpPaise > product.pricePaise
            ? Math.round((1 - product.pricePaise / product.mrpPaise) * 100)
            : null;

    const share = async () => {
        const url = typeof window !== "undefined" ? window.location.href : "";
        try {
            await navigator.clipboard.writeText(url);
            toast.success("Link copied");
        } catch {
            toast.error("Could not copy link");
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap gap-2">
                {product.badge ? <Badge variant="secondary">{product.badge}</Badge> : null}
                <Badge variant="outline">{product.category}</Badge>
            </div>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl text-balance">{product.name}</h1>
            {product.subheading ? <p className="text-lg text-muted-foreground">{product.subheading}</p> : null}
            <div className="flex flex-wrap items-center gap-2 text-amber-500">
                {Array.from({ length: 5 }).map((_, i) => (
                    <Star
                        key={i}
                        className={cn("size-5", i < Math.round(stars) ? "fill-current" : "text-muted/35")}
                    />
                ))}
                <span className="text-sm text-muted-foreground ml-1">
                    {stars.toFixed(1)} · {reviewCount} reviews
                </span>
            </div>
            <div className="rounded-2xl border border-border/80 bg-card/60 p-6 shadow-sm backdrop-blur-sm">
                <div className="flex flex-wrap items-end gap-3">
                    <span className="text-4xl font-bold tabular-nums">{formatRupeesFromPaise(product.pricePaise)}</span>
                    {product.mrpPaise && product.mrpPaise > product.pricePaise ? (
                        <>
                            <span className="text-xl text-muted-foreground line-through tabular-nums">
                                {formatRupeesFromPaise(product.mrpPaise)}
                            </span>
                            {discountPct ? (
                                <Badge className="bg-emerald-600 text-white hover:bg-emerald-600/90">{discountPct}% off</Badge>
                            ) : null}
                        </>
                    ) : null}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">Inclusive of taxes where applicable · shipping at checkout</p>

                <div className="mt-6 flex flex-wrap gap-3">
                    <div className="flex items-center rounded-full border border-border bg-background">
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="rounded-full"
                            onClick={() => setQty((q) => Math.max(1, q - 1))}
                            aria-label="Decrease quantity"
                        >
                            <Minus className="size-4" />
                        </Button>
                        <Input
                            type="text"
                            inputMode="numeric"
                            value={qty}
                            onChange={(e) => setQty(Math.min(99, Math.max(1, parseInt(e.target.value, 10) || 1)))}
                            className="w-14 border-0 bg-transparent text-center tabular-nums shadow-none focus-visible:ring-0"
                        />
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="rounded-full"
                            onClick={() => setQty((q) => Math.min(99, q + 1))}
                            aria-label="Increase quantity"
                        >
                            <Plus className="size-4" />
                        </Button>
                    </div>
                    <Button
                        size="lg"
                        className="min-w-[200px] flex-1 rounded-full text-base shadow-md"
                        type="button"
                        onClick={() => {
                            add(product.id, qty);
                            toast.success(`Added ${qty} to cart`);
                        }}
                    >
                        Add to cart
                    </Button>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                    <Button
                        type="button"
                        variant={wishHas ? "default" : "outline"}
                        className="rounded-full"
                        onClick={() => {
                            toggleWish(product.id);
                            toast(wishHas ? "Removed from wishlist" : "Saved to wishlist");
                        }}
                    >
                        <Heart className={cn("size-4 mr-2", wishHas && "fill-current")} />
                        Wishlist
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        className="rounded-full"
                        onClick={() => {
                            const ok = addCompare(product.id);
                            toast(
                                ok ? "Added to compare" : `Compare is limited to ${SHOP_COMPARE_MAX} products`
                            );
                        }}
                    >
                        <GitCompare className="size-4 mr-2" />
                        Compare
                    </Button>
                    <Button type="button" variant="outline" className="rounded-full" onClick={() => void share()}>
                        <Share2 className="size-4 mr-2" />
                        Share
                    </Button>
                    <Button variant="secondary" className="rounded-full" asChild>
                        <Link href="/shop/cart">View cart</Link>
                    </Button>
                </div>
            </div>
            <p className="text-sm text-muted-foreground">
                Need this with a service ticket?{" "}
                <Link href="/portal" className="text-primary font-medium underline underline-offset-4">
                    Open the customer portal
                </Link>
            </p>
        </div>
    );
}
